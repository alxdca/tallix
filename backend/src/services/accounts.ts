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
import { ACCOUNT_TYPES, type AccountType } from '../types/accounts.js';

export { ACCOUNT_TYPES, type AccountType } from '../types/accounts.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface Account {
  id: string; // unique identifier: "savings_item_123" or "payment_method_456"
  type: AccountType;
  accountId: number;
  name: string;
  sortOrder: number;
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
  const accounts: Account[] = [];

  // 1. Get all savings items (items in savings groups), ordered by group sortOrder then item sortOrder
  const savingsItems = await db
    .select({
      id: budgetItems.id,
      name: budgetItems.name,
      sortOrder: budgetItems.sortOrder,
      groupName: budgetGroups.name,
      groupSortOrder: budgetGroups.sortOrder,
    })
    .from(budgetItems)
    .innerJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
    .where(and(eq(budgetItems.yearId, yearId), eq(budgetGroups.type, 'savings')))
    .orderBy(asc(budgetGroups.sortOrder), asc(budgetItems.sortOrder));

  // 2. Get all payment methods (we need all to know which are linked)
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

  // 3. Get initial balances for all accounts
  const balances = await db.select().from(accountBalances).where(eq(accountBalances.yearId, yearId));

  // Use Decimal for precise balance calculations
  const balanceMap = new Map<string, Decimal>();
  for (const b of balances) {
    balanceMap.set(`${b.accountType}_${b.accountId}`, new Decimal(b.initialBalance));
  }

  // 4. Calculate monthly transaction totals for savings items
  // Uses accountingMonth AND accountingYear for consistency - this ensures that
  // late-December transactions with settlement days that push them to January
  // are correctly attributed to the next year's budget, not the current year.
  const savingsTransactions = await db
    .select({
      itemId: transactions.itemId,
      month: transactions.accountingMonth,
      total: sql<string>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .innerJoin(budgetItems, eq(transactions.itemId, budgetItems.id))
    .innerJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
    .where(
      and(eq(transactions.yearId, yearId), eq(transactions.accountingYear, year), eq(budgetGroups.type, 'savings'))
    )
    .groupBy(transactions.itemId, transactions.accountingMonth);

  // 5. Calculate monthly transaction totals for payment method accounts
  // Use accountingMonth AND accountingYear (based on settlement day) instead of raw date
  // This ensures year boundaries are handled correctly.
  // For account balance:
  // - Income transactions ADD to balance (money received)
  // - Expense/savings transactions SUBTRACT from balance (money spent)
  // - If no category, treat as expense (most common case)
  const pmTransactions = await db
    .select({
      paymentMethod: transactions.paymentMethod,
      month: transactions.accountingMonth,
      // Net effect on balance: income adds, expense/savings subtracts
      // Amount sign matters: positive expense = spend (subtract), negative expense = refund (add)
      balanceChange: sql<string>`SUM(
        CASE 
          WHEN ${budgetGroups.type} = 'income' THEN ${transactions.amount}
          WHEN ${budgetGroups.type} IN ('expense', 'savings') THEN -${transactions.amount}
          ELSE -${transactions.amount}
        END
      )`,
    })
    .from(transactions)
    .leftJoin(budgetItems, eq(transactions.itemId, budgetItems.id))
    .leftJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
    .where(and(eq(transactions.yearId, yearId), eq(transactions.accountingYear, year)))
    .groupBy(transactions.paymentMethod, transactions.accountingMonth);

  // 6. Get all transfers for balance adjustment
  // Filter by accountingYear to handle year boundaries correctly
  const allTransfers = await db
    .select()
    .from(transfers)
    .where(and(eq(transfers.yearId, yearId), eq(transfers.accountingYear, year)));

  // Build transfer impact maps using Decimal: accountKey -> month -> { incoming, outgoing }
  const transferImpact = new Map<string, Map<number, { incoming: Decimal; outgoing: Decimal }>>();

  for (const t of allTransfers) {
    const amount = new Decimal(t.amount);
    const month = t.accountingMonth;

    // Source account loses money
    const sourceKey = `${t.sourceAccountType}_${t.sourceAccountId}`;
    if (!transferImpact.has(sourceKey)) {
      transferImpact.set(sourceKey, new Map());
    }
    const sourceMonthMap = transferImpact.get(sourceKey)!;
    if (!sourceMonthMap.has(month)) {
      sourceMonthMap.set(month, { incoming: new Decimal(0), outgoing: new Decimal(0) });
    }
    const sourceEntry = sourceMonthMap.get(month)!;
    sourceEntry.outgoing = sourceEntry.outgoing.plus(amount);

    // Destination account gains money
    const destKey = `${t.destinationAccountType}_${t.destinationAccountId}`;
    if (!transferImpact.has(destKey)) {
      transferImpact.set(destKey, new Map());
    }
    const destMonthMap = transferImpact.get(destKey)!;
    if (!destMonthMap.has(month)) {
      destMonthMap.set(month, { incoming: new Decimal(0), outgoing: new Decimal(0) });
    }
    const destEntry = destMonthMap.get(month)!;
    destEntry.incoming = destEntry.incoming.plus(amount);
  }

  // Build savings item accounts using Decimal for precision
  for (const item of savingsItems) {
    const key = `savings_item_${item.id}`;
    const initialBalance = balanceMap.get(key) || new Decimal(0);

    // Calculate cumulative balance per month (transactions + transfers)
    const monthlyTotals = new Map<number, Decimal>();

    // Add transactions
    for (const t of savingsTransactions) {
      if (t.itemId === item.id) {
        const current = monthlyTotals.get(t.month) || new Decimal(0);
        monthlyTotals.set(t.month, current.plus(new Decimal(t.total || '0')));
      }
    }

    // Add transfers
    const itemTransfers = transferImpact.get(key);
    if (itemTransfers) {
      for (const [month, impact] of itemTransfers) {
        const current = monthlyTotals.get(month) || new Decimal(0);
        monthlyTotals.set(month, current.plus(impact.incoming).minus(impact.outgoing));
      }
    }

    const monthlyBalances: number[] = [];
    let cumulative = initialBalance;
    for (let m = 1; m <= 12; m++) {
      const monthTotal = monthlyTotals.get(m) || new Decimal(0);
      cumulative = cumulative.plus(monthTotal);
      monthlyBalances.push(cumulative.toNumber());
    }

    accounts.push({
      id: key,
      type: ACCOUNT_TYPES.SAVINGS_ITEM,
      accountId: item.id,
      name: `${item.groupName} → ${item.name}`,
      sortOrder: item.groupSortOrder * 1000 + item.sortOrder, // Combine group and item sort order
      initialBalance: initialBalance.toNumber(),
      monthlyBalances,
    });
  }

  // Build payment method accounts using Decimal for precision
  for (const pm of paymentMethodAccounts) {
    const key = `payment_method_${pm.id}`;
    const initialBalance = balanceMap.get(key) || new Decimal(0);

    // Get list of payment method names that should affect this account's balance:
    // 1. The account's own name
    // 2. Any payment methods linked to this account
    const affectingMethods = [pm.name, ...(accountLinkedMethods.get(pm.id) || [])];

    // Calculate cumulative balance per month (transactions + transfers) using Decimal
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
    const pmTransfers = transferImpact.get(key);
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
      id: key,
      type: ACCOUNT_TYPES.PAYMENT_METHOD,
      accountId: pm.id,
      name: pm.name,
      sortOrder: pm.sortOrder,
      initialBalance: initialBalance.toNumber(),
      monthlyBalances,
    });
  }

  return accounts;
}

// Set initial balance for an account
// Uses upsert pattern to avoid race conditions under concurrent requests
export async function setAccountBalance(
  year: number,
  accountType: AccountType,
  accountId: number,
  initialBalance: number
): Promise<void> {
  // Get year ID
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });

  if (!budgetYear) {
    throw new Error('Year not found');
  }

  const yearId = budgetYear.id;

  // Use upsert to avoid race conditions
  // Note: Requires unique constraint on (year_id, account_type, account_id) - see migration
  await db
    .insert(accountBalances)
    .values({
      yearId,
      accountType,
      accountId,
      initialBalance: initialBalance.toString(),
    })
    .onConflictDoUpdate({
      target: [accountBalances.yearId, accountBalances.accountType, accountBalances.accountId],
      set: {
        initialBalance: initialBalance.toString(),
        updatedAt: new Date(),
      },
    });
}

// Get payment methods with isAccount flag
export async function getPaymentMethodsWithAccountFlag() {
  const methods = await db.query.paymentMethods.findMany({
    orderBy: (pm, { asc }) => [asc(pm.sortOrder)],
  });

  return methods.map((m) => ({
    id: m.id,
    name: m.name,
    sortOrder: m.sortOrder,
    isAccount: m.isAccount,
  }));
}

// Update payment method isAccount flag
export async function setPaymentMethodAsAccount(id: number, isAccount: boolean): Promise<void> {
  await db.update(paymentMethods).set({ isAccount, updatedAt: new Date() }).where(eq(paymentMethods.id, id));
}
