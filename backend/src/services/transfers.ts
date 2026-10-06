import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { budgetYears, paymentMethods, transfers } from '../db/schema.js';
import { calculateAccountingPeriod, getEntryOrderOffsetMap } from './transactions.js';

// Constant for unknown account names
const UNKNOWN_ACCOUNT_NAME = 'Unknown';

export interface AccountIdentifier {
  id: number;
  name: string;
  institution: string | null;
  isSavingsAccount: boolean;
  settlementDay?: number | null;
}

export interface Transfer {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  sourceAccount: AccountIdentifier;
  destinationAccount: AccountIdentifier;
  accountingMonth: number;
  accountingYear: number;
  sourceAccountingMonth: number;
  sourceAccountingYear: number;
  destinationAccountingMonth: number;
  destinationAccountingYear: number;
  sortPriority: number | null;
}

export interface CreateTransferData {
  date: string;
  amount: number;
  description?: string;
  sourceAccountId: number;
  destinationAccountId: number;
  accountingMonth?: number;
  accountingYear?: number;
  sourceAccountingMonth?: number;
  sourceAccountingYear?: number;
  destinationAccountingMonth?: number;
  destinationAccountingYear?: number;
}

type AccountRecord = typeof paymentMethods.$inferSelect;

function assertDifferentAccounts(sourceAccountId: number, destinationAccountId: number): void {
  if (sourceAccountId === destinationAccountId) {
    throw new Error('Source and destination accounts must be different');
  }
}

function assertAccountingPeriod(month: number, year: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Accounting month must be an integer between 1 and 12');
  }
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error('Accounting year must be an integer between 1900 and 9999');
  }
}

function resolveCreatePeriods(data: CreateTransferData, sourceAccount: AccountRecord, destAccount: AccountRecord) {
  const dateDefault = calculateAccountingPeriod(data.date, null);
  const sourceDefault = calculateAccountingPeriod(data.date, sourceAccount.settlementDay ?? null);
  const destinationDefault = calculateAccountingPeriod(data.date, destAccount.settlementDay ?? null);
  const hasLegacyPeriod = data.accountingMonth !== undefined || data.accountingYear !== undefined;

  const sourceAccountingMonth =
    data.sourceAccountingMonth ??
    data.accountingMonth ??
    (hasLegacyPeriod ? dateDefault.accountingMonth : sourceDefault.accountingMonth);
  const sourceAccountingYear =
    data.sourceAccountingYear ??
    data.accountingYear ??
    (hasLegacyPeriod ? dateDefault.accountingYear : sourceDefault.accountingYear);
  const hasDestinationOverride =
    data.destinationAccountingMonth !== undefined || data.destinationAccountingYear !== undefined;
  const destinationAccountingMonth = hasDestinationOverride
    ? (data.destinationAccountingMonth ?? destinationDefault.accountingMonth)
    : (data.accountingMonth ?? (hasLegacyPeriod ? dateDefault.accountingMonth : destinationDefault.accountingMonth));
  const destinationAccountingYear = hasDestinationOverride
    ? (data.destinationAccountingYear ?? destinationDefault.accountingYear)
    : (data.accountingYear ?? (hasLegacyPeriod ? dateDefault.accountingYear : destinationDefault.accountingYear));

  assertAccountingPeriod(sourceAccountingMonth, sourceAccountingYear);
  assertAccountingPeriod(destinationAccountingMonth, destinationAccountingYear);

  return { sourceAccountingMonth, sourceAccountingYear, destinationAccountingMonth, destinationAccountingYear };
}

function destinationPeriod(record: {
  accountingMonth: number;
  accountingYear: number;
  destinationAccountingMonth?: number | null;
  destinationAccountingYear?: number | null;
}) {
  return {
    destinationAccountingMonth: record.destinationAccountingMonth ?? record.accountingMonth,
    destinationAccountingYear: record.destinationAccountingYear ?? record.accountingYear,
  };
}

// Get all transfers for a year
export async function getTransfersForYear(
  tx: DbClient,
  year: number,
  budgetId: number,
  userId: string
): Promise<Transfer[]> {
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });

  if (!budgetYear) {
    return [];
  }

  const transferRecords = await tx
    .select()
    .from(transfers)
    .where(eq(transfers.yearId, budgetYear.id))
    .orderBy(desc(transfers.date), desc(transfers.id));

  if (transferRecords.length === 0) {
    return [];
  }

  // Collect all unique account IDs for batch fetching
  const accountIds = new Set<number>();
  for (const t of transferRecords) {
    accountIds.add(t.sourceAccountId);
    accountIds.add(t.destinationAccountId);
  }

  // Batch fetch all payment methods in one query, filtered by userId for security
  const accountMap = new Map<
    number,
    { name: string; institution: string | null; isSavingsAccount: boolean; settlementDay: number | null }
  >();
  if (accountIds.size > 0) {
    const pmRecords = await tx
      .select({
        id: paymentMethods.id,
        name: paymentMethods.name,
        institution: paymentMethods.institution,
        isSavingsAccount: paymentMethods.isSavingsAccount,
        settlementDay: paymentMethods.settlementDay,
      })
      .from(paymentMethods)
      .where(sql`${paymentMethods.id} IN ${[...accountIds]} AND ${paymentMethods.userId} = ${userId}`);

    for (const pm of pmRecords) {
      accountMap.set(pm.id, {
        name: pm.name,
        institution: pm.institution,
        isSavingsAccount: pm.isSavingsAccount,
        settlementDay: pm.settlementDay,
      });
    }
  }

  const orderOffsetMap = await getEntryOrderOffsetMap(tx, budgetYear.id, 'transfer');

  return transferRecords.map((t) => {
    const source = accountMap.get(t.sourceAccountId);
    const dest = accountMap.get(t.destinationAccountId);

    return {
      id: t.id,
      date: t.date,
      amount: parseFloat(t.amount),
      description: t.description,
      sourceAccount: {
        id: t.sourceAccountId,
        name: source?.name || UNKNOWN_ACCOUNT_NAME,
        institution: source?.institution || null,
        isSavingsAccount: source?.isSavingsAccount || false,
        settlementDay: source?.settlementDay ?? null,
      },
      destinationAccount: {
        id: t.destinationAccountId,
        name: dest?.name || UNKNOWN_ACCOUNT_NAME,
        institution: dest?.institution || null,
        isSavingsAccount: dest?.isSavingsAccount || false,
        settlementDay: dest?.settlementDay ?? null,
      },
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
      sourceAccountingMonth: t.accountingMonth,
      sourceAccountingYear: t.accountingYear,
      ...destinationPeriod(t),
      sortPriority: orderOffsetMap.get(t.id) ?? null,
    };
  });
}

// Create a new transfer
export async function createTransfer(
  tx: DbClient,
  year: number,
  data: CreateTransferData,
  budgetId: number,
  userId: string
): Promise<Transfer> {
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.year, year), eq(budgetYears.budgetId, budgetId)),
  });

  if (!budgetYear) {
    throw new Error('Year not found');
  }

  // Verify both accounts belong to the user
  const sourceAccount = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, data.sourceAccountId), eq(paymentMethods.userId, userId)),
  });
  const destAccount = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, data.destinationAccountId), eq(paymentMethods.userId, userId)),
  });

  if (!sourceAccount || !destAccount) {
    throw new Error('One or both accounts not found or do not belong to you');
  }
  assertDifferentAccounts(data.sourceAccountId, data.destinationAccountId);

  const periods = resolveCreatePeriods(data, sourceAccount, destAccount);

  const [inserted] = await tx
    .insert(transfers)
    .values({
      yearId: budgetYear.id,
      date: data.date,
      amount: data.amount.toString(),
      description: data.description || null,
      sourceAccountId: data.sourceAccountId,
      destinationAccountId: data.destinationAccountId,
      accountingMonth: periods.sourceAccountingMonth,
      accountingYear: periods.sourceAccountingYear,
      destinationAccountingMonth: periods.destinationAccountingMonth,
      destinationAccountingYear: periods.destinationAccountingYear,
    })
    .returning();

  return {
    id: inserted.id,
    date: inserted.date,
    amount: parseFloat(inserted.amount),
    description: inserted.description,
    sourceAccount: {
      id: data.sourceAccountId,
      name: sourceAccount.name,
      institution: sourceAccount.institution,
      isSavingsAccount: sourceAccount.isSavingsAccount,
      settlementDay: sourceAccount.settlementDay,
    },
    destinationAccount: {
      id: data.destinationAccountId,
      name: destAccount.name,
      institution: destAccount.institution,
      isSavingsAccount: destAccount.isSavingsAccount,
      settlementDay: destAccount.settlementDay,
    },
    accountingMonth: inserted.accountingMonth,
    accountingYear: inserted.accountingYear,
    sourceAccountingMonth: inserted.accountingMonth,
    sourceAccountingYear: inserted.accountingYear,
    ...destinationPeriod(inserted),
    sortPriority: null,
  };
}

// Delete a transfer
export async function deleteTransfer(tx: DbClient, id: number, budgetId: number): Promise<boolean> {
  const transfer = await tx.query.transfers.findFirst({
    where: eq(transfers.id, id),
    with: {
      year: true,
    },
  });

  if (!transfer || transfer.year.budgetId !== budgetId) {
    return false;
  }

  const result = await tx
    .delete(transfers)
    .where(and(eq(transfers.id, id), eq(transfers.yearId, transfer.yearId)))
    .returning();
  return result.length > 0;
}

// Update a transfer
export async function updateTransfer(
  tx: DbClient,
  id: number,
  data: Partial<CreateTransferData>,
  budgetId: number,
  userId: string
): Promise<Transfer | null> {
  const existing = await tx.query.transfers.findFirst({
    where: eq(transfers.id, id),
    with: {
      year: true,
    },
  });

  if (!existing || existing.year.budgetId !== budgetId) {
    return null;
  }

  const nextSourceAccountId = data.sourceAccountId ?? existing.sourceAccountId;
  const nextDestinationAccountId = data.destinationAccountId ?? existing.destinationAccountId;
  assertDifferentAccounts(nextSourceAccountId, nextDestinationAccountId);

  // If updating accounts, verify they belong to the user
  const sourceAccount = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, nextSourceAccountId), eq(paymentMethods.userId, userId)),
  });
  if (!sourceAccount) {
    throw new Error('Source account not found or does not belong to you');
  }

  const destAccount = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, nextDestinationAccountId), eq(paymentMethods.userId, userId)),
  });
  if (!destAccount) {
    throw new Error('Destination account not found or does not belong to you');
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (data.date !== undefined) updates.date = data.date;
  if (data.amount !== undefined) updates.amount = data.amount.toString();
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.sourceAccountId !== undefined) updates.sourceAccountId = data.sourceAccountId;
  if (data.destinationAccountId !== undefined) updates.destinationAccountId = data.destinationAccountId;

  const nextDate = data.date ?? existing.date;
  const sourceChanged = nextDate !== existing.date || nextSourceAccountId !== existing.sourceAccountId;
  const destinationChanged = nextDate !== existing.date || nextDestinationAccountId !== existing.destinationAccountId;
  const hasLegacyPeriod = data.accountingMonth !== undefined || data.accountingYear !== undefined;
  const hasSourcePeriod =
    data.sourceAccountingMonth !== undefined || data.sourceAccountingYear !== undefined || hasLegacyPeriod;
  const hasDestinationPeriod =
    data.destinationAccountingMonth !== undefined || data.destinationAccountingYear !== undefined;

  let sourceAccountingMonth = existing.accountingMonth;
  let sourceAccountingYear = existing.accountingYear;
  if (hasSourcePeriod) {
    sourceAccountingMonth = data.sourceAccountingMonth ?? data.accountingMonth ?? sourceAccountingMonth;
    sourceAccountingYear = data.sourceAccountingYear ?? data.accountingYear ?? sourceAccountingYear;
  } else if (sourceChanged) {
    const accounting = calculateAccountingPeriod(nextDate, sourceAccount.settlementDay ?? null);
    sourceAccountingMonth = accounting.accountingMonth;
    sourceAccountingYear = accounting.accountingYear;
  }
  assertAccountingPeriod(sourceAccountingMonth, sourceAccountingYear);
  if (hasSourcePeriod || sourceChanged) {
    updates.accountingMonth = sourceAccountingMonth;
    updates.accountingYear = sourceAccountingYear;
  }

  const existingDestination = destinationPeriod(existing);
  let destinationAccountingMonth = existingDestination.destinationAccountingMonth;
  let destinationAccountingYear = existingDestination.destinationAccountingYear;
  if (hasDestinationPeriod) {
    destinationAccountingMonth = data.destinationAccountingMonth ?? destinationAccountingMonth;
    destinationAccountingYear = data.destinationAccountingYear ?? destinationAccountingYear;
  } else if (hasLegacyPeriod) {
    destinationAccountingMonth = sourceAccountingMonth;
    destinationAccountingYear = sourceAccountingYear;
  } else if (destinationChanged) {
    const accounting = calculateAccountingPeriod(nextDate, destAccount.settlementDay ?? null);
    destinationAccountingMonth = accounting.accountingMonth;
    destinationAccountingYear = accounting.accountingYear;
  }
  assertAccountingPeriod(destinationAccountingMonth, destinationAccountingYear);
  if (hasDestinationPeriod || hasLegacyPeriod || destinationChanged) {
    updates.destinationAccountingMonth = destinationAccountingMonth;
    updates.destinationAccountingYear = destinationAccountingYear;
  }

  const [updated] = await tx
    .update(transfers)
    .set(updates)
    .where(and(eq(transfers.id, id), eq(transfers.yearId, existing.yearId)))
    .returning();

  return {
    id: updated.id,
    date: updated.date,
    amount: parseFloat(updated.amount),
    description: updated.description,
    sourceAccount: {
      id: updated.sourceAccountId,
      name: sourceAccount?.name || UNKNOWN_ACCOUNT_NAME,
      institution: sourceAccount?.institution || null,
      isSavingsAccount: sourceAccount?.isSavingsAccount || false,
      settlementDay: sourceAccount?.settlementDay ?? null,
    },
    destinationAccount: {
      id: updated.destinationAccountId,
      name: destAccount?.name || UNKNOWN_ACCOUNT_NAME,
      institution: destAccount?.institution || null,
      isSavingsAccount: destAccount?.isSavingsAccount || false,
      settlementDay: destAccount?.settlementDay ?? null,
    },
    accountingMonth: updated.accountingMonth,
    accountingYear: updated.accountingYear,
    sourceAccountingMonth: updated.accountingMonth,
    sourceAccountingYear: updated.accountingYear,
    ...destinationPeriod(updated),
    sortPriority: null,
  };
}

// Get available accounts for transfer UI
export async function getAvailableAccounts(tx: DbClient, userId: string): Promise<AccountIdentifier[]> {
  const paymentMethodAccounts = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.userId, userId), isNull(paymentMethods.linkedPaymentMethodId)))
    .orderBy(paymentMethods.sortOrder);

  return paymentMethodAccounts.map((pm) => ({
    id: pm.id,
    name: pm.name,
    institution: pm.institution,
    isSavingsAccount: pm.isSavingsAccount,
    settlementDay: pm.settlementDay,
  }));
}
