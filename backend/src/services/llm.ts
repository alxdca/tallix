import axios from 'axios';
import { logger } from '../logger.js';
import { getLanguageLLMName } from '../constants/languages.js';

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1';

export interface TransactionToClassify {
  index: number;
  date: string;
  description: string;
  amount: number;
  thirdParty?: string;
  rawDescription?: string;
  rawThirdParty?: string;
  rawCategory?: string;
  rawPaymentMethod?: string;
}

export interface CategoryInfo {
  id: number;
  name: string;
  groupName: string;
  groupType: 'income' | 'expense' | 'savings';
}

export interface PaymentMethodInfo {
  id: number;
  name: string;
  institution: string | null;
}

export interface ClassificationResult {
  index: number;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  isIncome: boolean;
  description: string | null;
  thirdParty: string | null;
  paymentMethodId: number | null;
  confidence: 'high' | 'medium' | 'low';
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
 * Build the system prompt with categories and known third parties
 * Uses compact JSON format for token efficiency
 */
function buildSystemPrompt(
  categories: CategoryInfo[],
  knownThirdParties: string[],
  paymentMethods: PaymentMethodInfo[],
  language: string,
  country?: string
): string {
  // Build compact category catalog: {id, n: name, g: group, t: "i"|"e"|"s"}
  const categoryCatalog = categories.map((c) => ({
    id: c.id,
    n: c.name,
    g: c.groupName,
    t: c.groupType === 'income' ? 'i' : c.groupType === 'savings' ? 's' : 'e',
  }));

  // Build compact payment methods catalog: {id, n: name (institution)}
  const pmCatalog = paymentMethods.map((pm) => ({
    id: pm.id,
    n: pm.institution ? `${pm.name} (${pm.institution})` : pm.name,
  }));

  // Format known third parties as compact array
  const thirdPartiesLine = knownThirdParties.length > 0 ? `\nThird parties: ${JSON.stringify(knownThirdParties)}` : '';

  // Format payment methods catalog
  const pmLine = pmCatalog.length > 0 ? `\nPayment methods (id,n=name): ${JSON.stringify(pmCatalog)}` : '';

  // Get language name for prompt
  const langName = getLanguageLLMName(language);

  const countryLine = country
    ? `\nUser country: ${country}. Classify based on what merchants actually sell in this country (e.g. a store name may be a retailer, not an event).`
    : '';

  return `Classify bank transactions.

Cat(id,n,g,t=i/e/s):${JSON.stringify(categoryCatalog)}
${pmLine}${thirdPartiesLine}${countryLine}

Return: catId,pmId (from lists),desc,tp,conf(h/m/l). Omit null fields. Use s(savings) categories for transfers to savings accounts.
desc: Keep original if clean, else simplify to 3-8 words, Title Case, in ${langName}. Remove dates/refs/codes/country codes. Don't repeat merchant (tp is separate).

JSON:[{index,catId?,pmId?,desc,tp?,conf},...]`;
}

/**
 * Build the user prompt with transactions to classify
 * Uses compact JSON array format: [index, date, amount, rawDesc, rawTp, rawCat, rawPm]
 */
function buildUserPrompt(transactions: TransactionToClassify[]): string {
  // Build compact array: [i, date, amount, rawDesc, rawTp, rawCat, rawPm]
  const data = transactions.map((t) => [
    t.index,
    t.date,
    t.amount,
    t.rawDescription || t.description,
    t.rawThirdParty || null,
    t.rawCategory || null,
    t.rawPaymentMethod || null,
  ]);

  return `[i,date,amt,desc,tp,cat,pm]\n${JSON.stringify(data)}`;
}

/**
 * Call the DeepSeek API
 */
async function callDeepSeekAPI(messages: DeepSeekMessage[], transactionCount: number): Promise<DeepSeekResponse> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DeepSeek API key not configured');
  }

  // Dynamic max_tokens: ~80 tokens per transaction (LLM uses verbose JSON formatting)
  const maxTokens = Math.min(Math.max(transactionCount * 80 + 200, 1000), 8192);
  // Dynamic timeout: 10s base + 3s per transaction
  const timeout = Math.min(10000 + transactionCount * 3000, 120000);

  const url = `${DEEPSEEK_API_URL}/chat/completions`;
  logger.info({ url, maxTokens, timeout, transactionCount }, 'Calling DeepSeek API');

  try {
    const response = await axios.post<DeepSeekResponse>(
      url,
      {
        model: 'deepseek-chat',
        messages,
        max_tokens: maxTokens,
        temperature: 0.1,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout,
      }
    );

    logger.info(
      {
        status: response.status,
        hasChoices: !!response.data?.choices?.length,
      },
      'DeepSeek API response received'
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`DeepSeek API timeout after ${timeout}ms`);
      }
      throw new Error(`DeepSeek API error: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parse LLM response into classification results
 */
function parseClassificationResponse(
  content: string,
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[],
  transactionCount: number
): ClassificationResult[] {
  let parsed: unknown;

  // Try to extract JSON from the response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.error({ content: content.slice(0, 500) }, 'No JSON array found in LLM response');
    throw new Error('Failed to parse LLM response: no JSON array found');
  }

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    logger.error({ content: content.slice(0, 500), error: e }, 'Failed to parse LLM response as JSON');
    throw new Error('Failed to parse LLM response as JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM response is not an array');
  }

  // Create maps for category lookup by ID and name
  const categoryById = new Map<number, CategoryInfo>();
  const categoryByName = new Map<string, CategoryInfo>();
  for (const cat of categories) {
    categoryById.set(cat.id, cat);
    categoryByName.set(cat.name.toLowerCase(), cat);
  }

  // Create set of valid payment method IDs
  const validPmIds = new Set(paymentMethods.map((pm) => pm.id));

  // Confidence mapping from short to full
  const confMap: Record<string, 'high' | 'medium' | 'low'> = {
    h: 'high',
    m: 'medium',
    l: 'low',
    high: 'high',
    medium: 'medium',
    low: 'low',
  };

  const classifications: ClassificationResult[] = [];

  for (const raw of parsed as Array<Record<string, unknown>>) {
    const index = typeof raw.index === 'number' ? raw.index : typeof raw.i === 'number' ? raw.i : -1;
    if (index < 0) {
      continue;
    }
    // Note: We don't validate index < transactionCount because batches may use global indices

    // Get category by ID (new compact format) or by name (legacy fallback)
    let categoryId: number | null = null;
    let categoryName: string | null = null;
    let groupName: string | null = null;

    // Try catId first (new compact format)
    if (typeof raw.catId === 'number') {
      const category = categoryById.get(raw.catId);
      if (category) {
        categoryId = category.id;
        categoryName = category.name;
        groupName = category.groupName;
      }
    }
    // Fallback to categoryName (legacy format)
    else if (typeof raw.categoryName === 'string' && raw.categoryName) {
      const category = categoryByName.get(raw.categoryName.toLowerCase());
      if (category) {
        categoryId = category.id;
        categoryName = category.name;
        groupName = category.groupName;
      }
    }

    // Get payment method by ID (only accept valid IDs from our list)
    let paymentMethodId: number | null = null;
    if (typeof raw.pmId === 'number' && validPmIds.has(raw.pmId)) {
      paymentMethodId = raw.pmId;
    }

    // Derive isIncome from the matched category's groupType
    const matchedCategory = categoryId ? categoryById.get(categoryId) : null;
    const isIncome = matchedCategory?.groupType === 'income';

    // Extract fields with compact (desc, tp, conf) and legacy support
    const description = (raw.desc ?? raw.description) as string | undefined;
    const thirdParty = (raw.tp ?? raw.thirdParty) as string | undefined;
    const confidence = confMap[(raw.conf ?? raw.confidence) as string] || 'low';

    classifications.push({
      index,
      categoryId,
      categoryName,
      groupName,
      isIncome,
      description: typeof description === 'string' ? description : null,
      thirdParty: typeof thirdParty === 'string' ? thirdParty : null,
      paymentMethodId,
      confidence,
    });
  }

  return classifications;
}

/**
 * Build prompt for extracting transactions from raw PDF text
 * Uses compact format for token efficiency (same style as classification prompt)
 */
function buildExtractPrompt(
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[],
  language: string,
  country: string
): string {
  // Build compact category catalog: {id, n: name, g: group, t: "i"|"e"|"s"}
  const categoryCatalog = categories.map((c) => ({
    id: c.id,
    n: c.name,
    g: c.groupName,
    t: c.groupType === 'income' ? 'i' : c.groupType === 'savings' ? 's' : 'e',
  }));

  // Build compact payment methods catalog: {id, n: name (institution)}
  const pmCatalog = paymentMethods.map((pm) => ({
    id: pm.id,
    n: pm.institution ? `${pm.name} (${pm.institution})` : pm.name,
  }));

  const pmLine = pmCatalog.length > 0 ? `\nPM(id,n):${JSON.stringify(pmCatalog)}` : '';
  const langName = getLanguageLLMName(language);

  const countryLine = `\nUser country: ${country}. Classify based on what merchants actually sell in this country.`;

  return `Extract bank transactions from raw PDF text and classify.

Cat(id,n,g,t=i/e/s):${JSON.stringify(categoryCatalog)}${pmLine}${countryLine}

Return:[{d,a,catId?,pmId?,desc,tp?,conf},...]
d=YYYY-MM-DD, a=amount(+expense/-income), catId/pmId from lists.
tp=merchant/store name (NO location/city/address/country codes). Remove trailing city+country tokens. Remove abbreviations/codes/prefixes unless part of brand. Reconstruct truncated names if possible using common completions of the remaining tokens.
desc=what was bought, Title Case in ${langName}, DON'T repeat tp. Infer desc from merchant type.
conf=h/m/l. Use s(savings) for transfers. Omit null fields.`;
}

export interface ExtractedTransaction {
  date: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  isIncome: boolean;
  description: string;
  thirdParty: string | null;
  paymentMethodId: number | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Parse LLM response for extracted transactions
 */
function parseExtractResponse(
  content: string,
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[]
): ExtractedTransaction[] {
  let parsed: unknown;

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.error({ content: content.slice(0, 500) }, 'No JSON array found in extract response');
    throw new Error('Failed to parse extract response: no JSON array found');
  }

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    logger.error({ content: content.slice(0, 500), error: e }, 'Failed to parse extract response as JSON');
    throw new Error('Failed to parse extract response as JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Extract response is not an array');
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const pmMap = new Map(paymentMethods.map((pm) => [pm.id, pm]));

  const transactions: ExtractedTransaction[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;

    const raw = item as Record<string, unknown>;
    // Support both compact (catId) and any variations LLM might use
    const catId = typeof raw.catId === 'number' ? raw.catId : null;
    const pmId = typeof raw.pmId === 'number' ? raw.pmId : null;
    const category = catId !== null ? categoryMap.get(catId) : null;
    const pm = pmId !== null ? pmMap.get(pmId) : null;

    // Parse date - support both compact 'd' and full 'date'
    let date = typeof raw.d === 'string' ? raw.d : typeof raw.date === 'string' ? raw.date : '';
    // Try to normalize various date formats to YYYY-MM-DD
    if (date && !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const parts = date.split(/[./-]/);
      if (parts.length === 3) {
        const [a, b, c] = parts.map((p) => parseInt(p, 10));
        // Handle DD.MM.YYYY or DD/MM/YYYY
        if (c > 1900) {
          date = `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
        }
      }
    }

    // Parse amount - support both compact 'a' and full 'amount'
    const rawAmount = raw.a !== undefined ? raw.a : raw.amount;
    const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount)) || 0;

    transactions.push({
      date,
      amount: Math.abs(amount),
      categoryId: category ? category.id : null,
      categoryName: category ? category.name : null,
      groupName: category ? category.groupName : null,
      isIncome: category?.groupType === 'income' || amount < 0,
      description: typeof raw.desc === 'string' ? raw.desc : '',
      thirdParty: typeof raw.tp === 'string' ? raw.tp : null,
      paymentMethodId: pm ? pm.id : null,
      confidence: raw.conf === 'h' ? 'high' : raw.conf === 'm' ? 'medium' : 'low',
    });
  }

  return transactions;
}

/**
 * Extract and classify transactions from raw PDF text
 */
export async function extractAndClassifyFromPdf(
  rawPdfText: string,
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[] = [],
  language: string = 'fr',
  country: string
): Promise<ExtractedTransaction[]> {
  if (!isLLMConfigured()) {
    throw new Error('LLM service not configured. Set DEEPSEEK_API_KEY environment variable.');
  }

  if (!country) {
    throw new Error('Country is required for PDF LLM classification.');
  }

  if (!rawPdfText || rawPdfText.trim().length === 0) {
    return [];
  }

  logger.info(
    {
      textLength: rawPdfText.length,
      categoriesCount: categories.length,
      paymentMethodsCount: paymentMethods.length,
    },
    'Extracting transactions from raw PDF text with LLM'
  );

  const systemPrompt = buildExtractPrompt(categories, paymentMethods, language, country);

  // Limit text to avoid excessive tokens (keep first ~20K chars which should be plenty)
  const truncatedText = rawPdfText.length > 20000 ? rawPdfText.slice(0, 20000) + '\n...[truncated]' : rawPdfText;

  const messages: DeepSeekMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: truncatedText },
  ];

  try {
    const startTime = Date.now();
    // Estimate ~100 transactions max from a PDF
    const response = await callDeepSeekAPI(messages, 100);
    const apiTimeMs = Date.now() - startTime;

    logger.info(
      {
        timeMs: apiTimeMs,
        timeSec: (apiTimeMs / 1000).toFixed(1),
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      },
      'PDF extraction completed'
    );

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ response: JSON.stringify(response).slice(0, 500) }, 'Empty response from LLM');
      throw new Error('Empty response from LLM');
    }

    const transactions = parseExtractResponse(content, categories, paymentMethods);
    logger.info({ extractedCount: transactions.length }, 'Parsed extracted transactions');

    return transactions;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to extract transactions from PDF'
    );
    throw error;
  }
}

/**
 * Classify transactions using DeepSeek LLM
 */
export async function classifyTransactions(
  transactions: TransactionToClassify[],
  categories: CategoryInfo[],
  knownThirdParties: string[] = [],
  paymentMethods: PaymentMethodInfo[] = [],
  language: string = 'fr',
  country?: string
): Promise<ClassificationResult[]> {
  if (!isLLMConfigured()) {
    throw new Error('LLM service not configured. Set DEEPSEEK_API_KEY environment variable.');
  }

  if (transactions.length === 0) {
    return [];
  }

  logger.info(
    {
      transactionCount: transactions.length,
      knownThirdPartiesCount: knownThirdParties.length,
      paymentMethodsCount: paymentMethods.length,
    },
    'Classifying transactions with LLM'
  );

  const systemPrompt = buildSystemPrompt(categories, knownThirdParties, paymentMethods, language, country);
  const userPrompt = buildUserPrompt(transactions);

  logger.info(
    {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      systemPrompt,
      userPrompt,
    },
    'LLM prompts prepared'
  );

  const messages: DeepSeekMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Token budget thresholds (for monitoring only - DeepSeek handles 64K+ context)
  const TOKEN_BUDGET = 15000;
  const TOKEN_WARNING_THRESHOLD = 10000;

  try {
    const startTime = Date.now();
    const response = await callDeepSeekAPI(messages, transactions.length);
    const apiTimeMs = Date.now() - startTime;

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = response.usage?.total_tokens ?? 0;
    const cacheHitTokens = response.usage?.prompt_cache_hit_tokens ?? 0;
    const cacheMissTokens = response.usage?.prompt_cache_miss_tokens ?? 0;
    const cacheHitRate = promptTokens > 0 ? Math.round((cacheHitTokens / promptTokens) * 100) : 0;

    // Log token usage with cache metrics and timing
    logger.info(
      {
        transactionCount: transactions.length,
        timeMs: apiTimeMs,
        timeSec: (apiTimeMs / 1000).toFixed(1),
        promptTokens,
        completionTokens,
        totalTokens,
        cacheHitTokens,
        cacheMissTokens,
        cacheHitRate: `${cacheHitRate}%`,
        choicesCount: response.choices?.length,
      },
      'LLM classification completed'
    );

    // Log if token usage is unusually high (for monitoring only)
    if (promptTokens > TOKEN_WARNING_THRESHOLD) {
      logger.info({ promptTokens, threshold: TOKEN_WARNING_THRESHOLD }, 'High prompt token usage');
    }
    if (totalTokens > TOKEN_BUDGET) {
      logger.info({ totalTokens, budget: TOKEN_BUDGET }, 'High total token usage');
    }

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ response: JSON.stringify(response).slice(0, 500) }, 'Empty or invalid response from LLM');
      throw new Error('Empty response from LLM');
    }

    logger.info({ contentLength: content.length }, 'Parsing LLM response');

    const classifications = parseClassificationResponse(content, categories, paymentMethods, transactions.length);

    logger.info({ classifiedCount: classifications.length }, 'Parsed LLM classifications');

    return classifications;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to classify transactions with LLM'
    );
    throw error;
  }
}
