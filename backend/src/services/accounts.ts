import Decimal from 'decimal.js';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
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

export interface AccountsResponse {
  accounts: Account[];
  lastActiveMonth: number; // 1-12, the last month with any settled transaction/transfer
}

// Get all accounts for a year with their balances
export async function getAccountsForYear(tx: DbClient, year: number, budgetId: number, userId: string): Promise<AccountsResponse> {
  // Get year ID for this budget
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });

  if (!budgetYear) {
    return { accounts: [], lastActiveMonth: 0 };
  }

  const yearId = budgetYear.id;

  // Get all payment methods for this user (we need all to know which are linked)
  // All payment methods are now treated as accounts
  const allPaymentMethods = await tx
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .orderBy(asc(paymentMethods.sortOrder));

  // Use only non-linked payment methods as accounts
  // Linked payment methods (e.g., Twint linked to a checking account) should not appear
  // as separate accounts - their transactions affect the parent account's balance instead
  const paymentMethodAccounts = allPaymentMethods.filter(pm => !pm.linkedPaymentMethodId);

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
  // Note: We filter by accountingYear only, not yearId, because transactions
  // from the previous year can roll over into the current year due to settlement days
  const pmTransactions = await tx
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
    .where(eq(transactions.accountingYear, year))
    .groupBy(transactions.paymentMethodId, transactions.accountingMonth);

  // Savings-category transactions should also increase/decrease the linked savings account
  // (treated like an internal transfer from the payment method to the savings account).
  const savingsCategoryTransactions = await tx
    .select({
      savingsAccountId: budgetItems.savingsAccountId,
      month: transactions.accountingMonth,
      amount: sql<string>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .leftJoin(budgetItems, eq(transactions.itemId, budgetItems.id))
    .leftJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
    .where(
      and(
        eq(transactions.accountingYear, year),
        eq(budgetGroups.type, 'savings'),
        isNotNull(budgetItems.savingsAccountId),
        sql`${transactions.paymentMethodId} <> ${budgetItems.savingsAccountId}`
      )
    )
    .groupBy(budgetItems.savingsAccountId, transactions.accountingMonth);

  const savingsCategoryImpact = new Map<number, Map<number, Decimal>>();
  for (const row of savingsCategoryTransactions) {
    if (!row.savingsAccountId) continue;
    const month = row.month;
    const amount = new Decimal(row.amount || '0');
    if (!savingsCategoryImpact.has(row.savingsAccountId)) {
      savingsCategoryImpact.set(row.savingsAccountId, new Map());
    }
    const monthMap = savingsCategoryImpact.get(row.savingsAccountId)!;
    monthMap.set(month, (monthMap.get(month) || new Decimal(0)).plus(amount));
  }

  // Get all transfers for balance adjustment
  // Note: We filter by accountingYear only, not yearId, for consistency with transactions
  const allTransfers = await tx
    .select()
    .from(transfers)
    .where(eq(transfers.accountingYear, year));

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

    // Get IDs of payment methods that affect this account
    // Include this payment method's ID and any linked payment method IDs
    const affectingMethodIds = [pm.id, ...(accountLinkedMethods.get(pm.id) || []).map(() => pm.id)];
    
    // Also include payment methods that are linked TO this account
    const linkedToThis = allPaymentMethods.filter(m => m.linkedPaymentMethodId === pm.id).map(m => m.id);
    affectingMethodIds.push(...linkedToThis);

    // Calculate cumulative balance per month
    const monthlyTotals = new Map<number, { balanceChange: Decimal; transferIn: Decimal; transferOut: Decimal }>();

    // Initialize
    for (let m = 1; m <= 12; m++) {
      monthlyTotals.set(m, { balanceChange: new Decimal(0), transferIn: new Decimal(0), transferOut: new Decimal(0) });
    }

    // Add transactions (including from linked payment methods)
    for (const t of pmTransactions) {
      if (t.paymentMethodId && affectingMethodIds.includes(t.paymentMethodId)) {
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

    // Add savings-category impacts tied to this savings account
    const savingsImpact = savingsCategoryImpact.get(pm.id);
    if (savingsImpact) {
      for (const [month, amount] of savingsImpact) {
        const existing = monthlyTotals.get(month)!;
        existing.balanceChange = existing.balanceChange.plus(amount);
      }
    }

    const monthlyBalances: number[] = [];
    let cumulative = initialBalance;
    for (let m = 1; m <= 12; m++) {
      const totals = monthlyTotals.get(m)!;
      cumulative = cumulative.plus(totals.balanceChange).plus(totals.transferIn).minus(totals.transferOut);
      monthlyBalances.push(cumulative.toNumber());
    }

    // Build display name: "Name (Institution)" or just "Name" if no institution
    const displayName = pm.institution ? `${pm.name} (${pm.institution})` : pm.name;
    
    accounts.push({
      id: pm.id,
      name: displayName,
      institution: pm.institution,
      sortOrder: pm.sortOrder,
      isAccount: pm.isAccount,
      isSavingsAccount: pm.isSavingsAccount,
      initialBalance: initialBalance.toNumber(),
      monthlyBalances,
    });
  }

  // Calculate last active month (latest month with any transaction or transfer)
  let lastActiveMonth = 0;
  for (const t of pmTransactions) {
    if (t.month > lastActiveMonth) {
      lastActiveMonth = t.month;
    }
  }
  for (const t of allTransfers) {
    if (t.accountingMonth > lastActiveMonth) {
      lastActiveMonth = t.accountingMonth;
    }
  }

  return { accounts, lastActiveMonth };
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

// Update payment method isSavingsAccount flag
// Creates corresponding budget items in the "Savings" category when enabling.
// When disabling, keep items to preserve existing transaction categorization.
export async function setPaymentMethodAsSavingsAccount(
  tx: DbClient,
  id: number,
  isSavingsAccount: boolean,
  userId: string,
  budgetId: number
): Promise<void> {
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
  const updateData: { isSavingsAccount: boolean; isAccount?: boolean; updatedAt: Date; savingsType?: null } = {
    isSavingsAccount,
    updatedAt: new Date(),
  };
  if (isSavingsAccount) {
    updateData.isAccount = true;
  }
  if (!isSavingsAccount) {
    updateData.savingsType = null;
  }
  await tx.update(paymentMethods).set(updateData).where(eq(paymentMethods.id, id));

  if (isSavingsAccount) {
    // Create budget items for this savings account across all years
    await budgetSvc.createSavingsBudgetItems(tx, id, pm.name, pm.institution, budgetId);
  }
}
