import { and, desc, eq, sql } from 'drizzle-orm';
import { budgetYears, paymentMethods, transfers } from '../db/schema.js';
import type { DbClient } from '../db/index.js';

// Constant for unknown account names
const UNKNOWN_ACCOUNT_NAME = 'Unknown';

export interface AccountIdentifier {
  id: number;
  name: string;
  institution: string | null;
  isSavingsAccount: boolean;
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
}

export interface CreateTransferData {
  date: string;
  amount: number;
  description?: string;
  sourceAccountId: number;
  destinationAccountId: number;
  accountingMonth?: number;
  accountingYear?: number;
}

// Get all transfers for a year
export async function getTransfersForYear(tx: DbClient, year: number, budgetId: number, userId: string): Promise<Transfer[]> {
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
  const accountMap = new Map<number, { name: string; institution: string | null; isSavingsAccount: boolean }>();
  if (accountIds.size > 0) {
    const pmRecords = await tx
      .select({
        id: paymentMethods.id,
        name: paymentMethods.name,
        institution: paymentMethods.institution,
        isSavingsAccount: paymentMethods.isSavingsAccount,
      })
      .from(paymentMethods)
      .where(sql`${paymentMethods.id} IN ${[...accountIds]} AND ${paymentMethods.userId} = ${userId}`);

    for (const pm of pmRecords) {
      accountMap.set(pm.id, { name: pm.name, institution: pm.institution, isSavingsAccount: pm.isSavingsAccount });
    }
  }

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
      },
      destinationAccount: {
        id: t.destinationAccountId,
        name: dest?.name || UNKNOWN_ACCOUNT_NAME,
        institution: dest?.institution || null,
        isSavingsAccount: dest?.isSavingsAccount || false,
      },
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
    };
  });
}

// Parse date string (YYYY-MM-DD) to extract month and year
function parseDateForAccounting(dateStr: string): { month: number; year: number } {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return {
      month: parseInt(match[2], 10),
      year: parseInt(match[1], 10),
    };
  }
  const dateObj = new Date(dateStr);
  return {
    month: dateObj.getUTCMonth() + 1,
    year: dateObj.getUTCFullYear(),
  };
}

// Create a new transfer
export async function createTransfer(tx: DbClient, year: number, data: CreateTransferData, budgetId: number, userId: string): Promise<Transfer> {
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

  const dateParsed = parseDateForAccounting(data.date);
  const accountingMonth = data.accountingMonth ?? dateParsed.month;
  const accountingYear = data.accountingYear ?? dateParsed.year;

  const [inserted] = await tx
    .insert(transfers)
    .values({
      yearId: budgetYear.id,
      date: data.date,
      amount: data.amount.toString(),
      description: data.description || null,
      sourceAccountId: data.sourceAccountId,
      destinationAccountId: data.destinationAccountId,
      accountingMonth,
      accountingYear,
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
    },
    destinationAccount: {
      id: data.destinationAccountId,
      name: destAccount.name,
      institution: destAccount.institution,
      isSavingsAccount: destAccount.isSavingsAccount,
    },
    accountingMonth,
    accountingYear,
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

  const result = await tx.delete(transfers).where(eq(transfers.id, id)).returning();
  return result.length > 0;
}

// Update a transfer
export async function updateTransfer(tx: DbClient, id: number, data: Partial<CreateTransferData>, budgetId: number, userId: string): Promise<Transfer | null> {
  const existing = await tx.query.transfers.findFirst({
    where: eq(transfers.id, id),
    with: {
      year: true,
    },
  });

  if (!existing || existing.year.budgetId !== budgetId) {
    return null;
  }

  // If updating accounts, verify they belong to the user
  if (data.sourceAccountId !== undefined) {
    const sourceAccount = await tx.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, data.sourceAccountId), eq(paymentMethods.userId, userId)),
    });
    if (!sourceAccount) {
      throw new Error('Source account not found or does not belong to you');
    }
  }
  if (data.destinationAccountId !== undefined) {
    const destAccount = await tx.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, data.destinationAccountId), eq(paymentMethods.userId, userId)),
    });
    if (!destAccount) {
      throw new Error('Destination account not found or does not belong to you');
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (data.date !== undefined) updates.date = data.date;
  if (data.amount !== undefined) updates.amount = data.amount.toString();
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.sourceAccountId !== undefined) updates.sourceAccountId = data.sourceAccountId;
  if (data.destinationAccountId !== undefined) updates.destinationAccountId = data.destinationAccountId;

  if (data.accountingMonth !== undefined) {
    updates.accountingMonth = data.accountingMonth;
  }
  if (data.accountingYear !== undefined) {
    updates.accountingYear = data.accountingYear;
  }

  if (data.date !== undefined && data.accountingMonth === undefined && data.accountingYear === undefined) {
    const dateParsed = parseDateForAccounting(data.date);
    updates.accountingMonth = dateParsed.month;
    updates.accountingYear = dateParsed.year;
  }

  const [updated] = await tx.update(transfers).set(updates).where(eq(transfers.id, id)).returning();

  // Fetch account details
  const sourceAccount = await tx.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, updated.sourceAccountId),
  });
  const destAccount = await tx.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, updated.destinationAccountId),
  });

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
    },
    destinationAccount: {
      id: updated.destinationAccountId,
      name: destAccount?.name || UNKNOWN_ACCOUNT_NAME,
      institution: destAccount?.institution || null,
      isSavingsAccount: destAccount?.isSavingsAccount || false,
    },
    accountingMonth: updated.accountingMonth,
    accountingYear: updated.accountingYear,
  };
}

// Get available accounts for transfer UI
export async function getAvailableAccounts(tx: DbClient, userId: string): Promise<AccountIdentifier[]> {
  const paymentMethodAccounts = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.isAccount, true), eq(paymentMethods.userId, userId)))
    .orderBy(paymentMethods.sortOrder);

  return paymentMethodAccounts.map((pm) => ({
    id: pm.id,
    name: pm.name,
    institution: pm.institution,
    isSavingsAccount: pm.isSavingsAccount,
  }));
}
