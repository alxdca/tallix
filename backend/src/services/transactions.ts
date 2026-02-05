import { eq, desc, sql, isNotNull } from 'drizzle-orm';
import { db, transactions, budgetYears } from '../db/index.js';
import { getOrCreateUnclassifiedItem } from './budget.js';
import { getPaymentMethodByName } from './paymentMethods.js';
import type { GroupType } from '../types.js';

// Types for database query results
interface TransactionWithRelations {
  id: number;
  yearId: number;
  itemId: number | null;
  date: string;
  description: string | null;
  comment: string | null;
  thirdParty: string | null;
  paymentMethod: string | null;
  amount: string;
  accountingMonth: number;
  accountingYear: number;
  item?: {
    name: string;
    group?: {
      name: string;
      type: GroupType;
    } | null;
  } | null;
}

// Format date to YYYY-MM-DD
// Treats dates as plain strings to avoid timezone shifts
function formatDate(date: string | Date): string {
  if (typeof date === 'string') {
    // If already YYYY-MM-DD format, return as-is
    const isoMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      return isoMatch[1];
    }
  }
  // For Date objects, use UTC methods to avoid timezone shift
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Calculate accounting month and year based on transaction date and settlement day
// settlementDay: the day of month when billing cycle starts (1-31)
// e.g., settlementDay=18 means transactions from 18th of month N to 17th of month N+1 are billed in month N+1
// Uses UTC to avoid timezone-related date shifts
export function calculateAccountingPeriod(
  transactionDate: string | Date,
  settlementDay: number | null
): { accountingMonth: number; accountingYear: number } {
  // Parse YYYY-MM-DD string directly to avoid timezone issues
  if (typeof transactionDate === 'string') {
    const match = transactionDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      let month = parseInt(match[2], 10); // 1-12
      const day = parseInt(match[3], 10);

      // If no settlement day or day is before settlement day, use the transaction's month
      if (settlementDay === null || day < settlementDay) {
        return { accountingMonth: month, accountingYear: year };
      }

      // Day is on or after settlement day, so it goes to next month
      month++;
      if (month > 12) {
        return { accountingMonth: 1, accountingYear: year + 1 };
      }
      return { accountingMonth: month, accountingYear: year };
    }
  }

  // Fallback: use Date with UTC methods to avoid timezone shifts
  const d = new Date(transactionDate);
  const day = d.getUTCDate();
  let month = d.getUTCMonth() + 1; // 1-12
  let year = d.getUTCFullYear();

  // If no settlement day or day is before settlement day, use the transaction's month
  if (settlementDay === null || day < settlementDay) {
    return { accountingMonth: month, accountingYear: year };
  }

  // Day is on or after settlement day, so it goes to next month
  month++;
  if (month > 12) {
    month = 1;
    year++;
  }

  return { accountingMonth: month, accountingYear: year };
}

// Format transaction for response
function formatTransaction(t: TransactionWithRelations) {
  const groupType = t.item?.group?.type || 'expense';
  return {
    id: t.id,
    date: formatDate(t.date),
    description: t.description,
    comment: t.comment,
    thirdParty: t.thirdParty,
    paymentMethod: t.paymentMethod,
    amount: parseFloat(t.amount),
    itemId: t.itemId,
    itemName: t.item?.name || null,
    groupName: t.item?.group?.name || null,
    groupType,
    accountingMonth: t.accountingMonth,
    accountingYear: t.accountingYear,
  };
}

// Get year ID by year number
async function getYearId(year: number): Promise<number | null> {
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });
  return budgetYear?.id ?? null;
}

// Get all transactions for a year
export async function getTransactionsForYear(year: number) {
  const yearId = await getYearId(year);
  if (!yearId) return [];

  const allTransactions = await db.query.transactions.findMany({
    where: eq(transactions.yearId, yearId),
    orderBy: [desc(transactions.date), desc(transactions.id)],
    with: {
      item: {
        with: {
          group: true,
        },
      },
    },
  });

  return allTransactions.map(formatTransaction);
}

// Create a new transaction
export async function createTransaction(data: {
  yearId: number;
  itemId?: number | null;
  date: string;
  description?: string;
  comment?: string;
  thirdParty?: string;
  paymentMethod: string;
  amount: number;
  accountingMonth?: number;
  accountingYear?: number;
}) {
  // If no itemId provided, use the unclassified category
  let itemId = data.itemId;
  if (!itemId) {
    itemId = await getOrCreateUnclassifiedItem(data.yearId);
  }

  // Calculate accounting period if not provided
  let accountingMonth = data.accountingMonth;
  let accountingYear = data.accountingYear;
  
  if (accountingMonth === undefined || accountingYear === undefined) {
    // Look up payment method's settlement day
    const pm = await getPaymentMethodByName(data.paymentMethod);
    const settlementDay = pm?.settlementDay ?? null;
    const accounting = calculateAccountingPeriod(data.date, settlementDay);
    accountingMonth = accountingMonth ?? accounting.accountingMonth;
    accountingYear = accountingYear ?? accounting.accountingYear;
  }

  const [newTransaction] = await db.insert(transactions).values({
    yearId: data.yearId,
    itemId,
    date: data.date,
    description: data.description || null,
    comment: data.comment || null,
    thirdParty: data.thirdParty || null,
    paymentMethod: data.paymentMethod,
    amount: data.amount.toString(),
    accountingMonth,
    accountingYear,
  }).returning();

  return {
    id: newTransaction.id,
    date: formatDate(newTransaction.date),
    description: newTransaction.description,
    comment: newTransaction.comment,
    thirdParty: newTransaction.thirdParty,
    paymentMethod: newTransaction.paymentMethod,
    amount: parseFloat(newTransaction.amount),
    itemId: newTransaction.itemId,
    accountingMonth: newTransaction.accountingMonth,
    accountingYear: newTransaction.accountingYear,
  };
}

// Update a transaction
export async function updateTransaction(id: number, data: {
  itemId?: number | null;
  date?: string;
  description?: string;
  comment?: string;
  thirdParty?: string;
  paymentMethod?: string;
  amount?: number;
  accountingMonth?: number;
  accountingYear?: number;
  recalculateAccounting?: boolean; // If true, recalculate based on date/payment method
}) {
  const updateData: Partial<{
    itemId: number | null;
    date: string;
    description: string | null;
    comment: string | null;
    thirdParty: string | null;
    paymentMethod: string | null;
    amount: string;
    accountingMonth: number;
    accountingYear: number;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  
  if (data.itemId !== undefined) updateData.itemId = data.itemId || null;
  if (data.date !== undefined) updateData.date = data.date;
  if (data.description !== undefined) updateData.description = data.description || null;
  if (data.comment !== undefined) updateData.comment = data.comment || null;
  if (data.thirdParty !== undefined) updateData.thirdParty = data.thirdParty || null;
  if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod || null;
  if (data.amount !== undefined) updateData.amount = data.amount.toString();
  
  // Handle accounting period
  if (data.accountingMonth !== undefined) updateData.accountingMonth = data.accountingMonth;
  if (data.accountingYear !== undefined) updateData.accountingYear = data.accountingYear;
  
  // Recalculate accounting period if requested or if date/payment method changed without explicit accounting values
  if (data.recalculateAccounting || 
      ((data.date !== undefined || data.paymentMethod !== undefined) && 
       data.accountingMonth === undefined && data.accountingYear === undefined)) {
    // Need to get current transaction to know date and payment method
    const current = await db.query.transactions.findFirst({
      where: eq(transactions.id, id),
    });
    if (current) {
      const date = data.date ?? current.date;
      const paymentMethodName = data.paymentMethod ?? current.paymentMethod;
      const pm = paymentMethodName ? await getPaymentMethodByName(paymentMethodName) : null;
      const settlementDay = pm?.settlementDay ?? null;
      const accounting = calculateAccountingPeriod(date, settlementDay);
      updateData.accountingMonth = accounting.accountingMonth;
      updateData.accountingYear = accounting.accountingYear;
    }
  }

  const [updated] = await db.update(transactions)
    .set(updateData)
    .where(eq(transactions.id, id))
    .returning();

  if (!updated) return null;

  return {
    id: updated.id,
    date: formatDate(updated.date),
    description: updated.description,
    thirdParty: updated.thirdParty,
    paymentMethod: updated.paymentMethod,
    amount: parseFloat(updated.amount),
    itemId: updated.itemId,
    accountingMonth: updated.accountingMonth,
    accountingYear: updated.accountingYear,
  };
}

// Delete a transaction
// Returns true if transaction was deleted, false if it didn't exist
export async function deleteTransaction(id: number): Promise<boolean> {
  const result = await db.delete(transactions)
    .where(eq(transactions.id, id))
    .returning({ id: transactions.id });
  
  return result.length > 0;
}

// Bulk delete transactions
export async function bulkDeleteTransactions(ids: number[]) {
  if (ids.length === 0) {
    return { deleted: 0 };
  }

  const result = await db.delete(transactions)
    .where(sql`${transactions.id} IN ${ids}`)
    .returning({ id: transactions.id });

  return {
    deleted: result.length,
  };
}

// Get distinct third parties for autocomplete
export async function getThirdParties(search?: string): Promise<string[]> {
  const baseQuery = db
    .select({
      thirdParty: transactions.thirdParty,
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(transactions)
    .where(isNotNull(transactions.thirdParty))
    .groupBy(transactions.thirdParty)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(50);

  if (search && search.trim()) {
    const results = await db
      .select({
        thirdParty: transactions.thirdParty,
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(transactions)
      .where(
        sql`${transactions.thirdParty} IS NOT NULL AND ${transactions.thirdParty} ILIKE ${`%${search}%`}`
      )
      .groupBy(transactions.thirdParty)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(20);

    return results
      .map(r => r.thirdParty)
      .filter((tp): tp is string => tp !== null);
  }

  const results = await baseQuery;
  return results
    .map(r => r.thirdParty)
    .filter((tp): tp is string => tp !== null);
}

// Bulk create transactions
export async function bulkCreateTransactions(
  yearId: number,
  transactionsData: Array<{
    date: string;
    description?: string;
    comment?: string;
    thirdParty?: string;
    paymentMethod: string;
    amount: number;
    itemId?: number | null;
    accountingMonth?: number;
    accountingYear?: number;
  }>
) {
  if (transactionsData.length === 0) {
    return { created: 0, transactions: [] };
  }

  // Get unclassified item ID for transactions without a category
  let unclassifiedItemId: number | null = null;
  const needsUnclassified = transactionsData.some(t => !t.itemId);
  if (needsUnclassified) {
    unclassifiedItemId = await getOrCreateUnclassifiedItem(yearId);
  }

  // Get all unique payment methods and their settlement days
  const uniquePaymentMethods = [...new Set(transactionsData.map(t => t.paymentMethod))];
  const paymentMethodSettlements = new Map<string, number | null>();
  
  for (const pmName of uniquePaymentMethods) {
    const pm = await getPaymentMethodByName(pmName);
    paymentMethodSettlements.set(pmName, pm?.settlementDay ?? null);
  }

  const inserted = await db.insert(transactions).values(
    transactionsData.map(t => {
      // Use provided accounting period or calculate it
      let accountingMonth = t.accountingMonth;
      let accountingYear = t.accountingYear;
      
      if (accountingMonth === undefined || accountingYear === undefined) {
        const settlementDay = paymentMethodSettlements.get(t.paymentMethod) ?? null;
        const accounting = calculateAccountingPeriod(t.date, settlementDay);
        accountingMonth = accountingMonth ?? accounting.accountingMonth;
        accountingYear = accountingYear ?? accounting.accountingYear;
      }
      
      return {
        yearId,
        itemId: t.itemId || unclassifiedItemId!,
        date: t.date,
        description: t.description || null,
        comment: t.comment || null,
        thirdParty: t.thirdParty || null,
        paymentMethod: t.paymentMethod,
        amount: t.amount.toString(),
        accountingMonth,
        accountingYear,
      };
    })
  ).returning();

  return {
    created: inserted.length,
    transactions: inserted.map(t => ({
      id: t.id,
      date: t.date,
      amount: parseFloat(t.amount),
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
    })),
  };
}
