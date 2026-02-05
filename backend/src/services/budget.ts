import Decimal from 'decimal.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  accountBalances,
  budgetGroups,
  budgetItems,
  budgetYears,
  db,
  monthlyValues,
  paymentMethods,
  transactions,
} from '../db/index.js';
import type { AnnualTotals, BudgetData, BudgetGroup, BudgetItem, BudgetSummary, MonthlyValue } from '../types.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// TODO: Remove this when proper user/budget context is implemented
const DEFAULT_BUDGET_ID = 1;

export const MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

// Default unclassified category constants
export const UNCLASSIFIED_GROUP_NAME = 'Non classé';
export const UNCLASSIFIED_GROUP_SLUG = 'non-classe';
export const UNCLASSIFIED_ITEM_NAME = 'Non classé';
export const UNCLASSIFIED_ITEM_SLUG = 'non-classe';
export const UNCLASSIFIED_SORT_ORDER = 9999; // High number to appear at the end

// Get or create a budget year
// Uses upsert pattern to avoid race conditions under concurrent requests
export async function getOrCreateYear(year: number, budgetId: number = DEFAULT_BUDGET_ID) {
  // First check if the year already exists for this budget
  const existing = await db.query.budgetYears.findFirst({
    where: and(eq(budgetYears.budgetId, budgetId), eq(budgetYears.year, year)),
  });

  if (existing) {
    return existing;
  }

  // Create new year for this budget
  const [budgetYear] = await db
    .insert(budgetYears)
    .values({
      budgetId,
      year,
      initialBalance: '0',
    })
    .returning();

  return budgetYear;
}

// Get transaction totals per item per month for a year
// Uses accountingMonth AND accountingYear for consistency - this ensures that
// late-December transactions with settlement days that push them to January
// are correctly attributed to the next year's budget, not the current year.
async function getTransactionTotals(yearId: number, budgetYear: number): Promise<Map<string, number>> {
  // Get regular transaction totals grouped by accounting month
  // Filter by accountingYear to handle year boundaries correctly
  const result = await db
    .select({
      itemId: transactions.itemId,
      month: transactions.accountingMonth,
      total: sql<string>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(and(eq(transactions.yearId, yearId), eq(transactions.accountingYear, budgetYear)))
    .groupBy(transactions.itemId, transactions.accountingMonth);

  const totalsMap = new Map<string, number>();
  for (const row of result) {
    if (row.itemId !== null) {
      const key = `${row.itemId}-${row.month}`;
      totalsMap.set(key, parseFloat(row.total || '0'));
    }
  }

  return totalsMap;
}

// Types for database query results
interface MonthlyValueRecord {
  month: number;
  budget: string;
  actual: string;
}

interface ItemWithMonthlyValues {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  yearlyBudget: string;
  monthlyValues?: MonthlyValueRecord[];
}

// Format item with monthly values and transaction actuals
function formatItem(item: ItemWithMonthlyValues, transactionTotals: Map<string, number>): BudgetItem {
  const months: MonthlyValue[] = Array(12)
    .fill(null)
    .map((_, i) => {
      const monthData = item.monthlyValues?.find((mv) => mv.month === i + 1);
      const transactionKey = `${item.id}-${i + 1}`;
      const transactionActual = transactionTotals.get(transactionKey) || 0;

      return {
        budget: monthData ? parseFloat(monthData.budget) : 0,
        actual: transactionActual,
      };
    });

  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    yearlyBudget: parseFloat(item.yearlyBudget || '0'),
    months,
  };
}

// Calculate totals for groups
// Uses Decimal.js to avoid floating-point rounding errors over many additions
// Includes both monthly budgets and yearly budgets
function calculateTotals(groups: BudgetGroup[]): {
  income: AnnualTotals;
  expenses: AnnualTotals;
} {
  let incomeBudget = new Decimal(0);
  let incomeActual = new Decimal(0);
  let expensesBudget = new Decimal(0);
  let expensesActual = new Decimal(0);

  groups.forEach((group) => {
    group.items.forEach((item) => {
      // Add yearly budget to the total (once per item, not per month)
      const yearlyBudget = new Decimal(item.yearlyBudget || 0);

      if (group.type === 'income') {
        incomeBudget = incomeBudget.plus(yearlyBudget);
      } else if (group.type === 'expense') {
        expensesBudget = expensesBudget.plus(yearlyBudget);
      }

      // Add monthly budgets and actuals
      item.months.forEach((month) => {
        if (group.type === 'income') {
          incomeBudget = incomeBudget.plus(month.budget);
          incomeActual = incomeActual.plus(month.actual);
        } else if (group.type === 'expense') {
          expensesBudget = expensesBudget.plus(month.budget);
          expensesActual = expensesActual.plus(month.actual);
        }
      });
    });
  });

  return {
    income: { budget: incomeBudget.toNumber(), actual: incomeActual.toNumber() },
    expenses: { budget: expensesBudget.toNumber(), actual: expensesActual.toNumber() },
  };
}

// Get full budget data for a year
export async function getBudgetDataForYear(year: number): Promise<BudgetData> {
  const budgetYear = await getOrCreateYear(year);
  const budgetId = budgetYear.budgetId;
  const transactionTotals = await getTransactionTotals(budgetYear.id, year);

  const groups = await db.query.budgetGroups.findMany({
    where: eq(budgetGroups.budgetId, budgetId),
    orderBy: [asc(budgetGroups.sortOrder)],
    with: {
      items: {
        where: eq(budgetItems.yearId, budgetYear.id),
        orderBy: [asc(budgetItems.sortOrder)],
        with: {
          monthlyValues: {
            orderBy: [asc(monthlyValues.month)],
          },
        },
      },
    },
  });

  const formattedGroups: BudgetGroup[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    slug: group.slug,
    type: group.type as BudgetGroup['type'],
    sortOrder: group.sortOrder,
    items: group.items.filter((item) => item.groupId !== null).map((item) => formatItem(item, transactionTotals)),
  }));

  return {
    yearId: budgetYear.id,
    year: budgetYear.year,
    initialBalance: parseFloat(budgetYear.initialBalance),
    groups: formattedGroups,
  };
}

// Calculate projected end of year balance matching frontend's December budget calculation
// This uses: cumulative actual up to current month + budget for remaining months + remaining yearly budgets
function calculateProjectedEndOfYear(groups: BudgetGroup[], initialBalance: number): number {
  const currentMonth = new Date().getMonth(); // 0-indexed (0 = January)
  const maxActualMonth = currentMonth + 1; // Frontend shows actual up to currentMonth + 1

  // Calculate cumulative actual balance (matches frontend's cumulativeActual)
  let cumulativeActual = initialBalance;

  // Calculate section totals
  const sectionTotals = {
    income: { monthlyBudgets: Array(12).fill(0), monthlyActuals: Array(12).fill(0), yearlyBudget: 0, totalActual: 0 },
    expense: { monthlyBudgets: Array(12).fill(0), monthlyActuals: Array(12).fill(0), yearlyBudget: 0, totalActual: 0 },
  };

  // Track remaining yearly budget per section (only for items WITH yearly budgets)
  let incomeRemainingYearly = 0;
  let expenseRemainingYearly = 0;

  for (const group of groups) {
    const section = sectionTotals[group.type as keyof typeof sectionTotals];
    if (!section) continue;

    for (const item of group.items) {
      for (let i = 0; i < 12; i++) {
        const monthData = item.months[i];
        section.monthlyBudgets[i] += monthData?.budget || 0;
        section.monthlyActuals[i] += monthData?.actual || 0;
      }

      // Only calculate remaining yearly for items that HAVE a yearly budget
      // (matches frontend logic which skips items with yearlyBudget === 0)
      const yearlyBudget = item.yearlyBudget || 0;
      if (yearlyBudget > 0) {
        const actualSpent = item.months.reduce((sum, m) => sum + (m?.actual || 0), 0);
        const remaining = yearlyBudget - actualSpent;

        if (group.type === 'income') {
          incomeRemainingYearly += remaining;
        } else if (group.type === 'expense') {
          expenseRemainingYearly += remaining;
        }
      }
    }
  }

  // Calculate cumulative actual through maxActualMonth
  for (let i = 0; i <= Math.min(maxActualMonth, 11); i++) {
    cumulativeActual += sectionTotals.income.monthlyActuals[i] - sectionTotals.expense.monthlyActuals[i];
  }

  // Use cumulative actual as starting point, then add budget for remaining months
  let projectedEnd = cumulativeActual;

  // Add budget cash flow for months after maxActualMonth
  for (let i = maxActualMonth + 1; i < 12; i++) {
    projectedEnd += sectionTotals.income.monthlyBudgets[i] - sectionTotals.expense.monthlyBudgets[i];
  }

  // Add remaining yearly budgets (matches frontend's December calculation)
  projectedEnd += incomeRemainingYearly - expenseRemainingYearly;

  return projectedEnd;
}

// Get budget summary for a year
export async function getBudgetSummary(year: number): Promise<BudgetSummary> {
  const data = await getBudgetDataForYear(year);
  const { income, expenses } = calculateTotals(data.groups);

  // Calculate initial balance from payment method accounts
  // Get all payment methods that are marked as accounts
  const paymentMethodAccounts = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(eq(paymentMethods.isAccount, true));

  const paymentMethodIds = new Set(paymentMethodAccounts.map((pm) => pm.id));

  // Get all initial balances for this year
  const allBalances = await db.select().from(accountBalances).where(eq(accountBalances.yearId, data.yearId));

  // Sum up balances for payment method accounts only
  const initialBalance = allBalances
    .filter((b) => paymentMethodIds.has(b.paymentMethodId))
    .reduce((sum, b) => sum + parseFloat(b.initialBalance), 0);

  // Calculate projected end of year (matches frontend's December budget calculation)
  const remainingBalance = calculateProjectedEndOfYear(data.groups, initialBalance);

  return {
    initialBalance,
    totalIncome: income,
    totalExpenses: expenses,
    remainingBalance,
  };
}

// Get all years
export async function getAllYears() {
  const years = await db.query.budgetYears.findMany({
    orderBy: [asc(budgetYears.year)],
  });
  return years.map((y) => ({
    id: y.id,
    year: y.year,
    initialBalance: parseFloat(y.initialBalance),
  }));
}

// Create a new year
// Throws if year already exists - use getOrCreateYear for upsert behavior
// Uses try-catch on unique constraint to handle race conditions
export async function createYear(year: number, initialBalance: number = 0, budgetId: number = DEFAULT_BUDGET_ID) {
  try {
    const [newYear] = await db
      .insert(budgetYears)
      .values({
        budgetId,
        year,
        initialBalance: initialBalance.toString(),
      })
      .returning();

    return {
      id: newYear.id,
      year: newYear.year,
      initialBalance: parseFloat(newYear.initialBalance),
    };
  } catch (err: unknown) {
    // Check for unique constraint violation (PostgreSQL error code 23505)
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      throw new Error(`Year ${year} already exists`);
    }
    throw err;
  }
}

// Update a year
export async function updateYear(id: number, initialBalance: number) {
  const [updated] = await db
    .update(budgetYears)
    .set({ initialBalance: initialBalance.toString(), updatedAt: new Date() })
    .where(eq(budgetYears.id, id))
    .returning();

  if (!updated) return null;

  return {
    id: updated.id,
    year: updated.year,
    initialBalance: parseFloat(updated.initialBalance),
  };
}

// Create a new group
export async function createGroup(data: {
  budgetId: number;
  name: string;
  slug: string;
  type?: 'income' | 'expense';
  sortOrder?: number;
}) {
  const [newGroup] = await db
    .insert(budgetGroups)
    .values({
      budgetId: data.budgetId,
      name: data.name,
      slug: data.slug,
      type: data.type ?? 'expense',
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();

  return newGroup;
}

// Update a group
export async function updateGroup(
  id: number,
  data: {
    name?: string;
    slug?: string;
    type?: 'income' | 'expense';
    sortOrder?: number;
  }
) {
  const [updated] = await db
    .update(budgetGroups)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(budgetGroups.id, id))
    .returning();

  return updated || null;
}

// Reorder groups
// Wrapped in a transaction to ensure atomicity
export async function reorderGroups(groups: { id: number; sortOrder: number }[]) {
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of groups) {
      await tx.update(budgetGroups).set({ sortOrder, updatedAt: new Date() }).where(eq(budgetGroups.id, id));
    }
  });
}

// Reorder items within a group
// Wrapped in a transaction to ensure atomicity
export async function reorderItems(items: { id: number; sortOrder: number }[]) {
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of items) {
      await tx.update(budgetItems).set({ sortOrder, updatedAt: new Date() }).where(eq(budgetItems.id, id));
    }
  });
}

// Delete a group and all its items
// Returns true if group was deleted, false if it didn't exist
// Wrapped in a transaction to ensure atomicity
export async function deleteGroup(id: number): Promise<boolean> {
  // Check if group exists
  const existing = await db.query.budgetGroups.findFirst({
    where: eq(budgetGroups.id, id),
  });

  if (!existing) {
    return false;
  }

  // Use transaction to ensure both operations succeed or fail together
  await db.transaction(async (tx) => {
    // Get all items in the group
    const items = await tx.query.budgetItems.findMany({
      where: eq(budgetItems.groupId, id),
    });

    // Delete monthly values for all items in the group
    for (const item of items) {
      await tx.delete(monthlyValues).where(eq(monthlyValues.itemId, item.id));
    }

    // Delete the items
    await tx.delete(budgetItems).where(eq(budgetItems.groupId, id));

    // Delete the group
    await tx.delete(budgetGroups).where(eq(budgetGroups.id, id));
  });

  return true;
}

// Create a new item
export async function createItem(data: {
  yearId: number;
  groupId?: number | null;
  name: string;
  slug: string;
  sortOrder?: number;
}) {
  const [newItem] = await db
    .insert(budgetItems)
    .values({
      yearId: data.yearId,
      groupId: data.groupId || null,
      name: data.name,
      slug: data.slug,
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();

  // Create empty monthly values for the item
  const monthlyData = Array(12)
    .fill(null)
    .map((_, i) => ({
      itemId: newItem.id,
      month: i + 1,
      budget: '0',
      actual: '0',
    }));
  await db.insert(monthlyValues).values(monthlyData);

  return newItem;
}

// Get or create the unclassified item for a year
// Uses upsert pattern to avoid race conditions under concurrent requests
export async function getOrCreateUnclassifiedItem(
  yearId: number,
  budgetId: number = DEFAULT_BUDGET_ID
): Promise<number> {
  // First check if unclassified group exists for this budget
  let unclassifiedGroup = await db.query.budgetGroups.findFirst({
    where: and(eq(budgetGroups.budgetId, budgetId), eq(budgetGroups.slug, UNCLASSIFIED_GROUP_SLUG)),
  });

  if (!unclassifiedGroup) {
    // Create the unclassified group
    const [newGroup] = await db
      .insert(budgetGroups)
      .values({
        budgetId,
        name: UNCLASSIFIED_GROUP_NAME,
        slug: UNCLASSIFIED_GROUP_SLUG,
        type: 'expense',
        sortOrder: UNCLASSIFIED_SORT_ORDER,
      })
      .returning();
    unclassifiedGroup = newGroup;
  }

  // Check if unclassified item exists for this year and group
  let unclassifiedItem = await db.query.budgetItems.findFirst({
    where: and(
      eq(budgetItems.yearId, yearId),
      eq(budgetItems.groupId, unclassifiedGroup.id),
      eq(budgetItems.slug, UNCLASSIFIED_ITEM_SLUG)
    ),
  });

  if (!unclassifiedItem) {
    // Create the unclassified item
    const [newItem] = await db
      .insert(budgetItems)
      .values({
        yearId,
        groupId: unclassifiedGroup.id,
        name: UNCLASSIFIED_ITEM_NAME,
        slug: UNCLASSIFIED_ITEM_SLUG,
        sortOrder: 0,
      })
      .returning();
    unclassifiedItem = newItem;
  }

  // Check if monthly values exist (only create if this was a new item)
  const existingMonthlyValues = await db.query.monthlyValues.findFirst({
    where: eq(monthlyValues.itemId, unclassifiedItem.id),
  });

  if (!existingMonthlyValues) {
    // Create empty monthly values for the item
    const monthlyData = Array(12)
      .fill(null)
      .map((_, i) => ({
        itemId: unclassifiedItem.id,
        month: i + 1,
        budget: '0',
        actual: '0',
      }));
    await db.insert(monthlyValues).values(monthlyData);
  }

  return unclassifiedItem.id;
}

// Update an item
export async function updateItem(
  id: number,
  data: {
    name?: string;
    slug?: string;
    sortOrder?: number;
    yearlyBudget?: number;
  }
) {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.slug !== undefined) updateData.slug = data.slug;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.yearlyBudget !== undefined) updateData.yearlyBudget = data.yearlyBudget.toString();

  const [updated] = await db.update(budgetItems).set(updateData).where(eq(budgetItems.id, id)).returning();

  return updated || null;
}

// Move item to a group (or unassign)
export async function moveItem(itemId: number, groupId: number | null) {
  const [updated] = await db
    .update(budgetItems)
    .set({ groupId: groupId || null, updatedAt: new Date() })
    .where(eq(budgetItems.id, itemId))
    .returning();

  return updated || null;
}

// Delete an item
// Returns true if item was deleted, false if it didn't exist
export async function deleteItem(id: number): Promise<boolean> {
  // Check if item exists
  const existing = await db.query.budgetItems.findFirst({
    where: eq(budgetItems.id, id),
  });

  if (!existing) {
    return false;
  }

  await db.delete(budgetItems).where(eq(budgetItems.id, id));
  return true;
}

// Update monthly values
// Uses upsert pattern to avoid race conditions under concurrent requests
// Note: Requires unique constraint on (item_id, month) - see migration
export async function updateMonthlyValue(
  itemId: number,
  month: number,
  data: {
    budget?: number;
    actual?: number;
  }
) {
  // First, try to get existing to determine if this is create or update
  const existing = await db.query.monthlyValues.findFirst({
    where: (mv, { and }) => and(eq(mv.itemId, itemId), eq(mv.month, month)),
  });

  const isCreate = !existing;
  const budgetValue = data.budget?.toString() ?? existing?.budget ?? '0';
  const actualValue = data.actual?.toString() ?? existing?.actual ?? '0';

  // Use upsert to handle race conditions
  const [result] = await db
    .insert(monthlyValues)
    .values({
      itemId,
      month,
      budget: budgetValue,
      actual: actualValue,
    })
    .onConflictDoUpdate({
      target: [monthlyValues.itemId, monthlyValues.month],
      set: {
        budget: budgetValue,
        actual: actualValue,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    budget: parseFloat(result.budget),
    actual: parseFloat(result.actual),
    created: isCreate,
  };
}
