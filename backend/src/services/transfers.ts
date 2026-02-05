import { desc, eq, sql } from 'drizzle-orm';
import { budgetYears, db, paymentMethods, transfers } from '../db/index.js';

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
export async function getTransfersForYear(year: number): Promise<Transfer[]> {
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });

  if (!budgetYear) {
    return [];
  }

  const transferRecords = await db
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

  // Batch fetch all payment methods in one query
  const accountMap = new Map<number, { name: string; institution: string | null; isSavingsAccount: boolean }>();
  if (accountIds.size > 0) {
    const pmRecords = await db
      .select({ id: paymentMethods.id, name: paymentMethods.name, institution: paymentMethods.institution, isSavingsAccount: paymentMethods.isSavingsAccount })
      .from(paymentMethods)
      .where(sql`${paymentMethods.id} IN ${[...accountIds]}`);

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

// Parse date string (YYYY-MM-DD) to extract month and year using UTC to avoid timezone issues
function parseDateForAccounting(dateStr: string): { month: number; year: number } {
  // If already in YYYY-MM-DD format, parse directly to avoid timezone shifts
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return {
      month: parseInt(match[2], 10),
      year: parseInt(match[1], 10),
    };
  }
  // Fallback: use Date with UTC methods
  const dateObj = new Date(dateStr);
  return {
    month: dateObj.getUTCMonth() + 1,
    year: dateObj.getUTCFullYear(),
  };
}

// Create a new transfer
export async function createTransfer(year: number, data: CreateTransferData): Promise<Transfer> {
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });

  if (!budgetYear) {
    throw new Error('Year not found');
  }

  // Parse date to determine accounting month/year using UTC
  const dateParsed = parseDateForAccounting(data.date);
  const accountingMonth = data.accountingMonth ?? dateParsed.month;
  const accountingYear = data.accountingYear ?? dateParsed.year;

  const [inserted] = await db
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

  // Fetch account details
  const sourceAccount = await db.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, data.sourceAccountId),
  });
  const destAccount = await db.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, data.destinationAccountId),
  });

  return {
    id: inserted.id,
    date: inserted.date,
    amount: parseFloat(inserted.amount),
    description: inserted.description,
    sourceAccount: {
      id: data.sourceAccountId,
      name: sourceAccount?.name || UNKNOWN_ACCOUNT_NAME,
      institution: sourceAccount?.institution || null,
      isSavingsAccount: sourceAccount?.isSavingsAccount || false,
    },
    destinationAccount: {
      id: data.destinationAccountId,
      name: destAccount?.name || UNKNOWN_ACCOUNT_NAME,
      institution: destAccount?.institution || null,
      isSavingsAccount: destAccount?.isSavingsAccount || false,
    },
    accountingMonth,
    accountingYear,
  };
}

// Delete a transfer
export async function deleteTransfer(id: number): Promise<boolean> {
  const result = await db.delete(transfers).where(eq(transfers.id, id)).returning();
  return result.length > 0;
}

// Update a transfer
export async function updateTransfer(id: number, data: Partial<CreateTransferData>): Promise<Transfer | null> {
  const existing = await db.query.transfers.findFirst({
    where: eq(transfers.id, id),
  });

  if (!existing) {
    return null;
  }

  // Build update object
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (data.date !== undefined) updates.date = data.date;
  if (data.amount !== undefined) updates.amount = data.amount.toString();
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.sourceAccountId !== undefined) updates.sourceAccountId = data.sourceAccountId;
  if (data.destinationAccountId !== undefined) updates.destinationAccountId = data.destinationAccountId;

  // Handle accounting period
  if (data.accountingMonth !== undefined) {
    updates.accountingMonth = data.accountingMonth;
  }
  if (data.accountingYear !== undefined) {
    updates.accountingYear = data.accountingYear;
  }

  // Recalculate accounting period if date changed but no explicit accounting values provided
  if (data.date !== undefined && data.accountingMonth === undefined && data.accountingYear === undefined) {
    const dateParsed = parseDateForAccounting(data.date);
    updates.accountingMonth = dateParsed.month;
    updates.accountingYear = dateParsed.year;
  }

  const [updated] = await db.update(transfers).set(updates).where(eq(transfers.id, id)).returning();

  // Fetch account details
  const sourceAccount = await db.query.paymentMethods.findFirst({
    where: eq(paymentMethods.id, updated.sourceAccountId),
  });
  const destAccount = await db.query.paymentMethods.findFirst({
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
export async function getAvailableAccounts(): Promise<AccountIdentifier[]> {
  // Get payment methods that are accounts
  const paymentMethodAccounts = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.isAccount, true))
    .orderBy(paymentMethods.sortOrder);

  return paymentMethodAccounts.map((pm) => ({
    id: pm.id,
    name: pm.name,
    institution: pm.institution,
    isSavingsAccount: pm.isSavingsAccount,
  }));
}
