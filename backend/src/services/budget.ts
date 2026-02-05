import { eq, asc, isNull, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { db, budgetYears, budgetGroups, budgetItems, monthlyValues, transactions, transfers } from '../db/index.js';
import type { BudgetData, BudgetGroup, BudgetItem, MonthlyValue, BudgetSummary, AnnualTotals } from '../types.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
] as const;

// Default unclassified category constants
export const UNCLASSIFIED_GROUP_NAME = 'Non classé';
export const UNCLASSIFIED_GROUP_SLUG = 'non-classe';
export const UNCLASSIFIED_ITEM_NAME = 'Non classé';
export const UNCLASSIFIED_ITEM_SLUG = 'non-classe';
export const UNCLASSIFIED_SORT_ORDER = 9999; // High number to appear at the end

// Get or create a budget year
// Uses upsert pattern to avoid race conditions under concurrent requests
export async function getOrCreateYear(year: number) {
  // Try to insert, on conflict (unique year) just return the existing row
  const [budgetYear] = await db
    .insert(budgetYears)
    .values({
      year,
      initialBalance: '0',
    })
    .onConflictDoUpdate({
      target: budgetYears.year,
      set: { updatedAt: new Date() }, // No-op update to return the existing row
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
    .where(and(
      eq(transactions.yearId, yearId),
      eq(transactions.accountingYear, budgetYear)
    ))
    .groupBy(transactions.itemId, transactions.accountingMonth);

  const totalsMap = new Map<string, number>();
  for (const row of result) {
    if (row.itemId !== null) {
      const key = `${row.itemId}-${row.month}`;
      totalsMap.set(key, parseFloat(row.total || '0'));
    }
  }

  // Include transfers involving savings items in budget totals
  // - Transfer TO a savings_item = positive (contribution)
  // - Transfer FROM a savings_item = negative (withdrawal)
  // Filter by accountingYear to handle year boundaries correctly
  const transferResult = await db
    .select()
    .from(transfers)
    .where(and(
      eq(transfers.yearId, yearId),
      eq(transfers.accountingYear, budgetYear)
    ));

  for (const t of transferResult) {
    const month = t.accountingMonth;
    const amount = parseFloat(t.amount);

    // If destination is a savings item, add to that item's total (contribution)
    if (t.destinationAccountType === 'savings_item') {
      const key = `${t.destinationAccountId}-${month}`;
      const existing = totalsMap.get(key) || 0;
      totalsMap.set(key, existing + amount);
    }

    // If source is a savings item, subtract from that item's total (withdrawal)
    if (t.sourceAccountType === 'savings_item') {
      const key = `${t.sourceAccountId}-${month}`;
      const existing = totalsMap.get(key) || 0;
      totalsMap.set(key, existing - amount);
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
  monthlyValues?: MonthlyValueRecord[];
}

// Format item with monthly values and transaction actuals
function formatItem(item: ItemWithMonthlyValues, transactionTotals: Map<string, number>): BudgetItem {
  const months: MonthlyValue[] = Array(12).fill(null).map((_, i) => {
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
    months,
  };
}

// Calculate totals for groups
// Uses Decimal.js to avoid floating-point rounding errors over many additions
function calculateTotals(groups: BudgetGroup[]): { income: AnnualTotals; expenses: AnnualTotals; savings: AnnualTotals } {
  let incomeBudget = new Decimal(0);
  let incomeActual = new Decimal(0);
  let expensesBudget = new Decimal(0);
  let expensesActual = new Decimal(0);
  let savingsBudget = new Decimal(0);
  let savingsActual = new Decimal(0);

  groups.forEach((group) => {
    group.items.forEach((item) => {
      item.months.forEach((month) => {
        switch (group.type) {
          case 'income':
            incomeBudget = incomeBudget.plus(month.budget);
            incomeActual = incomeActual.plus(month.actual);
            break;
          case 'expense':
            expensesBudget = expensesBudget.plus(month.budget);
            expensesActual = expensesActual.plus(month.actual);
            break;
          case 'savings':
            savingsBudget = savingsBudget.plus(month.budget);
            savingsActual = savingsActual.plus(month.actual);
            break;
        }
      });
    });
  });

  return {
    income: { budget: incomeBudget.toNumber(), actual: incomeActual.toNumber() },
    expenses: { budget: expensesBudget.toNumber(), actual: expensesActual.toNumber() },
    savings: { budget: savingsBudget.toNumber(), actual: savingsActual.toNumber() },
  };
}

// Get full budget data for a year
export async function getBudgetDataForYear(year: number): Promise<BudgetData> {
  const budgetYear = await getOrCreateYear(year);
  const transactionTotals = await getTransactionTotals(budgetYear.id, year);

  const groups = await db.query.budgetGroups.findMany({
    where: eq(budgetGroups.yearId, budgetYear.id),
    orderBy: [asc(budgetGroups.sortOrder)],
    with: {
      items: {
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
    items: group.items.filter(item => item.groupId !== null).map(item => formatItem(item, transactionTotals)),
  }));

  return {
    yearId: budgetYear.id,
    year: budgetYear.year,
    initialBalance: parseFloat(budgetYear.initialBalance),
    groups: formattedGroups,
  };
}

// Get budget summary for a year
export async function getBudgetSummary(year: number): Promise<BudgetSummary> {
  const data = await getBudgetDataForYear(year);
  const { income, expenses, savings } = calculateTotals(data.groups);

  // Remaining = Initial + Income - Expenses - Savings
  return {
    initialBalance: data.initialBalance,
    totalIncome: income,
    totalExpenses: expenses,
    totalSavings: savings,
    remainingBalance: data.initialBalance + income.actual - expenses.actual - savings.actual,
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
    initialBalance: parseFloat(y.initialBalance) 
  }));
}

// Create a new year
// Throws if year already exists - use getOrCreateYear for upsert behavior
// Uses try-catch on unique constraint to handle race conditions
export async function createYear(year: number, initialBalance: number = 0) {
  try {
    const [newYear] = await db.insert(budgetYears).values({
      year,
      initialBalance: initialBalance.toString(),
    }).returning();

    return { 
      id: newYear.id, 
      year: newYear.year, 
      initialBalance: parseFloat(newYear.initialBalance) 
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
  const [updated] = await db.update(budgetYears)
    .set({ initialBalance: initialBalance.toString(), updatedAt: new Date() })
    .where(eq(budgetYears.id, id))
    .returning();

  if (!updated) return null;

  return { 
    id: updated.id, 
    year: updated.year, 
    initialBalance: parseFloat(updated.initialBalance) 
  };
}

// Create a new group
export async function createGroup(data: {
  yearId: number;
  name: string;
  slug: string;
  type?: 'income' | 'expense' | 'savings';
  sortOrder?: number;
}) {
  const [newGroup] = await db.insert(budgetGroups).values({
    yearId: data.yearId,
    name: data.name,
    slug: data.slug,
    type: data.type ?? 'expense',
    sortOrder: data.sortOrder ?? 0,
  }).returning();

  return newGroup;
}

// Update a group
export async function updateGroup(id: number, data: {
  name?: string;
  slug?: string;
  type?: 'income' | 'expense' | 'savings';
  sortOrder?: number;
}) {
  const [updated] = await db.update(budgetGroups)
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
      await tx.update(budgetGroups)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(budgetGroups.id, id));
    }
  });
}

// Reorder items within a group
// Wrapped in a transaction to ensure atomicity
export async function reorderItems(items: { id: number; sortOrder: number }[]) {
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of items) {
      await tx.update(budgetItems)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(budgetItems.id, id));
    }
  });
}

// Delete a group (moves items to unassigned)
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
    // Move items to unassigned
    await tx.update(budgetItems)
      .set({ groupId: null, updatedAt: new Date() })
      .where(eq(budgetItems.groupId, id));
    
    // Delete the group
    await tx.delete(budgetGroups).where(eq(budgetGroups.id, id));
  });
  
  return true;
}

// Get unassigned items for a year
export async function getUnassignedItems(yearId: number, budgetYear: number): Promise<BudgetItem[]> {
  const transactionTotals = await getTransactionTotals(yearId, budgetYear);
  
  const items = await db.query.budgetItems.findMany({
    where: and(eq(budgetItems.yearId, yearId), isNull(budgetItems.groupId)),
    orderBy: [asc(budgetItems.sortOrder)],
    with: {
      monthlyValues: {
        orderBy: [asc(monthlyValues.month)],
      },
    },
  });

  return items.map(item => formatItem(item, transactionTotals));
}

// Create a new item
export async function createItem(data: {
  yearId: number;
  groupId?: number | null;
  name: string;
  slug: string;
  sortOrder?: number;
}) {
  const [newItem] = await db.insert(budgetItems).values({
    yearId: data.yearId,
    groupId: data.groupId || null,
    name: data.name,
    slug: data.slug,
    sortOrder: data.sortOrder ?? 0,
  }).returning();

  // Create empty monthly values for the item
  const monthlyData = Array(12).fill(null).map((_, i) => ({
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
export async function getOrCreateUnclassifiedItem(yearId: number): Promise<number> {
  // Try to insert or get the unclassified group using upsert
  // Note: Requires unique constraint on (year_id, slug) - see migration 0001
  const [unclassifiedGroup] = await db
    .insert(budgetGroups)
    .values({
      yearId,
      name: UNCLASSIFIED_GROUP_NAME,
      slug: UNCLASSIFIED_GROUP_SLUG,
      type: 'expense',
      sortOrder: UNCLASSIFIED_SORT_ORDER,
    })
    .onConflictDoUpdate({
      target: [budgetGroups.yearId, budgetGroups.slug],
      set: { updatedAt: new Date() }, // No-op update to return the existing row
    })
    .returning();

  // Try to insert or get the unclassified item using upsert
  // Note: Requires unique constraint on (year_id, group_id, slug) - see migration 0001
  const [unclassifiedItem] = await db
    .insert(budgetItems)
    .values({
      yearId,
      groupId: unclassifiedGroup.id,
      name: UNCLASSIFIED_ITEM_NAME,
      slug: UNCLASSIFIED_ITEM_SLUG,
      sortOrder: 0,
    })
    .onConflictDoUpdate({
      target: [budgetItems.yearId, budgetItems.groupId, budgetItems.slug],
      set: { updatedAt: new Date() }, // No-op update to return the existing row
    })
    .returning();

  // Check if monthly values exist (only create if this was a new item)
  const existingMonthlyValues = await db.query.monthlyValues.findFirst({
    where: eq(monthlyValues.itemId, unclassifiedItem.id),
  });

  if (!existingMonthlyValues) {
    // Create empty monthly values for the item
    const monthlyData = Array(12).fill(null).map((_, i) => ({
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
export async function updateItem(id: number, data: {
  name?: string;
  slug?: string;
  sortOrder?: number;
}) {
  const [updated] = await db.update(budgetItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(budgetItems.id, id))
    .returning();

  return updated || null;
}

// Move item to a group (or unassign)
export async function moveItem(itemId: number, groupId: number | null) {
  const [updated] = await db.update(budgetItems)
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
export async function updateMonthlyValue(itemId: number, month: number, data: {
  budget?: number;
  actual?: number;
}) {
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
