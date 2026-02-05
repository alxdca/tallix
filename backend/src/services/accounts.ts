import Decimal from 'decimal.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  accountBalances,
  budgetGroups,
  budgetItems,
  budgetYears,
  paymentMethods,
  transactions,
  transfers,
} from '../db/schema.js';
import type { DbClient } from '../db/index.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface Account {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isAccount: boolean;
  isSavingsAccount: boolean;
  initialBalance: number;
  monthlyBalances: number[]; // Expected balance at end of each month (1-12)
}

// Get all accounts for a year with their balances
export async function getAccountsForYear(tx: DbClient, year: number, budgetId: number, userId: string): Promise<Account[]> {
  // Get year ID for this budget
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });

  if (!budgetYear) {
    return [];
  }

  const yearId = budgetYear.id;

  // Get all payment methods for this user (we need all to know which are linked)
  const allPaymentMethods = await tx
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .orderBy(asc(paymentMethods.sortOrder));

  // Filter to just accounts
  const paymentMethodAccounts = allPaymentMethods.filter((pm) => pm.isAccount);

  // Build reverse map: account ID -> list of payment method names that are linked to it
  const accountLinkedMethods = new Map<number, string[]>();
  for (const pm of allPaymentMethods) {
    if (pm.linkedPaymentMethodId) {
      const existing = accountLinkedMethods.get(pm.linkedPaymentMethodId) || [];
      existing.push(pm.name);
      accountLinkedMethods.set(pm.linkedPaymentMethodId, existing);
    }
  }

  // Get initial balances for all accounts
  const balances = await tx.select().from(accountBalances).where(eq(accountBalances.yearId, yearId));

  // Use Decimal for precise balance calculations
  const balanceMap = new Map<number, Decimal>();
  for (const b of balances) {
    balanceMap.set(b.paymentMethodId, new Decimal(b.initialBalance));
  }

  // Calculate monthly transaction totals for payment method accounts
  const pmTransactions = await tx
    .select({
      paymentMethod: transactions.paymentMethod,
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
    .where(and(eq(transactions.yearId, yearId), eq(transactions.accountingYear, year)))
    .groupBy(transactions.paymentMethod, transactions.accountingMonth);

  // Get all transfers for balance adjustment
  const allTransfers = await tx
    .select()
    .from(transfers)
    .where(and(eq(transfers.yearId, yearId), eq(transfers.accountingYear, year)));

  // Build transfer impact maps: accountId -> month -> { incoming, outgoing }
  const transferImpact = new Map<number, Map<number, { incoming: Decimal; outgoing: Decimal }>>();

  for (const t of allTransfers) {
    const amount = new Decimal(t.amount);
    const month = t.accountingMonth;

    // Source account loses money
    if (!transferImpact.has(t.sourceAccountId)) {
      transferImpact.set(t.sourceAccountId, new Map());
    }
    const sourceMonthMap = transferImpact.get(t.sourceAccountId)!;
    if (!sourceMonthMap.has(month)) {
      sourceMonthMap.set(month, { incoming: new Decimal(0), outgoing: new Decimal(0) });
    }
    sourceMonthMap.get(month)!.outgoing = sourceMonthMap.get(month)!.outgoing.plus(amount);

    // Destination account gains money
    if (!transferImpact.has(t.destinationAccountId)) {
      transferImpact.set(t.destinationAccountId, new Map());
    }
    const destMonthMap = transferImpact.get(t.destinationAccountId)!;
    if (!destMonthMap.has(month)) {
      destMonthMap.set(month, { incoming: new Decimal(0), outgoing: new Decimal(0) });
    }
    destMonthMap.get(month)!.incoming = destMonthMap.get(month)!.incoming.plus(amount);
  }

  // Build account list
  const accounts: Account[] = [];

  for (const pm of paymentMethodAccounts) {
    const initialBalance = balanceMap.get(pm.id) || new Decimal(0);

    const affectingMethods = [pm.name, ...(accountLinkedMethods.get(pm.id) || [])];

    // Calculate cumulative balance per month
    const monthlyTotals = new Map<number, { balanceChange: Decimal; transferIn: Decimal; transferOut: Decimal }>();

    // Initialize
    for (let m = 1; m <= 12; m++) {
      monthlyTotals.set(m, { balanceChange: new Decimal(0), transferIn: new Decimal(0), transferOut: new Decimal(0) });
    }

    // Add transactions (including from linked payment methods)
    for (const t of pmTransactions) {
      if (affectingMethods.includes(t.paymentMethod || '')) {
        const existing = monthlyTotals.get(t.month)!;
        existing.balanceChange = existing.balanceChange.plus(new Decimal(t.balanceChange || '0'));
      }
    }

    // Add transfers
    const pmTransfers = transferImpact.get(pm.id);
    if (pmTransfers) {
      for (const [month, impact] of pmTransfers) {
        const existing = monthlyTotals.get(month)!;
        existing.transferIn = existing.transferIn.plus(impact.incoming);
        existing.transferOut = existing.transferOut.plus(impact.outgoing);
      }
    }

    const monthlyBalances: number[] = [];
    let cumulative = initialBalance;
    for (let m = 1; m <= 12; m++) {
      const totals = monthlyTotals.get(m)!;
      cumulative = cumulative.plus(totals.balanceChange).plus(totals.transferIn).minus(totals.transferOut);
      monthlyBalances.push(cumulative.toNumber());
    }

    accounts.push({
      id: pm.id,
      name: pm.name,
      institution: pm.institution,
      sortOrder: pm.sortOrder,
      isAccount: pm.isAccount,
      isSavingsAccount: pm.isSavingsAccount,
      initialBalance: initialBalance.toNumber(),
      monthlyBalances,
    });
  }

  return accounts;
}

// Set initial balance for an account
export async function setAccountBalance(tx: DbClient, year: number, paymentMethodId: number, initialBalance: number, budgetId: number, userId: string): Promise<void> {
  // Verify payment method belongs to user
  const pm = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, paymentMethodId), eq(paymentMethods.userId, userId)),
  });
  if (!pm) {
    throw new Error('Payment method not found or does not belong to you');
  }

  // Get year ID for this budget
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });

  if (!budgetYear) {
    throw new Error('Year not found');
  }

  const yearId = budgetYear.id;

  // Use upsert to avoid race conditions
  await tx
    .insert(accountBalances)
    .values({
      yearId,
      paymentMethodId,
      initialBalance: initialBalance.toString(),
    })
    .onConflictDoUpdate({
      target: [accountBalances.yearId, accountBalances.paymentMethodId],
      set: {
        initialBalance: initialBalance.toString(),
        updatedAt: new Date(),
      },
    });
}

// Get payment methods with account flags
export async function getPaymentMethodsWithAccountFlag(tx: DbClient, userId: string) {
  const methods = await tx.query.paymentMethods.findMany({
    where: eq(paymentMethods.userId, userId),
    orderBy: (pm, { asc }) => [asc(pm.sortOrder)],
  });

  return methods.map((m) => ({
    id: m.id,
    name: m.name,
    institution: m.institution,
    sortOrder: m.sortOrder,
    isAccount: m.isAccount,
    isSavingsAccount: m.isSavingsAccount,
  }));
}

// Update payment method isAccount flag
export async function setPaymentMethodAsAccount(tx: DbClient, id: number, isAccount: boolean, userId: string): Promise<void> {
  // Verify payment method belongs to user
  const pm = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)),
  });
  if (!pm) {
    throw new Error('Payment method not found or does not belong to you');
  }

  await tx.update(paymentMethods).set({ isAccount, updatedAt: new Date() }).where(eq(paymentMethods.id, id));
}

// Update payment method isSavingsAccount flag
// Also creates/deletes corresponding budget items in the "Savings" category
export async function setPaymentMethodAsSavingsAccount(tx: DbClient, id: number, isSavingsAccount: boolean, userId: string, budgetId: number): Promise<void> {
  // Import here to avoid circular dependency
  const budgetSvc = await import('./budget.js');

  // Verify payment method belongs to user
  const pm = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)),
  });

  if (!pm) {
    throw new Error('Payment method not found or does not belong to you');
  }

  // Update the flag
  await tx.update(paymentMethods).set({ isSavingsAccount, updatedAt: new Date() }).where(eq(paymentMethods.id, id));

  if (isSavingsAccount) {
    // Create budget items for this savings account across all years
    await budgetSvc.createSavingsBudgetItems(tx, id, pm.name, pm.institution, budgetId);
  } else {
    // Delete budget items linked to this savings account
    await budgetSvc.deleteSavingsBudgetItems(tx, id);
  }
}
