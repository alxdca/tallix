import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { budgetItems, budgetYears, entryOrderOverrides, paymentMethods, transactions, transfers } from '../db/schema.js';
import type { DbClient } from '../db/index.js';
import { getOrCreateUnclassifiedItem } from './budget.js';

export const PAYMENT_METHOD_OWNERSHIP_ERROR = 'Payment method not found or does not belong to you';

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
  warning: string | null;
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

// Detect if a transaction is a potential duplicate
async function detectPotentialDuplicate(
  tx: DbClient,
  budgetId: number,
  data: {
    date: string;
    thirdParty?: string | null;
    amount: number;
    excludeId?: number; // Exclude this transaction ID from duplicate check (for updates)
  }
): Promise<boolean> {
  // Only check for duplicates if thirdParty is provided and non-empty
  const thirdParty = data.thirdParty?.trim();
  if (!thirdParty) {
    return false;
  }

  // Parse transaction date
  const transactionDate = new Date(data.date);
  if (Number.isNaN(transactionDate.getTime())) {
    return false;
  }

  // Calculate date range: ±1 day
  const oneDayMs = 24 * 60 * 60 * 1000;
  const minDate = new Date(transactionDate.getTime() - oneDayMs);
  const maxDate = new Date(transactionDate.getTime() + oneDayMs);

  // Format dates as YYYY-MM-DD for SQL comparison
  const minDateStr = formatDate(minDate);
  const maxDateStr = formatDate(maxDate);

  // Calculate amount range: ±5%
  const amount = Math.abs(data.amount);
  const minAmount = amount * 0.95;
  const maxAmount = amount * 1.05;

  // Query for potential duplicates
  // Match: same third party (case-insensitive), date within ±1 day, amount within ±5%
  const duplicates = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(budgetYears, eq(transactions.yearId, budgetYears.id))
    .where(
      and(
        eq(budgetYears.budgetId, budgetId),
        sql`LOWER(TRIM(${transactions.thirdParty})) = LOWER(${thirdParty})`,
        sql`${transactions.date} >= ${minDateStr}`,
        sql`${transactions.date} <= ${maxDateStr}`,
        sql`ABS(${transactions.amount}::numeric) >= ${minAmount}`,
        sql`ABS(${transactions.amount}::numeric) <= ${maxAmount}`,
        data.excludeId ? sql`${transactions.id} != ${data.excludeId}` : sql`TRUE`
      )
    )
    .limit(1);

  return duplicates.length > 0;
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
    warning: t.warning,
  };
}

// Get year ID by year number
async function getYearId(tx: DbClient, year: number, budgetId: number): Promise<number | null> {
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });
  return budgetYear?.id ?? null;
}

async function getOwnedPaymentMethodOrThrow(tx: DbClient, userId: string, paymentMethodId: number) {
  const paymentMethod = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, paymentMethodId), eq(paymentMethods.userId, userId)),
  });

  if (!paymentMethod) {
    throw new Error(PAYMENT_METHOD_OWNERSHIP_ERROR);
  }

  return paymentMethod;
}

export async function getEntryOrderOffsetMap(
  tx: DbClient,
  yearId: number,
  entryType: 'transaction' | 'transfer'
): Promise<Map<number, number | null>> {
  try {
    const rows = await tx.query.entryOrderOverrides.findMany({
      where: and(eq(entryOrderOverrides.yearId, yearId), eq(entryOrderOverrides.entryType, entryType)),
    });

    return new Map(rows.map((row) => [row.entryId, row.sortOffset]));
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error && typeof error.cause === 'object' && error.cause !== null
        ? (error.cause as { code?: string }).code
        : undefined;

    if (code === '42P01') {
      return new Map();
    }

    throw error;
  }
}

async function getOwnedEntriesForPriorityUpdate(
  tx: DbClient,
  entries: { type: 'transaction' | 'transfer'; id: number; sortPriority: number | null }[],
  budgetId: number
) {
  const transactionIds = entries.filter((entry) => entry.type === 'transaction').map((entry) => entry.id);
  const transferIds = entries.filter((entry) => entry.type === 'transfer').map((entry) => entry.id);
  const entryYearMap = new Map<string, number>();
  const entryDateMap = new Map<string, string>();

  if (transactionIds.length > 0) {
    const ownedTransactions = await tx.query.transactions.findMany({
      where: inArray(transactions.id, transactionIds),
      with: {
        year: true,
      },
    });

    if (
      ownedTransactions.length !== transactionIds.length ||
      ownedTransactions.some((transaction) => transaction.year.budgetId !== budgetId)
    ) {
      throw new Error('Some transactions were not found in the current budget');
    }

    for (const transaction of ownedTransactions) {
      entryYearMap.set(`transaction:${transaction.id}`, transaction.yearId);
      entryDateMap.set(`transaction:${transaction.id}`, formatDate(transaction.date));
    }
  }

  if (transferIds.length > 0) {
    const ownedTransfers = await tx.query.transfers.findMany({
      where: inArray(transfers.id, transferIds),
      with: {
        year: true,
      },
    });

    if (ownedTransfers.length !== transferIds.length || ownedTransfers.some((transfer) => transfer.year.budgetId !== budgetId)) {
      throw new Error('Some transfers were not found in the current budget');
    }

    for (const transfer of ownedTransfers) {
      entryYearMap.set(`transfer:${transfer.id}`, transfer.yearId);
      entryDateMap.set(`transfer:${transfer.id}`, formatDate(transfer.date));
    }
  }

  return { entryYearMap, entryDateMap };
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

  const orderOffsetMap = await getEntryOrderOffsetMap(tx, yearId, 'transaction');

  return (allTransactions as unknown as TransactionWithRelations[]).map((transaction) => ({
    ...formatTransaction(transaction),
    sortPriority: orderOffsetMap.get(transaction.id) ?? null,
  }));
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

  const paymentMethod = await getOwnedPaymentMethodOrThrow(tx, userId, data.paymentMethodId);

  let accountingMonth = data.accountingMonth;
  let accountingYear = data.accountingYear;

  if (accountingMonth === undefined || accountingYear === undefined) {
    const settlementDay = paymentMethod.settlementDay ?? null;
    const accounting = calculateAccountingPeriod(data.date, settlementDay);
    accountingMonth = accountingMonth ?? accounting.accountingMonth;
    accountingYear = accountingYear ?? accounting.accountingYear;
  }

  // Detect potential duplicates
  const isPotentialDuplicate = await detectPotentialDuplicate(tx, budgetId, {
    date: data.date,
    thirdParty: data.thirdParty,
    amount: data.amount,
  });

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
      warning: isPotentialDuplicate ? 'potential_duplicate' : null,
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
    sortPriority: null,
    warning: newTransaction.warning,
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
    warning?: string | null;
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

  const requestedPaymentMethod =
    data.paymentMethodId !== undefined ? await getOwnedPaymentMethodOrThrow(tx, userId, data.paymentMethodId) : null;

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
    warning: string | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (data.itemId !== undefined) updateData.itemId = data.itemId || null;
  if (data.date !== undefined) updateData.date = data.date;
  if (data.description !== undefined) updateData.description = data.description || null;
  if (data.comment !== undefined) updateData.comment = data.comment || null;
  if (data.thirdParty !== undefined) updateData.thirdParty = data.thirdParty || null;
  if (data.paymentMethodId !== undefined) updateData.paymentMethodId = data.paymentMethodId;
  if (data.amount !== undefined) updateData.amount = data.amount.toString();
  if (data.warning !== undefined) updateData.warning = data.warning;

  if (data.accountingMonth !== undefined) updateData.accountingMonth = data.accountingMonth;
  if (data.accountingYear !== undefined) updateData.accountingYear = data.accountingYear;

  if (
    data.recalculateAccounting ||
    ((data.date !== undefined || data.paymentMethodId !== undefined) &&
      data.accountingMonth === undefined &&
      data.accountingYear === undefined)
  ) {
    const date = data.date ?? transaction.date;
    const paymentMethod = requestedPaymentMethod ?? (await getOwnedPaymentMethodOrThrow(tx, userId, transaction.paymentMethodId));
    const settlementDay = paymentMethod.settlementDay ?? null;
    const accounting = calculateAccountingPeriod(date, settlementDay);
    updateData.accountingMonth = accounting.accountingMonth;
    updateData.accountingYear = accounting.accountingYear;
  }

  const [updated] = await tx
    .update(transactions)
    .set(updateData)
    .where(and(eq(transactions.id, id), eq(transactions.yearId, transaction.yearId)))
    .returning();

  if (!updated) return null;

  // Get payment method for display name
  const pm = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, updated.paymentMethodId), eq(paymentMethods.userId, userId)),
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
    sortPriority: null,
  };
}

export async function reorderEntries(
  tx: DbClient,
  entries: { type: 'transaction' | 'transfer'; id: number; sortPriority: number | null }[],
  budgetId: number
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const { entryYearMap, entryDateMap } = await getOwnedEntriesForPriorityUpdate(tx, entries, budgetId);
  const yearIds = new Set(entries.map((entry) => entryYearMap.get(`${entry.type}:${entry.id}`)).filter((yearId): yearId is number => yearId !== undefined));
  const dates = new Set(entries.map((entry) => entryDateMap.get(`${entry.type}:${entry.id}`)).filter((date): date is string => date !== undefined));

  if (yearIds.size > 1) {
    throw new Error('Entries from multiple years cannot be reordered together');
  }

  if (dates.size > 1) {
    throw new Error('Entries can only be reordered within the same date');
  }

  const [yearId] = [...yearIds];
  if (!yearId) {
    throw new Error('Reorder payload references unknown entries');
  }

  try {
    for (const entry of entries) {
      const normalizedPriority =
        entry.sortPriority === null || entry.sortPriority === 0 ? null : Math.trunc(entry.sortPriority);

      if (normalizedPriority === null) {
        await tx
          .delete(entryOrderOverrides)
          .where(
            and(
              eq(entryOrderOverrides.yearId, yearId),
              eq(entryOrderOverrides.entryType, entry.type),
              eq(entryOrderOverrides.entryId, entry.id)
            )
          );
        continue;
      }

      await tx
        .insert(entryOrderOverrides)
        .values({
          yearId,
          entryType: entry.type,
          entryId: entry.id,
          sortOffset: normalizedPriority,
        })
        .onConflictDoUpdate({
          target: [entryOrderOverrides.yearId, entryOrderOverrides.entryType, entryOrderOverrides.entryId],
          set: {
            sortOffset: normalizedPriority,
            updatedAt: new Date(),
          },
        });
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error && typeof error.cause === 'object' && error.cause !== null
        ? (error.cause as { code?: string }).code
        : undefined;

    if (code === '42P01') {
      throw new Error('Transaction order persistence is unavailable until migration 0029 is applied');
    }

    throw error;
  }
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

  const result = await tx
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.yearId, transaction.yearId)))
    .returning({ id: transactions.id });
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

  // Detect duplicates for each transaction
  const duplicateFlags = await Promise.all(
    transactionsData.map((t) =>
      detectPotentialDuplicate(tx, budgetId, {
        date: t.date,
        thirdParty: t.thirdParty,
        amount: t.amount,
      })
    )
  );

  const inserted = await tx
    .insert(transactions)
    .values(
      transactionsData.map((t, index) => {
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
          warning: duplicateFlags[index] ? 'potential_duplicate' : null,
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
      warning: t.warning,
    })),
  };
}
