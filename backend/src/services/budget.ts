import Decimal from 'decimal.js';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  accountBalances,
  budgetGroups,
  budgetItems,
  budgetYears,
  monthlyValues,
  paymentMethods,
  transactions,
  transfers,
} from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import * as accountsSvc from './accounts.js';
import type { AnnualTotals, BudgetData, BudgetGroup, BudgetItem, BudgetSummary, MonthlyValue } from '../types.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

// Default unclassified category constants
export const UNCLASSIFIED_GROUP_NAME = 'Unclassified';
export const UNCLASSIFIED_GROUP_SLUG = 'non-classe';
export const UNCLASSIFIED_ITEM_NAME = 'Unclassified';
export const UNCLASSIFIED_ITEM_SLUG = 'non-classe';
export const UNCLASSIFIED_SORT_ORDER = 9999;

// Savings category constants
export const SAVINGS_GROUP_NAME = 'Savings';
export const SAVINGS_GROUP_SLUG = 'epargne';
export const SAVINGS_GROUP_TYPE = 'savings';
export const SAVINGS_SORT_ORDER = 998;

async function getActiveSavingsAccountIds(tx: DbClient, userId: string): Promise<Set<number>> {
  const accounts = await tx.query.paymentMethods.findMany({
    where: and(eq(paymentMethods.isSavingsAccount, true), eq(paymentMethods.userId, userId)),
    columns: { id: true },
  });

  return new Set(accounts.map((account) => account.id));
}

// Get or create a budget year
export async function getOrCreateYear(tx: DbClient, year: number, budgetId: number) {
  const existing = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.budgetId, budgetId), eq(budgetYears.year, year)),
  });

  if (existing) {
    return existing;
  }

  const [budgetYear] = await tx
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
async function getTransactionTotals(tx: DbClient, yearId: number, budgetYear: number): Promise<Map<string, number>> {
  const result = await tx
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

// Get transfer totals for savings accounts per month
async function getSavingsTransferTotals(
  tx: DbClient,
  yearId: number,
  budgetYear: number,
  savingsAccountIds: Set<number>
): Promise<Map<string, number>> {
  if (savingsAccountIds.size === 0) {
    return new Map();
  }

  const accountIdsArray = [...savingsAccountIds];

  // Get all transfers involving savings accounts for this year
  const transferRecords = await tx
    .select({
      sourceAccountId: transfers.sourceAccountId,
      destinationAccountId: transfers.destinationAccountId,
      month: transfers.accountingMonth,
      amount: transfers.amount,
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.yearId, yearId),
        eq(transfers.accountingYear, budgetYear),
        or(
          inArray(transfers.sourceAccountId, accountIdsArray),
          inArray(transfers.destinationAccountId, accountIdsArray)
        )
      )
    );

  // Calculate net impact per savings account per month
  const totalsMap = new Map<string, number>();

  for (const t of transferRecords) {
    const amount = parseFloat(t.amount);

    // If destination is a savings account: positive (money in)
    if (savingsAccountIds.has(t.destinationAccountId)) {
      const key = `savings-${t.destinationAccountId}-${t.month}`;
      const current = totalsMap.get(key) || 0;
      totalsMap.set(key, current + amount);
    }

    // If source is a savings account: negative (money out)
    if (savingsAccountIds.has(t.sourceAccountId)) {
      const key = `savings-${t.sourceAccountId}-${t.month}`;
      const current = totalsMap.get(key) || 0;
      totalsMap.set(key, current - amount);
    }
  }

  return totalsMap;
}

// Get transaction totals for savings accounts (transactions where paymentMethodId is a savings account)
// This captures direct deposits/withdrawals from savings accounts
async function getSavingsAccountTransactionTotals(
  tx: DbClient,
  yearId: number,
  budgetYear: number,
  savingsAccountIds: Set<number>
): Promise<Map<string, number>> {
  if (savingsAccountIds.size === 0) {
    return new Map();
  }

  const accountIdsArray = [...savingsAccountIds];

  // Get all transactions where paymentMethodId is a savings account
  // Sign depends on budget group type: income = positive, expense = negative
  const result = await tx
    .select({
      paymentMethodId: transactions.paymentMethodId,
      month: transactions.accountingMonth,
      balanceChange: sql<string>`SUM(
        CASE
          WHEN ${budgetGroups.type} = 'income' THEN ${transactions.amount}
          WHEN ${budgetGroups.type} = 'expense' THEN -${transactions.amount}
          ELSE -${transactions.amount}
        END
      )`,
    })
    .from(transactions)
    .leftJoin(budgetItems, eq(transactions.itemId, budgetItems.id))
    .leftJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
    .where(
      and(
        eq(transactions.yearId, yearId),
        eq(transactions.accountingYear, budgetYear),
        inArray(transactions.paymentMethodId, accountIdsArray)
      )
    )
    .groupBy(transactions.paymentMethodId, transactions.accountingMonth);

  const totalsMap = new Map<string, number>();
  for (const row of result) {
    if (row.paymentMethodId !== null) {
      const key = `savings-${row.paymentMethodId}-${row.month}`;
      totalsMap.set(key, parseFloat(row.balanceChange || '0'));
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
  savingsAccountId?: number | null;
  monthlyValues?: MonthlyValueRecord[];
}

// Format item with monthly values and transaction actuals
function formatItem(
  item: ItemWithMonthlyValues,
  transactionTotals: Map<string, number>,
  savingsBalanceChanges: Map<string, number>
): BudgetItem {
  const months: MonthlyValue[] = Array(12)
    .fill(null)
    .map((_, i) => {
      const monthData = item.monthlyValues?.find((mv) => mv.month === i + 1);
      const transactionKey = `${item.id}-${i + 1}`;
      const transactionActual = transactionTotals.get(transactionKey) || 0;

      // For savings items, add balance changes from transfers and transactions on the savings account
      let savingsBalanceChange = 0;
      if (item.savingsAccountId) {
        const savingsKey = `savings-${item.savingsAccountId}-${i + 1}`;
        savingsBalanceChange = savingsBalanceChanges.get(savingsKey) || 0;
      }

      return {
        budget: monthData ? parseFloat(monthData.budget) : 0,
        actual: transactionActual + savingsBalanceChange,
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
function calculateTotals(groups: BudgetGroup[]): {
  income: AnnualTotals;
  expenses: AnnualTotals;
  savings: AnnualTotals;
} {
  let incomeBudget = new Decimal(0);
  let incomeActual = new Decimal(0);
  let expensesBudget = new Decimal(0);
  let expensesActual = new Decimal(0);
  let savingsBudget = new Decimal(0);
  let savingsActual = new Decimal(0);

  groups.forEach((group) => {
    group.items.forEach((item) => {
      const yearlyBudget = new Decimal(item.yearlyBudget || 0);

      if (group.type === 'income') {
        incomeBudget = incomeBudget.plus(yearlyBudget);
      } else if (group.type === 'expense') {
        expensesBudget = expensesBudget.plus(yearlyBudget);
      } else if (group.type === 'savings') {
        savingsBudget = savingsBudget.plus(yearlyBudget);
      }

      item.months.forEach((month) => {
        if (group.type === 'income') {
          incomeBudget = incomeBudget.plus(month.budget);
          incomeActual = incomeActual.plus(month.actual);
        } else if (group.type === 'expense') {
          expensesBudget = expensesBudget.plus(month.budget);
          expensesActual = expensesActual.plus(month.actual);
        } else if (group.type === 'savings') {
          savingsBudget = savingsBudget.plus(month.budget);
          savingsActual = savingsActual.plus(month.actual);
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

function calculateExpectedTotals(groups: BudgetGroup[], currentMonthIndex: number): {
  income: number;
  expenses: number;
  savings: number;
} {
  const totals = {
    income: new Decimal(0),
    expenses: new Decimal(0),
    savings: new Decimal(0),
  };

  for (const group of groups) {
    if (group.type !== 'income' && group.type !== 'expense' && group.type !== 'savings') {
      continue;
    }

    for (const item of group.items) {
      for (let i = 0; i < 12; i++) {
        const monthData = item.months[i];
        const value = i <= currentMonthIndex ? monthData?.actual || 0 : monthData?.budget || 0;
        if (group.type === 'income') {
          totals.income = totals.income.plus(value);
        } else if (group.type === 'expense') {
          totals.expenses = totals.expenses.plus(value);
        } else {
          totals.savings = totals.savings.plus(value);
        }
      }

      const yearlyBudget = item.yearlyBudget || 0;
      if (yearlyBudget !== 0) {
        const actualSpent = item.months.reduce((sum, m) => sum + (m?.actual || 0), 0);
        const remaining = yearlyBudget - actualSpent;
        if (group.type === 'income') {
          totals.income = totals.income.plus(remaining);
        } else if (group.type === 'expense') {
          totals.expenses = totals.expenses.plus(remaining);
        } else {
          totals.savings = totals.savings.plus(remaining);
        }
      }
    }
  }

  return {
    income: totals.income.toNumber(),
    expenses: totals.expenses.toNumber(),
    savings: totals.savings.toNumber(),
  };
}

// Get full budget data for a year
export async function getBudgetDataForYear(tx: DbClient, year: number, budgetId: number, userId: string): Promise<BudgetData> {
  const budgetYear = await getOrCreateYear(tx, year, budgetId);
  const activeSavingsAccountIds = await getActiveSavingsAccountIds(tx, userId);
  const transactionTotals = await getTransactionTotals(tx, budgetYear.id, year);
  const transferTotals = await getSavingsTransferTotals(tx, budgetYear.id, year, activeSavingsAccountIds);
  const savingsAccountTransactionTotals = await getSavingsAccountTransactionTotals(tx, budgetYear.id, year, activeSavingsAccountIds);

  // Combine transfer totals and savings account transaction totals into one map
  const savingsBalanceChanges = new Map<string, number>();
  for (const [key, value] of transferTotals) {
    savingsBalanceChanges.set(key, (savingsBalanceChanges.get(key) || 0) + value);
  }
  for (const [key, value] of savingsAccountTransactionTotals) {
    savingsBalanceChanges.set(key, (savingsBalanceChanges.get(key) || 0) + value);
  }

  const groups = await tx.query.budgetGroups.findMany({
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

  const formattedGroups: BudgetGroup[] = groups.flatMap((group) => {
    const isSavingsGroup = group.type === SAVINGS_GROUP_TYPE;
    const visibleItems = group.items
      .filter((item) => item.groupId !== null)
      .filter(
        (item) =>
          // For savings groups: ONLY show items with a valid savingsAccountId that is active
          // All savings items must be linked to a savings account
          !isSavingsGroup || (item.savingsAccountId !== null && activeSavingsAccountIds.has(item.savingsAccountId))
      )
      .map((item) => formatItem(item, transactionTotals, savingsBalanceChanges));

    if (isSavingsGroup && visibleItems.length === 0) {
      return [];
    }

    return [
      {
        id: group.id,
        name: group.name,
        slug: group.slug,
        type: group.type as BudgetGroup['type'],
        sortOrder: group.sortOrder,
        items: visibleItems,
      },
    ];
  });

  return {
    yearId: budgetYear.id,
    year: budgetYear.year,
    initialBalance: parseFloat(budgetYear.initialBalance),
    groups: formattedGroups,
  };
}

// Calculate projected end of year balance
function calculateProjectedEndOfYear(
  groups: BudgetGroup[],
  initialBalance: number,
  actualBalanceThroughMonth?: number
): number {
  const currentMonthIndex = new Date().getMonth();
  const maxActualMonth = currentMonthIndex;

  let cumulativeActual = initialBalance;

  const sectionTotals = {
    income: { monthlyBudgets: Array(12).fill(0), monthlyActuals: Array(12).fill(0), yearlyBudget: 0, totalActual: 0 },
    expense: { monthlyBudgets: Array(12).fill(0), monthlyActuals: Array(12).fill(0), yearlyBudget: 0, totalActual: 0 },
    savings: { monthlyBudgets: Array(12).fill(0), monthlyActuals: Array(12).fill(0), yearlyBudget: 0, totalActual: 0 },
  };

  let incomeRemainingYearly = 0;
  let expenseRemainingYearly = 0;
  let savingsRemainingYearly = 0;

  for (const group of groups) {
    const section = sectionTotals[group.type as keyof typeof sectionTotals];
    if (!section) continue;

    for (const item of group.items) {
      for (let i = 0; i < 12; i++) {
        const monthData = item.months[i];
        section.monthlyBudgets[i] += monthData?.budget || 0;
        section.monthlyActuals[i] += monthData?.actual || 0;
      }

      const yearlyBudget = item.yearlyBudget || 0;
      if (yearlyBudget > 0) {
        const actualSpent = item.months.reduce((sum, m) => sum + (m?.actual || 0), 0);
        const remaining = yearlyBudget - actualSpent;

        if (group.type === 'income') {
          incomeRemainingYearly += remaining;
        } else if (group.type === 'expense') {
          expenseRemainingYearly += remaining;
        } else if (group.type === 'savings') {
          savingsRemainingYearly += remaining;
        }
      }
    }
  }

  if (actualBalanceThroughMonth !== undefined) {
    cumulativeActual = actualBalanceThroughMonth;
  } else {
    for (let i = 0; i <= Math.min(maxActualMonth, 11); i++) {
      cumulativeActual +=
        sectionTotals.income.monthlyActuals[i] -
        sectionTotals.expense.monthlyActuals[i] -
        sectionTotals.savings.monthlyActuals[i];
    }
  }

  let projectedEnd = cumulativeActual;

  const budgetStartMonth =
    actualBalanceThroughMonth !== undefined ? currentMonthIndex + 1 : maxActualMonth + 1;
  for (let i = budgetStartMonth; i < 12; i++) {
    projectedEnd +=
      sectionTotals.income.monthlyBudgets[i] -
      sectionTotals.expense.monthlyBudgets[i] -
      sectionTotals.savings.monthlyBudgets[i];
  }

  projectedEnd += incomeRemainingYearly - expenseRemainingYearly - savingsRemainingYearly;

  return projectedEnd;
}

// Get budget summary for a year
export async function getBudgetSummary(tx: DbClient, year: number, budgetId: number, userId: string): Promise<BudgetSummary> {
  const data = await getBudgetDataForYear(tx, year, budgetId, userId);
  const { income, expenses, savings } = calculateTotals(data.groups);
  const currentMonthIndex = new Date().getMonth();
  const expectedTotals = calculateExpectedTotals(data.groups, currentMonthIndex);

  const paymentMethodAccounts = await tx
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.isSavingsAccount, false),
        eq(paymentMethods.userId, userId),
        isNull(paymentMethods.linkedPaymentMethodId)
      )
    );

  const paymentMethodIds = new Set(paymentMethodAccounts.map((pm) => pm.id));

  const allBalances = await tx.select().from(accountBalances).where(eq(accountBalances.yearId, data.yearId));

  const initialBalance = allBalances
    .filter((b) => paymentMethodIds.has(b.paymentMethodId))
    .reduce((sum, b) => sum + parseFloat(b.initialBalance), 0);

  let actualBalanceThroughMonth: number | undefined;
  const accountsResponse = await accountsSvc.getAccountsForYear(tx, year, budgetId, userId);
  const paymentAccounts = accountsResponse.accounts.filter((account) => !account.isSavingsAccount);
  if (paymentAccounts.length > 0) {
    const monthlyBalances = Array(12)
      .fill(0)
      .map((_, i) => paymentAccounts.reduce((sum, account) => sum + (account.monthlyBalances[i] || 0), 0));
    actualBalanceThroughMonth = monthlyBalances[new Date().getMonth()] ?? initialBalance;
  }

  const remainingBalance = calculateProjectedEndOfYear(data.groups, initialBalance, actualBalanceThroughMonth);

  return {
    initialBalance,
    totalIncome: income,
    totalExpenses: expenses,
    totalSavings: savings,
    expectedIncome: expectedTotals.income,
    expectedExpenses: expectedTotals.expenses,
    expectedSavings: expectedTotals.savings,
    remainingBalance,
  };
}

// Get all years
export async function getAllYears(tx: DbClient, budgetId: number) {
  const years = await tx.query.budgetYears.findMany({
    where: eq(budgetYears.budgetId, budgetId),
    orderBy: [asc(budgetYears.year)],
  });
  return years.map((y) => ({
    id: y.id,
    year: y.year,
    initialBalance: parseFloat(y.initialBalance),
  }));
}

// Create a new year
export async function createYear(tx: DbClient, year: number, initialBalance: number = 0, budgetId: number, userId: string) {
  try {
    const [newYear] = await tx
      .insert(budgetYears)
      .values({
        budgetId,
        year,
        initialBalance: initialBalance.toString(),
      })
      .returning();

    // Create budget items for existing savings accounts
    const savingsAccounts = await tx.query.paymentMethods.findMany({
      where: and(eq(paymentMethods.isSavingsAccount, true), eq(paymentMethods.userId, userId)),
    });

    for (const sa of savingsAccounts) {
      await createSavingsItemForYear(tx, newYear.id, sa.id, sa.name, sa.institution, budgetId);
    }

    return {
      id: newYear.id,
      year: newYear.year,
      initialBalance: parseFloat(newYear.initialBalance),
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      throw new Error(`Year ${year} already exists`);
    }
    throw err;
  }
}

// Update a year
export async function updateYear(tx: DbClient, id: number, initialBalance: number, budgetId: number) {
  const existing = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.id, id), eq(budgetYears.budgetId, budgetId)),
  });

  if (!existing) return null;

  const [updated] = await tx
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
export async function createGroup(tx: DbClient, data: {
  budgetId: number;
  name: string;
  slug: string;
  type?: 'income' | 'expense';
  sortOrder?: number;
}) {
  const [newGroup] = await tx
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
  tx: DbClient,
  id: number,
  data: {
    name?: string;
    slug?: string;
    type?: 'income' | 'expense';
    sortOrder?: number;
  },
  budgetId: number
) {
  const existing = await tx.query.budgetGroups.findFirst({
    where: and(eq(budgetGroups.id, id), eq(budgetGroups.budgetId, budgetId)),
  });

  if (!existing) return null;

  const [updated] = await tx
    .update(budgetGroups)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(budgetGroups.id, id))
    .returning();

  return updated || null;
}

// Reorder groups
export async function reorderGroups(tx: DbClient, groups: { id: number; sortOrder: number }[], budgetId: number) {
  const groupIds = groups.map((g) => g.id);
  const existingGroups = await tx.query.budgetGroups.findMany({
    where: and(sql`${budgetGroups.id} IN ${groupIds}`, eq(budgetGroups.budgetId, budgetId)),
  });

  if (existingGroups.length !== groupIds.length) {
    throw new Error('One or more groups not found or do not belong to your budget');
  }

  for (const { id, sortOrder } of groups) {
    await tx.update(budgetGroups).set({ sortOrder, updatedAt: new Date() }).where(eq(budgetGroups.id, id));
  }
}

// Reorder items within a group
export async function reorderItems(tx: DbClient, items: { id: number; sortOrder: number }[], budgetId: number) {
  const itemIds = items.map((i) => i.id);
  const existingItems = await tx.query.budgetItems.findMany({
    where: sql`${budgetItems.id} IN ${itemIds}`,
    with: {
      year: true,
    },
  });

  const invalidItems = existingItems.filter((item) => item.year.budgetId !== budgetId);
  if (invalidItems.length > 0 || existingItems.length !== itemIds.length) {
    throw new Error('One or more items not found or do not belong to your budget');
  }

  for (const { id, sortOrder } of items) {
    await tx.update(budgetItems).set({ sortOrder, updatedAt: new Date() }).where(eq(budgetItems.id, id));
  }
}

// Delete a group and all its items
export async function deleteGroup(tx: DbClient, id: number, budgetId: number): Promise<boolean> {
  const existing = await tx.query.budgetGroups.findFirst({
    where: and(eq(budgetGroups.id, id), eq(budgetGroups.budgetId, budgetId)),
  });

  if (!existing) {
    return false;
  }

  const items = await tx.query.budgetItems.findMany({
    where: eq(budgetItems.groupId, id),
  });

  for (const item of items) {
    await tx.delete(monthlyValues).where(eq(monthlyValues.itemId, item.id));
  }

  await tx.delete(budgetItems).where(eq(budgetItems.groupId, id));
  await tx.delete(budgetGroups).where(eq(budgetGroups.id, id));

  return true;
}

// Create a new item
export async function createItem(tx: DbClient, data: {
  yearId: number;
  groupId?: number | null;
  name: string;
  slug: string;
  sortOrder?: number;
}, budgetId: number) {
  const year = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.id, data.yearId), eq(budgetYears.budgetId, budgetId)),
  });

  if (!year) {
    throw new Error('Year not found or does not belong to your budget');
  }

  if (data.groupId) {
    const group = await tx.query.budgetGroups.findFirst({
      where: and(eq(budgetGroups.id, data.groupId), eq(budgetGroups.budgetId, budgetId)),
    });

    if (!group) {
      throw new Error('Group not found or does not belong to your budget');
    }

    // Prevent creating savings items through the generic create function
    // Savings items must be created through createSavingsBudgetItems() or createSavingsItemForYear()
    if (group.type === SAVINGS_GROUP_TYPE) {
      throw new Error('Cannot create savings items manually. Savings items are automatically created from savings accounts.');
    }
  }

  const [newItem] = await tx
    .insert(budgetItems)
    .values({
      yearId: data.yearId,
      groupId: data.groupId || null,
      name: data.name,
      slug: data.slug,
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();

  const monthlyData = Array(12)
    .fill(null)
    .map((_, i) => ({
      itemId: newItem.id,
      month: i + 1,
      budget: '0',
      actual: '0',
    }));
  await tx.insert(monthlyValues).values(monthlyData);

  return newItem;
}

// Get or create the unclassified item for a year
export async function getOrCreateUnclassifiedItem(
  tx: DbClient,
  yearId: number,
  budgetId: number
): Promise<number> {
  let unclassifiedGroup = await tx.query.budgetGroups.findFirst({
    where: and(eq(budgetGroups.budgetId, budgetId), eq(budgetGroups.slug, UNCLASSIFIED_GROUP_SLUG)),
  });

  if (!unclassifiedGroup) {
    const [newGroup] = await tx
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

  let unclassifiedItem = await tx.query.budgetItems.findFirst({
    where: and(
      eq(budgetItems.yearId, yearId),
      eq(budgetItems.groupId, unclassifiedGroup.id),
      eq(budgetItems.slug, UNCLASSIFIED_ITEM_SLUG)
    ),
  });

  if (!unclassifiedItem) {
    const [newItem] = await tx
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

  const existingMonthlyValues = await tx.query.monthlyValues.findFirst({
    where: eq(monthlyValues.itemId, unclassifiedItem.id),
  });

  if (!existingMonthlyValues) {
    const monthlyData = Array(12)
      .fill(null)
      .map((_, i) => ({
        itemId: unclassifiedItem!.id,
        month: i + 1,
        budget: '0',
        actual: '0',
      }));
    await tx.insert(monthlyValues).values(monthlyData);
  }

  return unclassifiedItem.id;
}

// Update an item
export async function updateItem(
  tx: DbClient,
  id: number,
  data: {
    name?: string;
    slug?: string;
    sortOrder?: number;
    yearlyBudget?: number;
  },
  budgetId: number
) {
  const existing = await tx.query.budgetItems.findFirst({
    where: eq(budgetItems.id, id),
    with: {
      year: true,
    },
  });

  if (!existing || existing.year.budgetId !== budgetId) {
    return null;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.slug !== undefined) updateData.slug = data.slug;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.yearlyBudget !== undefined) updateData.yearlyBudget = data.yearlyBudget.toString();

  const [updated] = await tx.update(budgetItems).set(updateData).where(eq(budgetItems.id, id)).returning();

  return updated || null;
}

// Move item to a group (or unassign)
export async function moveItem(tx: DbClient, itemId: number, groupId: number | null, budgetId: number) {
  const existing = await tx.query.budgetItems.findFirst({
    where: eq(budgetItems.id, itemId),
    with: {
      year: true,
    },
  });

  if (!existing || existing.year.budgetId !== budgetId) {
    return null;
  }

  if (groupId) {
    const group = await tx.query.budgetGroups.findFirst({
      where: and(eq(budgetGroups.id, groupId), eq(budgetGroups.budgetId, budgetId)),
    });

    if (!group) {
      return null;
    }

    // Prevent moving items into savings groups
    // Savings items must be created through createSavingsBudgetItems() or createSavingsItemForYear()
    if (group.type === SAVINGS_GROUP_TYPE) {
      throw new Error('Cannot move items into savings groups. Savings items are automatically managed based on savings accounts.');
    }
  }

  const [updated] = await tx
    .update(budgetItems)
    .set({ groupId: groupId || null, updatedAt: new Date() })
    .where(eq(budgetItems.id, itemId))
    .returning();

  return updated || null;
}

// Delete an item
export async function deleteItem(tx: DbClient, id: number, budgetId: number): Promise<boolean> {
  const existing = await tx.query.budgetItems.findFirst({
    where: eq(budgetItems.id, id),
    with: {
      year: true,
    },
  });

  if (!existing || existing.year.budgetId !== budgetId) {
    return false;
  }

  await tx.delete(budgetItems).where(eq(budgetItems.id, id));
  return true;
}

// Update monthly values
export async function updateMonthlyValue(
  tx: DbClient,
  itemId: number,
  month: number,
  data: {
    budget?: number;
    actual?: number;
  },
  budgetId: number
) {
  const item = await tx.query.budgetItems.findFirst({
    where: eq(budgetItems.id, itemId),
    with: {
      year: true,
    },
  });

  if (!item || item.year.budgetId !== budgetId) {
    throw new Error('Item not found or does not belong to your budget');
  }

  const existing = await tx.query.monthlyValues.findFirst({
    where: (mv, { and }) => and(eq(mv.itemId, itemId), eq(mv.month, month)),
  });

  const isCreate = !existing;
  const budgetValue = data.budget?.toString() ?? existing?.budget ?? '0';
  const actualValue = data.actual?.toString() ?? existing?.actual ?? '0';

  const [result] = await tx
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

// ============ SAVINGS CATEGORY MANAGEMENT ============

export async function getOrCreateSavingsGroup(tx: DbClient, budgetId: number): Promise<number> {
  const existingGroup = await tx.query.budgetGroups.findFirst({
    where: and(eq(budgetGroups.budgetId, budgetId), eq(budgetGroups.slug, SAVINGS_GROUP_SLUG)),
  });

  if (existingGroup) {
    return existingGroup.id;
  }

  const [newGroup] = await tx
    .insert(budgetGroups)
    .values({
      budgetId,
      name: SAVINGS_GROUP_NAME,
      slug: SAVINGS_GROUP_SLUG,
      type: SAVINGS_GROUP_TYPE,
      sortOrder: SAVINGS_SORT_ORDER,
    })
    .returning();

  return newGroup.id;
}

export async function createSavingsBudgetItems(
  tx: DbClient,
  savingsAccountId: number,
  savingsAccountName: string,
  savingsAccountInstitution: string | null,
  budgetId: number
): Promise<Map<number, number>> {
  const groupId = await getOrCreateSavingsGroup(tx, budgetId);

  const years = await tx.query.budgetYears.findMany({
    where: eq(budgetYears.budgetId, budgetId),
  });

  const itemName = savingsAccountInstitution
    ? `${savingsAccountName} (${savingsAccountInstitution})`
    : savingsAccountName;
  const itemSlug = `savings-${savingsAccountId}`;

  const createdItems = new Map<number, number>();

  for (const year of years) {
    const existingItem = await tx.query.budgetItems.findFirst({
      where: and(eq(budgetItems.yearId, year.id), eq(budgetItems.savingsAccountId, savingsAccountId)),
    });

    if (existingItem) {
      createdItems.set(year.id, existingItem.id);
      continue;
    }

    const [newItem] = await tx
      .insert(budgetItems)
      .values({
        yearId: year.id,
        groupId,
        name: itemName,
        slug: itemSlug,
        sortOrder: 0,
        savingsAccountId,
      })
      .returning();

    const monthlyData = Array(12)
      .fill(null)
      .map((_, i) => ({
        itemId: newItem.id,
        month: i + 1,
        budget: '0',
        actual: '0',
      }));
    await tx.insert(monthlyValues).values(monthlyData);

    createdItems.set(year.id, newItem.id);
  }

  return createdItems;
}

export async function deleteSavingsBudgetItems(tx: DbClient, savingsAccountId: number): Promise<void> {
  await tx.delete(budgetItems).where(eq(budgetItems.savingsAccountId, savingsAccountId));
}

export async function updateSavingsBudgetItemsName(
  tx: DbClient,
  savingsAccountId: number,
  newName: string,
  newInstitution: string | null
): Promise<void> {
  const itemName = newInstitution ? `${newName} (${newInstitution})` : newName;

  await tx
    .update(budgetItems)
    .set({ name: itemName, updatedAt: new Date() })
    .where(eq(budgetItems.savingsAccountId, savingsAccountId));
}

export async function createSavingsItemForYear(
  tx: DbClient,
  yearId: number,
  savingsAccountId: number,
  savingsAccountName: string,
  savingsAccountInstitution: string | null,
  budgetId: number
): Promise<number> {
  const groupId = await getOrCreateSavingsGroup(tx, budgetId);

  const itemName = savingsAccountInstitution
    ? `${savingsAccountName} (${savingsAccountInstitution})`
    : savingsAccountName;
  const itemSlug = `savings-${savingsAccountId}`;

  const [newItem] = await tx
    .insert(budgetItems)
    .values({
      yearId,
      groupId,
      name: itemName,
      slug: itemSlug,
      sortOrder: 0,
      savingsAccountId,
    })
    .returning();

  const monthlyData = Array(12)
    .fill(null)
    .map((_, i) => ({
      itemId: newItem.id,
      month: i + 1,
      budget: '0',
      actual: '0',
    }));
  await tx.insert(monthlyValues).values(monthlyData);

  return newItem.id;
}
