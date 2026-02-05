import Decimal from 'decimal.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  accountBalances,
  budgetGroups,
  budgetItems,
  budgetYears,
  db,
  paymentMethods,
  transactions,
  transfers,
} from '../db/index.js';

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
export async function getAccountsForYear(year: number): Promise<Account[]> {
  // Get year ID
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });

  if (!budgetYear) {
    return [];
  }

  const yearId = budgetYear.id;

  // Get all payment methods (we need all to know which are linked)
  const allPaymentMethods = await db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder));

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
  const balances = await db.select().from(accountBalances).where(eq(accountBalances.yearId, yearId));

  // Use Decimal for precise balance calculations
  const balanceMap = new Map<number, Decimal>();
  for (const b of balances) {
    balanceMap.set(b.paymentMethodId, new Decimal(b.initialBalance));
  }

  // Calculate monthly transaction totals for payment method accounts
  // Use accountingMonth AND accountingYear (based on settlement day) instead of raw date
  // For account balance:
  // - Income transactions ADD to balance (money received)
  // - Expense transactions SUBTRACT from balance (money spent)
  // - If no category, treat as expense (most common case)
  const pmTransactions = await db
    .select({
      paymentMethod: transactions.paymentMethod,
      month: transactions.accountingMonth,
      // Net effect on balance: income adds, expense subtracts
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
  const allTransfers = await db
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

    // Get list of payment method names that should affect this account's balance:
    // 1. The account's own name
    // 2. Any payment methods linked to this account
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
export async function setAccountBalance(year: number, paymentMethodId: number, initialBalance: number): Promise<void> {
  // Get year ID
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });

  if (!budgetYear) {
    throw new Error('Year not found');
  }

  const yearId = budgetYear.id;

  // Use upsert to avoid race conditions
  await db
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
export async function getPaymentMethodsWithAccountFlag() {
  const methods = await db.query.paymentMethods.findMany({
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
export async function setPaymentMethodAsAccount(id: number, isAccount: boolean): Promise<void> {
  await db.update(paymentMethods).set({ isAccount, updatedAt: new Date() }).where(eq(paymentMethods.id, id));
}

// Update payment method isSavingsAccount flag
// Also creates/deletes corresponding budget items in the "Épargne" category
export async function setPaymentMethodAsSavingsAccount(id: number, isSavingsAccount: boolean): Promise<void> {
  // Import here to avoid circular dependency
  const budgetSvc = await import('./budget.js');

  // Get the payment method details
  const pm = await db.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, id),
  });

  if (!pm) {
    throw new Error('Payment method not found');
  }

  // Update the flag
  await db.update(paymentMethods).set({ isSavingsAccount, updatedAt: new Date() }).where(eq(paymentMethods.id, id));

  if (isSavingsAccount) {
    // Create budget items for this savings account across all years
    await budgetSvc.createSavingsBudgetItems(id, pm.name, pm.institution);
  } else {
    // Delete budget items linked to this savings account
    await budgetSvc.deleteSavingsBudgetItems(id);
  }
}
