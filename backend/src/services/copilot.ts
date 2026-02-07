import axios from 'axios';
import { and, desc, eq, gte, lte, or, ilike, inArray } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { budgetGroups, budgetItems, budgetYears, transactions } from '../db/schema.js';
import { logger } from '../logger.js';
import { getLanguageLLMName } from '../constants/languages.js';

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1';

// Transaction fetch limits per ticket requirements
const MAX_TRANSACTION_LIMIT = 1000;
const DEFAULT_TRANSACTION_LIMIT = 250;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotContext {
  userId: string;
  budgetId: number;
  language: string;
  country: string;
  currentYear: number;
  conversationHistory?: ConversationMessage[];
}

export interface CategoryData {
  id: number;
  name: string;
  groupName: string;
  groupType: 'income' | 'expense' | 'savings';
  aliases?: string[];
}

export interface TransactionData {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  thirdParty: string | null;
  categoryName: string | null;
  groupName: string | null;
  groupType: 'income' | 'expense' | 'savings' | null;
  paymentMethodName: string | null;
  accountingMonth: number;
  accountingYear: number;
}

export interface BudgetPlanData {
  categoryName: string;
  groupName: string;
  groupType: 'income' | 'expense' | 'savings';
  month: number;
  planned: number;
  actual: number;
  yearlyBudget: number;
}

export interface DataPlan {
  needsCategories: boolean;
  needsTransactions: boolean;
  needsBudgetData: boolean;
  transactionFilters?: {
    startDate?: string;
    endDate?: string;
    accountingMonth?: number;
    accountingYear?: number;
    minAmount?: number;
    maxAmount?: number;
    categoryNames?: string[];
    groupNames?: string[];
    merchantPattern?: string;
    limit?: number;
  };
  budgetDataFilters?: {
    months?: number[];
    categoryNames?: string[];
    groupNames?: string[];
  };
  intent: string; // What the user is asking about
  confidence: 'high' | 'medium' | 'low';
}

export interface CopilotAnswer {
  summary: string;
  why: Array<{
    reason: string;
    metric?: string;
    value?: number;
  }>;
  drilldownFilters?: {
    categoryName?: string;
    groupName?: string;
    startDate?: string;
    endDate?: string;
  };
  confidence: 'high' | 'medium' | 'low';
  isFallback: boolean;
}

export interface CopilotResponse extends CopilotAnswer {
  latencyMs: number;
}

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

/**
 * Check if LLM service is configured
 */
export function isLLMConfigured(): boolean {
  return !!DEEPSEEK_API_KEY;
}

/**
 * Call the DeepSeek API
 */
async function callDeepSeekAPI(messages: DeepSeekMessage[], timeoutMs: number = 30000): Promise<DeepSeekResponse> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DeepSeek API key not configured');
  }

  const url = `${DEEPSEEK_API_URL}/chat/completions`;

  try {
    const response = await axios.post<DeepSeekResponse>(
      url,
      {
        model: 'deepseek-chat',
        messages,
        max_tokens: 2000,
        temperature: 0.1,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
      }
    );

    logger.info(
      {
        status: response.status,
        hasChoices: !!response.data?.choices?.length,
        usage: response.data.usage,
      },
      'DeepSeek API response received'
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`DeepSeek API timeout after ${timeoutMs}ms`);
      }
      throw new Error(`DeepSeek API error: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get all categories for the budget
 */
async function getCategories(tx: DbClient, budgetId: number): Promise<CategoryData[]> {
  const groups = await tx.query.budgetGroups.findMany({
    where: eq(budgetGroups.budgetId, budgetId),
    with: {
      items: {
        orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.name)],
      },
    },
    orderBy: (groups, { asc }) => [asc(groups.sortOrder), asc(groups.name)],
  });

  const categories: CategoryData[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      categories.push({
        id: item.id,
        name: item.name,
        groupName: group.name,
        groupType: group.type as 'income' | 'expense' | 'savings',
      });
    }
  }

  return categories;
}

/**
 * Fetch transactions based on filters
 */
async function fetchTransactions(
  tx: DbClient,
  budgetId: number,
  currentYear: number,
  filters: DataPlan['transactionFilters']
): Promise<TransactionData[]> {
  if (!filters) {
    filters = {};
  }

  // Apply limit (default 250, max 1000)
  const limit = Math.min(filters.limit || DEFAULT_TRANSACTION_LIMIT, MAX_TRANSACTION_LIMIT);

  // Get year ID
  const year = await tx.query.budgetYears.findFirst({
    where: and(
      eq(budgetYears.budgetId, budgetId),
      eq(budgetYears.year, currentYear)
    ),
  });

  if (!year) {
    return [];
  }

  // Build where conditions
  // When using accounting filters, filter by accountingYear instead of yearId
  // to catch cross-year transactions (e.g., Dec 2025 transaction accounted in Jan 2026)
  const usingAccountingFilters =
    (filters.accountingMonth !== undefined && filters.accountingMonth !== null) ||
    (filters.accountingYear !== undefined && filters.accountingYear !== null);

  let conditions: any[];

  if (usingAccountingFilters) {
    // For accounting-based queries, filter by accountingYear instead of yearId
    const targetAccountingYear = filters.accountingYear || currentYear;
    conditions = [eq(transactions.accountingYear, targetAccountingYear)];

    if (filters.accountingMonth !== undefined && filters.accountingMonth !== null) {
      conditions.push(eq(transactions.accountingMonth, filters.accountingMonth));
    }
  } else {
    // For transaction-date queries, use yearId
    conditions = [eq(transactions.yearId, year.id)];
  }

  // Transaction date filters
  if (filters.startDate) {
    conditions.push(gte(transactions.date, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(transactions.date, filters.endDate));
  }

  // Amount filters
  if (filters.minAmount !== undefined && filters.minAmount !== null) {
    conditions.push(gte(transactions.amount, String(filters.minAmount)));
  }

  if (filters.maxAmount !== undefined && filters.maxAmount !== null) {
    conditions.push(lte(transactions.amount, String(filters.maxAmount)));
  }

  // Merchant pattern filter
  if (filters.merchantPattern && filters.merchantPattern !== null) {
    conditions.push(
      or(
        ilike(transactions.thirdParty, `%${filters.merchantPattern}%`),
        ilike(transactions.description, `%${filters.merchantPattern}%`)
      )
    );
  }

  // Pre-fetch: Get item IDs for category/group filters to apply at SQL level
  let matchingItemIds: number[] | undefined;

  if (filters.categoryNames && Array.isArray(filters.categoryNames) && filters.categoryNames.length > 0) {
    const categoryNamesLower = filters.categoryNames.map(n => n.toLowerCase());

    // When using accounting filters, we need to search items across all years for THIS budget
    // because a Dec 2025 transaction accounted in Jan 2026 uses 2025 items
    let items: Array<{ id: number; name: string }>;

    if (usingAccountingFilters) {
      // Get all years for this budget, then get all items across those years
      const allYears = await tx.query.budgetYears.findMany({
        where: eq(budgetYears.budgetId, budgetId),
        columns: { id: true },
      });

      const yearIds = allYears.map(y => y.id);

      if (yearIds.length > 0) {
        items = await tx.query.budgetItems.findMany({
          where: inArray(budgetItems.yearId, yearIds),
          columns: { id: true, name: true },
        });
      } else {
        items = [];
      }
    } else {
      items = await tx.query.budgetItems.findMany({
        where: eq(budgetItems.yearId, year.id),
        columns: { id: true, name: true },
      });
    }

    matchingItemIds = items
      .filter(item => categoryNamesLower.includes(item.name.toLowerCase()))
      .map(item => item.id);

    if (matchingItemIds.length > 0) {
      conditions.push(inArray(transactions.itemId, matchingItemIds));
    } else {
      // No matching categories found - return early
      return [];
    }
  }

  if (filters.groupNames && Array.isArray(filters.groupNames) && filters.groupNames.length > 0) {
    const groupNamesLower = filters.groupNames.map(n => n.toLowerCase());

    // When using accounting filters, fetch items across all years
    const groupsQuery = tx.query.budgetGroups.findMany({
      where: eq(budgetGroups.budgetId, budgetId),
      with: {
        items: usingAccountingFilters
          ? { columns: { id: true } }  // All items for this budget
          : { where: eq(budgetItems.yearId, year.id), columns: { id: true } },
      },
      columns: { name: true },
    });

    const groups = await groupsQuery;

    const groupMatchingItemIds = groups
      .filter(g => groupNamesLower.includes(g.name.toLowerCase()))
      .flatMap(g => g.items.map(item => item.id));

    if (groupMatchingItemIds.length > 0) {
      // If we already have category filter, intersect the IDs
      if (matchingItemIds) {
        matchingItemIds = matchingItemIds.filter(id => groupMatchingItemIds.includes(id));
      } else {
        matchingItemIds = groupMatchingItemIds;
      }
      conditions.push(inArray(transactions.itemId, matchingItemIds));
    } else {
      // No matching groups found - return early
      return [];
    }
  }

  // Fetch transactions with relations
  const txResults = await tx.query.transactions.findMany({
    where: and(...conditions),
    with: {
      item: {
        with: {
          group: true,
        },
      },
      paymentMethodRel: true,
    },
    orderBy: desc(transactions.date),
    limit,
  });

  // Map to TransactionData
  return txResults.map(t => ({
    id: t.id,
    date: t.date,
    amount: parseFloat(t.amount),
    description: t.description,
    thirdParty: t.thirdParty,
    categoryName: t.item?.name || null,
    groupName: t.item?.group?.name || null,
    groupType: (t.item?.group?.type as 'income' | 'expense' | 'savings' | undefined) || null,
    paymentMethodName: t.paymentMethodRel?.name || null,
    accountingMonth: t.accountingMonth,
    accountingYear: t.accountingYear,
  }));
}

/**
 * Fetch planned budget data (monthly_values) for the current year
 */
async function fetchBudgetData(
  tx: DbClient,
  budgetId: number,
  currentYear: number,
  filters?: DataPlan['budgetDataFilters']
): Promise<BudgetPlanData[]> {
  // Get year ID
  const year = await tx.query.budgetYears.findFirst({
    where: and(
      eq(budgetYears.budgetId, budgetId),
      eq(budgetYears.year, currentYear)
    ),
  });

  if (!year) {
    return [];
  }

  // Fetch all items for this year with their monthly values and group info
  const items = await tx.query.budgetItems.findMany({
    where: eq(budgetItems.yearId, year.id),
    with: {
      group: true,
      monthlyValues: true,
    },
  });

  const results: BudgetPlanData[] = [];

  for (const item of items) {
    if (!item.group) continue;

    const groupType = item.group.type as 'income' | 'expense' | 'savings';

    // Apply category/group filters
    if (filters?.categoryNames && filters.categoryNames.length > 0) {
      const namesLower = filters.categoryNames.map(n => n.toLowerCase());
      if (!namesLower.includes(item.name.toLowerCase())) continue;
    }
    if (filters?.groupNames && filters.groupNames.length > 0) {
      const namesLower = filters.groupNames.map(n => n.toLowerCase());
      if (!namesLower.includes(item.group.name.toLowerCase())) continue;
    }

    for (const mv of item.monthlyValues) {
      // Apply month filter
      if (filters?.months && filters.months.length > 0) {
        if (!filters.months.includes(mv.month)) continue;
      }

      results.push({
        categoryName: item.name,
        groupName: item.group.name,
        groupType,
        month: mv.month,
        planned: parseFloat(mv.budget),
        actual: parseFloat(mv.actual),
        yearlyBudget: parseFloat(item.yearlyBudget),
      });
    }
  }

  return results;
}

/**
 * Compact budget data for the LLM prompt by grouping per category.
 * Instead of one object per category×month (1188 entries), produces one object
 * per category (~99 entries) with monthly planned/actual as arrays.
 * Preserves ALL data while reducing prompt size ~5x.
 */
function compactBudgetDataForPrompt(budgetData: BudgetPlanData[], transactions: TransactionData[]): string {
  // Determine which months are present in the data
  const monthSet = new Set<number>();
  for (const b of budgetData) monthSet.add(b.month);
  const months = [...monthSet].sort((a, b) => a - b);

  // Build actual amounts from transactions (grouped by category + month)
  // since monthly_values.actual may not be synced from transactions
  const txActualMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.categoryName) {
      const key = `${t.categoryName}-${t.accountingMonth}`;
      txActualMap.set(key, (txActualMap.get(key) || 0) + t.amount);
    }
  }

  // Group by category: one entry per category with monthly arrays
  const categoryMap = new Map<string, {
    g: string;
    t: string;
    yb: number;
    planned: Map<number, number>;
  }>();

  for (const b of budgetData) {
    let entry = categoryMap.get(b.categoryName);
    if (!entry) {
      entry = {
        g: b.groupName,
        t: b.groupType[0],
        yb: b.yearlyBudget,
        planned: new Map(),
      };
      categoryMap.set(b.categoryName, entry);
    }
    entry.planned.set(b.month, (entry.planned.get(b.month) || 0) + b.planned);
  }

  const compactEntries = Array.from(categoryMap.entries()).map(([name, data]) => {
    const monthlySum = months.reduce((sum, m) => sum + (data.planned.get(m) || 0), 0);
    const totalPlanned = monthlySum + data.yb;
    return {
      c: name,
      g: data.g,
      t: data.t,
      tp: Math.round(totalPlanned * 100) / 100,
      yb: data.yb,
      p: months.map(m => Math.round((data.planned.get(m) || 0) * 100) / 100),
      a: months.map(m => Math.round((txActualMap.get(`${name}-${m}`) || 0) * 100) / 100),
    };
  });

  return `
Budget plan data by category (c=category, g=group, t=type i/e/s, tp=TOTAL yearly planned budget for this category, yb=additional yearly variable envelope, p=monthly planned amounts for months [${months.join(',')}], a=actual amounts for months [${months.join(',')}]).
IMPORTANT: tp is the TOTAL planned budget for the category for the year. tp = sum(p) + yb. Always use tp for category totals, NOT just sum(p).
${JSON.stringify(compactEntries)}
`;
}

/**
 * Build prompt for the planner (Step 1)
 * The planner decides what data to fetch
 */
function buildPlannerPrompt(
  question: string,
  categories: CategoryData[],
  language: string,
  currentYear: number,
  conversationHistory?: ConversationMessage[]
): string {
  const langName = getLanguageLLMName(language);
  const currentMonth = new Date().getMonth() + 1;
  const currentDate = new Date().toISOString().split('T')[0];

  // Build compact category list
  const categoryList = categories.map(c => ({
    n: c.name,
    g: c.groupName,
    t: c.groupType === 'income' ? 'i' : c.groupType === 'savings' ? 's' : 'e',
  }));

  // Build conversation context if available
  let conversationContext = '';
  if (conversationHistory && conversationHistory.length > 0) {
    conversationContext = '\nRecent conversation:\n';
    conversationHistory.forEach((msg) => {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      conversationContext += `${label}: ${msg.content}\n`;
    });
    conversationContext += '\n';
  }

  return `You are a budget analysis planner. Analyze the user's question and create a data fetch plan.
${conversationContext}

Current context:
- Year: ${currentYear}
- Month: ${currentMonth}
- Date: ${currentDate}
- Language: ${langName}

Available categories (n=name, g=group, t=type):
${JSON.stringify(categoryList)}

Available transaction filters:
- startDate (YYYY-MM-DD) - filter by transaction date
- endDate (YYYY-MM-DD) - filter by transaction date
- accountingMonth (1-12) - filter by accounting period (when transaction is budgeted)
- accountingYear (YYYY) - filter by accounting year (when transaction is budgeted)
- minAmount (number)
- maxAmount (number)
- categoryNames (array of category names)
- groupNames (array of group names)
- merchantPattern (string to match in merchant/description)
- limit (default 250, max 1000)

IMPORTANT - Accounting vs Transaction Date:
- Use accountingMonth/accountingYear when user asks about budget, spending in a specific month/period
- Use startDate/endDate when user asks about when transactions actually occurred
- Credit card transactions may be accounted in a different month than when they were made
- For budget questions like "how much did I spend in January", use accountingMonth=1
- For transaction questions like "what did I buy on January 15th", use startDate/endDate
- IMPORTANT: When filtering by transaction date (startDate/endDate) AND the user wants to exclude transactions with different settlement dates, ALSO add accountingMonth filter
  Example: "transactions in January, excluding those that settle in February" → startDate="2026-01-01", endDate="2026-01-31", accountingMonth=1

Available budget plan data:
- Planned (budgeted) amounts per category per month for the current year
- Actual amounts per category per month
- Yearly budget allocations for irregular spending items
- Use this when the user asks about planned/budgeted revenue, spending, or savings
- Also useful for budget vs actual comparisons, remaining budget, or forecasting

Available budget data filters:
- months (array of 1-12) - filter by specific months
- categoryNames (array of category names) - filter by specific categories
- groupNames (array of group names) - filter by specific groups

Instructions:
1. Analyze the user's question intent, considering the recent conversation context if provided
2. For follow-up questions (e.g., "What about February?", "Show me the top merchants"), infer missing context from previous exchanges
3. Decide if you need categories (always true for budget questions)
4. Decide if you need transactions:
   - TRUE if asking about ANY actual amounts (income, expenses, savings, spending)
   - TRUE if asking about specific merchants or detailed analysis
   - TRUE if asking for projections or estimates (need historical data to base projection on)
   - TRUE if comparing user's finances to external benchmarks (median salary, etc.)
   - TRUE if asking for general evaluation, recommendations, or advice (needs actual data to ground advice)
   - FALSE only for questions about budget STRUCTURE (what categories exist, how things are organized)
   - IMPORTANT: Categories only contain names and structure, NOT actual amounts. All amount data comes from transactions.
5. Decide if you need budget plan data:
   - TRUE if asking about planned/budgeted amounts (e.g., "What's my budget for groceries?", "How much income is planned?")
   - TRUE if asking about budget vs actual comparisons (e.g., "Am I over budget?", "How much is left in my budget?")
   - TRUE if asking about planned revenue, spending, or savings
   - TRUE if asking for remaining budget or projections based on planned amounts
   - TRUE if asking for general evaluation, recommendations, or advice (needs planned data for forward months)
   - FALSE if only asking about actual transactions or category structure
6. IMPORTANT - For general evaluation or recommendation questions (e.g., "evaluate my budget", "give me recommendations", "how am I doing?"):
   - ALWAYS set BOTH needsTransactions=true AND needsBudgetData=true
   - Fetch ALL transactions for the year (no group/category filter) so the answerer gets the full picture
   - Fetch ALL budget data (no group filter) so planned amounts for all categories are available
7. If requesting transactions, specify filters to minimize data:
   - For questions about a SPECIFIC month ("January spending"), use accountingMonth/accountingYear
   - For GENERAL questions ("my income", "compare to median", "my spending habits"):
     * Use ONLY startDate (Jan 1 of current year) - do NOT add accountingMonth/accountingYear
     * These filters combine as AND, so using both restricts too much
   - Use category/group filters when mentioned
   - Use merchant patterns when asking about specific merchants
   - Request higher limits (500-1000) for YTD or annual summaries
8. If requesting budget data, specify filters to minimize data:
   - Use months filter for specific month questions
   - Use categoryNames/groupNames for specific categories
   - Omit filters to get full year budget overview
9. Identify the intent (e.g., "overspending analysis", "trend comparison", "YTD summary", "budget planning")

Return JSON only:
{
  "needsCategories": true,
  "needsTransactions": boolean,
  "needsBudgetData": boolean,
  "transactionFilters": {
    "startDate": "YYYY-MM-DD" (optional, for transaction date),
    "endDate": "YYYY-MM-DD" (optional, for transaction date),
    "accountingMonth": number 1-12 (optional, for budget period),
    "accountingYear": number (optional, for budget period),
    "minAmount": number (optional),
    "maxAmount": number (optional),
    "categoryNames": ["category1", "category2"] (optional),
    "groupNames": ["group1"] (optional),
    "merchantPattern": "pattern" (optional),
    "limit": number (optional, default 250, max 1000)
  },
  "needsBudgetData": boolean,
  "budgetDataFilters": {
    "months": [1, 2, 3] (optional, array of month numbers 1-12),
    "categoryNames": ["category1"] (optional),
    "groupNames": ["group1"] (optional)
  },
  "intent": "brief description of what user is asking",
  "confidence": "high|medium|low"
}

User question: ${question}`;
}

/**
 * Build the answerer messages for the LLM (Step 2).
 *
 * The data context (system message) is separated from the question (user message)
 * so that DeepSeek's automatic prompt caching can cache the data prefix.
 * On follow-up questions with the same data, the cached prefix is reused —
 * making subsequent calls faster and cheaper.
 *
 * Conversation history is passed as multi-turn messages so the answerer
 * can reference previous exchanges (e.g., "tell me more about that").
 */
function buildAnswererMessages(
  question: string,
  categories: CategoryData[],
  transactions: TransactionData[],
  budgetData: BudgetPlanData[],
  language: string,
  conversationHistory?: ConversationMessage[]
): DeepSeekMessage[] {
  const langName = getLanguageLLMName(language);

  // Build compact categories list (only when budget data doesn't already cover it)
  let categoriesSection = '';
  if (budgetData.length === 0) {
    const categoriesCompact = categories.map(c => ({
      id: c.id,
      n: c.name,
      g: c.groupName,
      t: c.groupType[0],
    }));
    categoriesSection = `\nCategories (id, n=name, g=group, t=type):\n${JSON.stringify(categoriesCompact)}\n`;
  }

  // Pipe-delimited transactions: ~40% smaller than JSON
  const txHeader = 'd|a|m|c|tp|ds|pm';
  const txRows = transactions.map(t => {
    const d = t.date.slice(5); // MM-DD (year is in context)
    const parts = [
      d,
      t.amount,
      t.accountingMonth,
      t.categoryName || '',
      t.thirdParty || '',
      (t.description && t.description !== t.thirdParty) ? t.description : '',
      t.paymentMethodName || '',
    ];
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('|');
  });

  // Pre-calculate totals
  const totalExpense = transactions
    .filter(t => t.groupType === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = transactions
    .filter(t => t.groupType === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalSavings = transactions
    .filter(t => t.groupType === 'savings')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalAmount = totalIncome - totalExpense - totalSavings;

  // Budget section
  let budgetSection = '';
  if (budgetData.length > 0) {
    const currentMonth = new Date().getMonth() + 1;

    // Compute planned totals per category.
    // Total = sum of monthly budgets + yearlyBudget (variable envelope on top of monthly).
    const categoryMonthlySum = new Map<string, number>();
    const categoryMeta = new Map<string, { yearlyBudget: number; groupType: string }>();
    for (const b of budgetData) {
      categoryMonthlySum.set(b.categoryName, (categoryMonthlySum.get(b.categoryName) || 0) + b.planned);
      if (!categoryMeta.has(b.categoryName)) {
        categoryMeta.set(b.categoryName, { yearlyBudget: b.yearlyBudget, groupType: b.groupType });
      }
    }

    let totalPlannedIncome = 0;
    let totalPlannedExpense = 0;
    let totalPlannedSavings = 0;
    const categoryYearlyPlanned = new Map<string, { planned: number; groupType: string }>();
    for (const [catName, meta] of categoryMeta) {
      const planned = (categoryMonthlySum.get(catName) || 0) + meta.yearlyBudget;
      categoryYearlyPlanned.set(catName, { planned, groupType: meta.groupType });
      if (meta.groupType === 'income') totalPlannedIncome += planned;
      else if (meta.groupType === 'expense') totalPlannedExpense += planned;
      else if (meta.groupType === 'savings') totalPlannedSavings += planned;
    }

    // Compute blended projection: actual so far + remaining planned per category
    // We use real transaction data (not monthly_values.actual which may not be synced)
    const actualByCategory = new Map<string, number>();
    const actualByType = new Map<string, number>();
    for (const t of transactions) {
      if (t.categoryName && t.accountingMonth <= currentMonth) {
        actualByCategory.set(t.categoryName, (actualByCategory.get(t.categoryName) || 0) + t.amount);
      }
      if (t.groupType && t.accountingMonth <= currentMonth) {
        actualByType.set(t.groupType, (actualByType.get(t.groupType) || 0) + t.amount);
      }
    }

    // Blended = actual_so_far + remaining_planned per category
    let blendedIncome = 0;
    let blendedExpense = 0;
    let blendedSavings = 0;
    for (const [catName, { planned, groupType }] of categoryYearlyPlanned) {
      const actual = actualByCategory.get(catName) || 0;
      const remaining = Math.max(0, planned - actual);
      const projected = actual + remaining;
      if (groupType === 'income') blendedIncome += projected;
      else if (groupType === 'expense') blendedExpense += projected;
      else if (groupType === 'savings') blendedSavings += projected;
    }

    logger.info({
      currentMonth,
      planned: { income: totalPlannedIncome, expense: totalPlannedExpense, savings: totalPlannedSavings },
      blended: { income: blendedIncome, expense: blendedExpense, savings: blendedSavings },
      actualSoFar: { income: actualByType.get('income') || 0, expense: actualByType.get('expense') || 0, savings: actualByType.get('savings') || 0 },
    }, 'Blended projection computed');

    budgetSection = compactBudgetDataForPrompt(budgetData, transactions);
    budgetSection += `
Current month: ${currentMonth} (months 1-${currentMonth} use actual transaction data, months ${currentMonth + 1}-12 use planned budget)

YEARLY PROJECTION (USE THESE NUMBERS - actual for past months + planned for future months):
Projected income: ${blendedIncome.toFixed(2)}
Projected expenses: ${blendedExpense.toFixed(2)}
Projected savings: ${blendedSavings.toFixed(2)}
Net projected: ${(blendedIncome - blendedExpense - blendedSavings).toFixed(2)}

For reference only - original budget plan (before any actual spending):
Planned income: ${totalPlannedIncome.toFixed(2)}, Planned expenses: ${totalPlannedExpense.toFixed(2)}, Planned savings: ${totalPlannedSavings.toFixed(2)}, Net planned: ${(totalPlannedIncome - totalPlannedExpense - totalPlannedSavings).toFixed(2)}
`;
  }

  // System message: data context + guidelines (cacheable prefix)
  const systemContent = `You are a friendly, knowledgeable financial advisor. Speak naturally and conversationally, like a trusted advisor would. Be warm, insightful, and provide context when helpful. Don't be robotic - explain things in a way that helps the user understand their finances better.

Language: ${langName} (answer in this language)
${categoriesSection}
Transactions (pipe-delimited, d=MM-DD date, a=amount, m=accounting month, c=category, tp=third party, ds=description, pm=payment method; trailing empty fields trimmed).
IMPORTANT: A NEGATIVE amount on an expense transaction means a REFUND (money received back), NOT a payment. For example, a tax transaction of -13000 means a tax refund of 13000, not a tax payment.:
${txHeader}
${txRows.join('\n')}

Transaction summary:
Total transactions: ${transactions.length}
Total income: ${totalIncome.toFixed(2)}${totalIncome < 0 ? ' (negative = deductions exceeded income)' : ''}
Total expenses: ${totalExpense.toFixed(2)}${totalExpense < 0 ? ' (negative = refunds exceeded spending)' : ''}
Total savings: ${totalSavings.toFixed(2)}${totalSavings < 0 ? ' (negative = withdrawals exceeded deposits)' : ''}
Net amount (income - expenses - savings): ${totalAmount.toFixed(2)}
${budgetSection}
Guidelines:
1. Base your analysis on the provided transaction and budget plan data. For public benchmarks (median salary, etc.), use general knowledge and cite sources.
2. Be conversational and helpful - explain insights, give context, offer perspective like a real financial advisor would.
3. The summary can be 1-3 sentences. Be concise but don't be robotic - it's OK to be warm and insightful.
4. Double-check comparisons: if A > B, say "higher/above"; if A < B, say "lower/below".
5. CRITICAL: A negative amount on an expense transaction is a REFUND (money coming back to the user), NOT a payment. For example, a tax "décompte" with amount -13000 is a tax refund of 13000 CHF. Never describe refunds as payments or costs. The pre-calculated totals already account for refunds.
6. For projections, base on historical data and explain your reasoning.
7. When budget plan data is available, use it to compare planned vs actual amounts. Budget data is grouped by category with "tp" (TOTAL yearly planned budget for the category), "p" (array of planned amounts per month), "a" (array of actual amounts per month), and "yb" (additional yearly variable envelope). CRITICAL: Always use "tp" for the total planned budget of a category. Do NOT sum the "p" array alone — "tp" already includes both monthly amounts AND the yearly variable envelope (tp = sum(p) + yb).
8. IMPORTANT - Blending actual and planned data for forward-looking analysis:
   - For months that have ALREADY PASSED (before the current month), use ACTUAL transaction data as the ground truth, not planned amounts. The "a" (actual) arrays in budget data reflect this.
   - For FUTURE months (current month and beyond), use PLANNED amounts from the budget data.
   - When computing yearly totals or projections, ALWAYS blend: actual spending for past months + planned spending for remaining months. Never use only planned amounts for the whole year when actual data is available.
   - When giving recommendations, highlight where actual spending has deviated from the plan and what that means for the rest of the year.

Return JSON only:
{
  "summary": "Natural, conversational answer in ${langName} (1-3 sentences)",
  "why": [
    {
      "reason": "Explanation with numbers",
      "metric": "metric name" (optional),
      "value": number (optional)
    }
  ],
  "drilldownFilters": {
    "categoryName": "category" (optional),
    "groupName": "group" (optional),
    "startDate": "YYYY-MM-DD" (optional),
    "endDate": "YYYY-MM-DD" (optional)
  },
  "confidence": "high|medium|low"
}`;

  // Build messages: system (data context) + conversation history + new question
  const messages: DeepSeekMessage[] = [
    { role: 'system', content: systemContent },
  ];

  // Include previous conversation turns so the answerer can handle follow-ups
  if (conversationHistory && conversationHistory.length > 0) {
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }

  // Current question
  messages.push({ role: 'user', content: question });

  return messages;
}

/**
 * Parse planner response
 */
function parsePlannerResponse(content: string): DataPlan {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in planner response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    needsCategories: parsed.needsCategories ?? true,
    needsTransactions: parsed.needsTransactions ?? false,
    needsBudgetData: parsed.needsBudgetData ?? false,
    transactionFilters: parsed.transactionFilters,
    budgetDataFilters: parsed.budgetDataFilters,
    intent: parsed.intent || 'unknown',
    confidence: parsed.confidence || 'medium',
  };
}

/**
 * Parse answerer response
 */
function parseAnswererResponse(content: string, categories: CategoryData[]): CopilotAnswer {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in answerer response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Capture any text the LLM wrote before the JSON block (preamble)
  // and prepend it to the summary so conversational intros aren't lost
  const jsonStart = content.indexOf(jsonMatch[0]);
  const preamble = content.slice(0, jsonStart).replace(/```json\s*/i, '').trim();

  // Validate that referenced categories exist
  const categoryNames = new Set(categories.map(c => c.name.toLowerCase()));
  const rawSummary = parsed.summary || '';
  const summary = preamble ? `${preamble}\n\n${rawSummary}` : rawSummary;
  const why = parsed.why || [];
  const drilldownFilters = parsed.drilldownFilters;

  // Check for hallucinated categories in drilldown filters
  if (drilldownFilters?.categoryName) {
    const catName = drilldownFilters.categoryName.toLowerCase();
    if (!categoryNames.has(catName)) {
      logger.warn(
        { categoryName: drilldownFilters.categoryName, availableCategories: Array.from(categoryNames) },
        'LLM referenced invalid category in drilldown - removing'
      );
      delete drilldownFilters.categoryName;
    }
  }

  return {
    summary,
    why,
    drilldownFilters,
    confidence: parsed.confidence || 'medium',
    isFallback: false,
  };
}

/**
 * Create a fallback response when the question is out of scope or LLM fails
 */
function createFallbackResponse(language: string): CopilotAnswer {
  const examples = language === 'fr'
    ? [
        'Pourquoi avons-nous dépassé le budget épicerie ce mois-ci ?',
        'Qu\'est-ce qui a changé par rapport au mois dernier pour les restaurants ?',
        'Combien avons-nous dépensé en voyages cette année ?'
      ]
    : [
        'Why are we over budget in groceries this month?',
        'What changed compared to last month for dining?',
        'How much did we spend on travel this year?'
      ];

  const fallbackSummary = language === 'fr'
    ? 'Je n\'ai pas pu répondre à cette question. Essayez une question sur vos dépenses ou votre budget.'
    : 'I couldn\'t answer that question. Try asking about your spending or budget.';

  return {
    summary: fallbackSummary,
    why: examples.map((ex, i) => ({
      reason: ex,
      metric: `example_${i + 1}`,
    })),
    confidence: 'low',
    isFallback: true,
  };
}

/**
 * Main function to handle a copilot question
 * Implements the 2-step LLM workflow
 */
export async function askCopilot(
  tx: DbClient,
  question: string,
  context: CopilotContext
): Promise<CopilotResponse> {
  const startTime = Date.now();

  if (!isLLMConfigured()) {
    throw new Error('LLM service not configured. Set DEEPSEEK_API_KEY environment variable.');
  }

  logger.info({ question, context }, 'Processing copilot question');

  try {
    // Always fetch categories (needed for both planning and answering)
    const categories = await getCategories(tx, context.budgetId);

    if (categories.length === 0) {
      logger.warn({ budgetId: context.budgetId }, 'No categories found for budget');
      return {
        ...createFallbackResponse(context.language),
        latencyMs: Date.now() - startTime,
      };
    }

    // Step 1: Call planner to decide what data to fetch
    const plannerPrompt = buildPlannerPrompt(
      question,
      categories,
      context.language,
      context.currentYear,
      context.conversationHistory
    );
    const plannerMessages: DeepSeekMessage[] = [
      { role: 'system', content: 'You are a budget analysis planner. Return only JSON.' },
      { role: 'user', content: plannerPrompt },
    ];

    logger.info({ promptLength: plannerPrompt.length }, 'Calling planner LLM');

    const plannerResponse = await callDeepSeekAPI(plannerMessages, 10000);
    const plannerContent = plannerResponse.choices?.[0]?.message?.content;

    if (!plannerContent) {
      throw new Error('Empty planner response');
    }

    logger.info({ plannerContent: plannerContent.slice(0, 500) }, 'Planner response received');

    const dataPlan = parsePlannerResponse(plannerContent);

    logger.info({ dataPlan }, 'Data plan created');

    // Step 2: Fetch data based on plan
    let transactions: TransactionData[] = [];
    let budgetData: BudgetPlanData[] = [];

    if (dataPlan.needsTransactions) {
      transactions = await fetchTransactions(tx, context.budgetId, context.currentYear, dataPlan.transactionFilters);
      logger.info({ transactionCount: transactions.length, filters: dataPlan.transactionFilters }, 'Transactions fetched');
    }

    if (dataPlan.needsBudgetData) {
      budgetData = await fetchBudgetData(tx, context.budgetId, context.currentYear, dataPlan.budgetDataFilters);
      logger.info({ budgetDataCount: budgetData.length, filters: dataPlan.budgetDataFilters }, 'Budget data fetched');
    }

    // Step 3: Call answerer to generate response
    // Data context goes in system message (cacheable prefix), question as separate user message.
    // Conversation history is passed as multi-turn messages for follow-up awareness.
    const answererMessages = buildAnswererMessages(
      question, categories, transactions, budgetData,
      context.language, context.conversationHistory
    );
    const totalPromptLength = answererMessages.reduce((sum, m) => sum + m.content.length, 0);

    logger.info({ promptLength: totalPromptLength, transactionCount: transactions.length }, 'Calling answerer LLM');

    const answererResponse = await callDeepSeekAPI(answererMessages, 30000);
    const answererContent = answererResponse.choices?.[0]?.message?.content;

    if (!answererContent) {
      throw new Error('Empty answerer response');
    }

    logger.info({ answererContent: answererContent.slice(0, 500) }, 'Answerer response received');

    const answer = parseAnswererResponse(answererContent, categories);

    const latencyMs = Date.now() - startTime;

    logger.info(
      {
        latencyMs,
        confidence: answer.confidence,
        plannerTokens: plannerResponse.usage?.total_tokens,
        answererTokens: answererResponse.usage?.total_tokens,
      },
      'Copilot question completed'
    );

    return {
      ...answer,
      latencyMs,
    };

  } catch (error) {
    const latencyMs = Date.now() - startTime;

    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
        question,
      },
      'Failed to process copilot question'
    );

    // Return fallback on any error
    return {
      ...createFallbackResponse(context.language),
      latencyMs,
    };
  }
}
