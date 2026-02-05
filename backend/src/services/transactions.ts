import { and, desc, eq, sql } from 'drizzle-orm';
import { budgetItems, budgetYears, paymentMethods, transactions } from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import { getOrCreateUnclassifiedItem } from './budget.js';

// Types for database query results
interface TransactionWithRelations {
  id: number;
  yearId: number;
  itemId: number | null;
  date: string;
  description: string | null;
  comment: string | null;
  thirdParty: string | null;
  paymentMethodId: number;
  amount: string;
  accountingMonth: number;
  accountingYear: number;
  item?: {
    name: string;
    group?: {
      name: string;
      type: string;
    } | null;
  } | null;
  paymentMethodRel?: {
    id: number;
    name: string;
    institution: string | null;
  } | null;
}

// Format date to YYYY-MM-DD
function formatDate(date: string | Date): string {
  if (typeof date === 'string') {
    const isoMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      return isoMatch[1];
    }
  }
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Calculate accounting month and year based on transaction date and settlement day
export function calculateAccountingPeriod(
  transactionDate: string | Date,
  settlementDay: number | null
): { accountingMonth: number; accountingYear: number } {
  if (typeof transactionDate === 'string') {
    const match = transactionDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      let month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);

      if (settlementDay === null || day < settlementDay) {
        return { accountingMonth: month, accountingYear: year };
      }

      month++;
      if (month > 12) {
        return { accountingMonth: 1, accountingYear: year + 1 };
      }
      return { accountingMonth: month, accountingYear: year };
    }
  }

  const d = new Date(transactionDate);
  const day = d.getUTCDate();
  let month = d.getUTCMonth() + 1;
  let year = d.getUTCFullYear();

  if (settlementDay === null || day < settlementDay) {
    return { accountingMonth: month, accountingYear: year };
  }

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
  // Build payment method display name: "Name (Institution)" or just "Name"
  const pm = t.paymentMethodRel;
  const paymentMethodName = pm 
    ? (pm.institution ? `${pm.name} (${pm.institution})` : pm.name)
    : null;
  
  return {
    id: t.id,
    date: formatDate(t.date),
    description: t.description,
    comment: t.comment,
    thirdParty: t.thirdParty,
    paymentMethodId: t.paymentMethodId,
    paymentMethod: paymentMethodName,
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
async function getYearId(tx: DbClient, year: number, budgetId: number): Promise<number | null> {
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });
  return budgetYear?.id ?? null;
}

// Get all transactions for a year
export async function getTransactionsForYear(tx: DbClient, year: number, budgetId: number) {
  const yearId = await getYearId(tx, year, budgetId);
  if (!yearId) return [];

  const allTransactions = await tx.query.transactions.findMany({
    where: eq(transactions.yearId, yearId),
    orderBy: [desc(transactions.date), desc(transactions.id)],
    with: {
      item: {
        with: {
          group: true,
        },
      },
      paymentMethodRel: true,
    },
  });

  return (allTransactions as unknown as TransactionWithRelations[]).map(formatTransaction);
}

// Create a new transaction
export async function createTransaction(
  tx: DbClient,
  userId: string,
  budgetId: number,
  data: {
    yearId: number;
    itemId?: number | null;
    date: string;
    description?: string;
    comment?: string;
    thirdParty?: string;
    paymentMethodId: number;
    amount: number;
    accountingMonth?: number;
    accountingYear?: number;
  }
) {
  const year = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.id, data.yearId), eq(budgetYears.budgetId, budgetId)),
  });
  if (!year) {
    throw new Error('Year not found or does not belong to your budget');
  }

  let itemId = data.itemId;
  if (!itemId) {
    itemId = await getOrCreateUnclassifiedItem(tx, data.yearId, budgetId);
  } else {
    const item = await tx.query.budgetItems.findFirst({
      where: eq(budgetItems.id, itemId),
      with: {
        year: true,
      },
    });
    if (!item || item.yearId !== data.yearId || item.year.budgetId !== budgetId) {
      throw new Error('Item not found or does not belong to the specified year and budget');
    }
  }

  let accountingMonth = data.accountingMonth;
  let accountingYear = data.accountingYear;

  if (accountingMonth === undefined || accountingYear === undefined) {
    const pm = await tx.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, data.paymentMethodId), eq(paymentMethods.userId, userId)),
    });
    if (!pm) {
      throw new Error('Payment method not found or does not belong to you');
    }
    const settlementDay = pm.settlementDay ?? null;
    const accounting = calculateAccountingPeriod(data.date, settlementDay);
    accountingMonth = accountingMonth ?? accounting.accountingMonth;
    accountingYear = accountingYear ?? accounting.accountingYear;
  }

  const [newTransaction] = await tx
    .insert(transactions)
    .values({
      yearId: data.yearId,
      itemId,
      date: data.date,
      description: data.description || null,
      comment: data.comment || null,
      thirdParty: data.thirdParty || null,
      paymentMethodId: data.paymentMethodId,
      amount: data.amount.toString(),
      accountingMonth,
      accountingYear,
    })
    .returning();

  return {
    id: newTransaction.id,
    date: formatDate(newTransaction.date),
    description: newTransaction.description,
    comment: newTransaction.comment,
    thirdParty: newTransaction.thirdParty,
    paymentMethodId: newTransaction.paymentMethodId,
    amount: parseFloat(newTransaction.amount),
    itemId: newTransaction.itemId,
    accountingMonth: newTransaction.accountingMonth,
    accountingYear: newTransaction.accountingYear,
  };
}

// Update a transaction
export async function updateTransaction(
  tx: DbClient,
  userId: string,
  budgetId: number,
  id: number,
  data: {
    itemId?: number | null;
    date?: string;
    description?: string;
    comment?: string;
    thirdParty?: string;
    paymentMethodId?: number;
    amount?: number;
    accountingMonth?: number;
    accountingYear?: number;
    recalculateAccounting?: boolean;
  }
) {
  const transaction = await tx.query.transactions.findFirst({
    where: eq(transactions.id, id),
    with: {
      year: true,
    },
  });
  if (!transaction || transaction.year.budgetId !== budgetId) {
    return null;
  }

  if (data.itemId !== undefined && data.itemId !== null) {
    const item = await tx.query.budgetItems.findFirst({
      where: eq(budgetItems.id, data.itemId),
      with: {
        year: true,
      },
    });
    if (!item || item.yearId !== transaction.yearId || item.year.budgetId !== budgetId) {
      throw new Error('Item not found or does not belong to the transaction year and budget');
    }
  }

  const updateData: Partial<{
    itemId: number | null;
    date: string;
    description: string | null;
    comment: string | null;
    thirdParty: string | null;
    paymentMethodId: number;
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
  if (data.paymentMethodId !== undefined) updateData.paymentMethodId = data.paymentMethodId;
  if (data.amount !== undefined) updateData.amount = data.amount.toString();

  if (data.accountingMonth !== undefined) updateData.accountingMonth = data.accountingMonth;
  if (data.accountingYear !== undefined) updateData.accountingYear = data.accountingYear;

  if (
    data.recalculateAccounting ||
    ((data.date !== undefined || data.paymentMethodId !== undefined) &&
      data.accountingMonth === undefined &&
      data.accountingYear === undefined)
  ) {
    const current = await tx.query.transactions.findFirst({
      where: eq(transactions.id, id),
    });
    if (current) {
      const date = data.date ?? current.date;
      const paymentMethodId = data.paymentMethodId ?? current.paymentMethodId;
      const pm = await tx.query.paymentMethods.findFirst({
        where: and(eq(paymentMethods.id, paymentMethodId), eq(paymentMethods.userId, userId)),
      });
      const settlementDay = pm?.settlementDay ?? null;
      const accounting = calculateAccountingPeriod(date, settlementDay);
      updateData.accountingMonth = accounting.accountingMonth;
      updateData.accountingYear = accounting.accountingYear;
    }
  }

  const [updated] = await tx.update(transactions).set(updateData).where(eq(transactions.id, id)).returning();

  if (!updated) return null;

  // Get payment method for display name
  const pm = await tx.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, updated.paymentMethodId),
  });
  const paymentMethodName = pm 
    ? (pm.institution ? `${pm.name} (${pm.institution})` : pm.name)
    : null;

  return {
    id: updated.id,
    date: formatDate(updated.date),
    description: updated.description,
    thirdParty: updated.thirdParty,
    paymentMethodId: updated.paymentMethodId,
    paymentMethod: paymentMethodName,
    amount: parseFloat(updated.amount),
    itemId: updated.itemId,
    accountingMonth: updated.accountingMonth,
    accountingYear: updated.accountingYear,
  };
}

// Delete a transaction
export async function deleteTransaction(tx: DbClient, id: number, budgetId: number): Promise<boolean> {
  const transaction = await tx.query.transactions.findFirst({
    where: eq(transactions.id, id),
    with: {
      year: true,
    },
  });
  if (!transaction || transaction.year.budgetId !== budgetId) {
    return false;
  }

  const result = await tx.delete(transactions).where(eq(transactions.id, id)).returning({ id: transactions.id });
  return result.length > 0;
}

// Bulk delete transactions
export async function bulkDeleteTransactions(tx: DbClient, ids: number[], budgetId: number) {
  if (ids.length === 0) {
    return { deleted: 0 };
  }

  const transactionsToDelete = await tx.query.transactions.findMany({
    where: sql`${transactions.id} IN ${ids}`,
    with: {
      year: true,
    },
  });

  const validIds = transactionsToDelete.filter((t) => t.year.budgetId === budgetId).map((t) => t.id);

  if (validIds.length === 0) {
    return { deleted: 0 };
  }

  const result = await tx
    .delete(transactions)
    .where(sql`${transactions.id} IN ${validIds}`)
    .returning({ id: transactions.id });

  return { deleted: result.length };
}

// Get distinct third parties for autocomplete
export async function getThirdParties(tx: DbClient, search: string | undefined, budgetId: number): Promise<string[]> {
  const budgetCondition = sql`EXISTS (
    SELECT 1 FROM ${budgetYears}
    WHERE ${budgetYears.id} = ${transactions.yearId}
    AND ${budgetYears.budgetId} = ${budgetId}
  )`;

  if (search?.trim()) {
    const results = await tx
      .select({
        thirdParty: transactions.thirdParty,
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(transactions)
      .where(
        sql`${transactions.thirdParty} IS NOT NULL AND ${transactions.thirdParty} ILIKE ${`%${search}%`} AND ${budgetCondition}`
      )
      .groupBy(transactions.thirdParty)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(20);

    return results.map((r) => r.thirdParty).filter((tp): tp is string => tp !== null);
  }

  const results = await tx
    .select({
      thirdParty: transactions.thirdParty,
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(transactions)
    .where(sql`${transactions.thirdParty} IS NOT NULL AND ${budgetCondition}`)
    .groupBy(transactions.thirdParty)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(50);

  return results.map((r) => r.thirdParty).filter((tp): tp is string => tp !== null);
}

// Bulk create transactions
export async function bulkCreateTransactions(
  tx: DbClient,
  userId: string,
  budgetId: number,
  yearId: number,
  transactionsData: Array<{
    date: string;
    description?: string;
    comment?: string;
    thirdParty?: string;
    paymentMethodId: number;
    amount: number;
    itemId?: number | null;
    accountingMonth?: number;
    accountingYear?: number;
  }>
) {
  if (transactionsData.length === 0) {
    return { created: 0, transactions: [] };
  }

  const year = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.id, yearId), eq(budgetYears.budgetId, budgetId)),
  });
  if (!year) {
    throw new Error('Year not found or does not belong to your budget');
  }

  const providedItemIds = transactionsData
    .map((t) => t.itemId)
    .filter((id): id is number => id !== null && id !== undefined);

  if (providedItemIds.length > 0) {
    const uniqueItemIds = [...new Set(providedItemIds)];
    const items = await tx.query.budgetItems.findMany({
      where: sql`${budgetItems.id} IN ${uniqueItemIds}`,
      with: {
        year: true,
      },
    });

    const validItemIds = new Set(
      items.filter((item) => item.yearId === yearId && item.year.budgetId === budgetId).map((item) => item.id)
    );

    const invalidItemIds = uniqueItemIds.filter((id) => !validItemIds.has(id));
    if (invalidItemIds.length > 0) {
      throw new Error(
        `Invalid item IDs: ${invalidItemIds.join(', ')} - items not found or do not belong to the specified year and budget`
      );
    }
  }

  let unclassifiedItemId: number | null = null;
  const needsUnclassified = transactionsData.some((t) => !t.itemId);
  if (needsUnclassified) {
    unclassifiedItemId = await getOrCreateUnclassifiedItem(tx, yearId, budgetId);
  }

  // Get unique payment method IDs and their settlement days
  const uniquePaymentMethodIds = [...new Set(transactionsData.map((t) => t.paymentMethodId))];
  const paymentMethodSettlements = new Map<number, number | null>();

  for (const pmId of uniquePaymentMethodIds) {
    const pm = await tx.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, pmId), eq(paymentMethods.userId, userId)),
    });
    if (!pm) {
      throw new Error(`Payment method ${pmId} not found or does not belong to you`);
    }
    paymentMethodSettlements.set(pmId, pm.settlementDay ?? null);
  }

  const inserted = await tx
    .insert(transactions)
    .values(
      transactionsData.map((t) => {
        let accountingMonth = t.accountingMonth;
        let accountingYear = t.accountingYear;

        if (accountingMonth === undefined || accountingYear === undefined) {
          const settlementDay = paymentMethodSettlements.get(t.paymentMethodId) ?? null;
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
          paymentMethodId: t.paymentMethodId,
          amount: t.amount.toString(),
          accountingMonth,
          accountingYear,
        };
      })
    )
    .returning();

  return {
    created: inserted.length,
    transactions: inserted.map((t) => ({
      id: t.id,
      date: t.date,
      amount: parseFloat(t.amount),
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
    })),
  };
}
