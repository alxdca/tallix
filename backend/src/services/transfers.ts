import { and, desc, eq, sql } from 'drizzle-orm';
import { budgetGroups, budgetItems, budgetYears, db, paymentMethods, transfers } from '../db/index.js';
import type { AccountType } from '../types/accounts.js';

export { ACCOUNT_TYPES, type AccountType } from '../types/accounts.js';

// Constant for unknown account names
const UNKNOWN_ACCOUNT_NAME = 'Unknown';

export interface AccountIdentifier {
  type: AccountType;
  id: number;
  name: string;
}

export interface Transfer {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  sourceAccount: AccountIdentifier;
  destinationAccount: AccountIdentifier;
  savingsItemId: number | null;
  savingsItemName: string | null;
  accountingMonth: number;
  accountingYear: number;
}

export interface CreateTransferData {
  date: string;
  amount: number;
  description?: string;
  sourceAccountType: AccountType;
  sourceAccountId: number;
  destinationAccountType: AccountType;
  destinationAccountId: number;
  accountingMonth?: number;
  accountingYear?: number;
}

// Helper to get account name
async function getAccountName(type: AccountType, id: number): Promise<string> {
  if (type === 'payment_method') {
    const pm = await db.query.paymentMethods.findFirst({
      where: eq(paymentMethods.id, id),
    });
    return pm?.name || UNKNOWN_ACCOUNT_NAME;
  } else {
    const item = await db.query.budgetItems.findFirst({
      where: eq(budgetItems.id, id),
      with: { group: true },
    });
    if (item?.group) {
      return `${item.group.name} → ${item.name}`;
    }
    return item?.name || UNKNOWN_ACCOUNT_NAME;
  }
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

  // Collect all unique account IDs by type for batch fetching
  const paymentMethodIds = new Set<number>();
  const savingsItemIds = new Set<number>();

  for (const t of transferRecords) {
    if (t.sourceAccountType === 'payment_method') {
      paymentMethodIds.add(t.sourceAccountId);
    } else {
      savingsItemIds.add(t.sourceAccountId);
    }
    if (t.destinationAccountType === 'payment_method') {
      paymentMethodIds.add(t.destinationAccountId);
    } else {
      savingsItemIds.add(t.destinationAccountId);
    }
    if (t.savingsItemId) {
      savingsItemIds.add(t.savingsItemId);
    }
  }

  // Batch fetch all payment methods in one query
  const paymentMethodNames = new Map<number, string>();
  if (paymentMethodIds.size > 0) {
    const pmRecords = await db
      .select({ id: paymentMethods.id, name: paymentMethods.name })
      .from(paymentMethods)
      .where(sql`${paymentMethods.id} IN ${[...paymentMethodIds]}`);

    for (const pm of pmRecords) {
      paymentMethodNames.set(pm.id, pm.name);
    }
  }

  // Batch fetch all savings items (budget items) in one query
  const savingsItemNamesMap = new Map<number, string>();
  if (savingsItemIds.size > 0) {
    const itemRecords = await db
      .select({
        id: budgetItems.id,
        name: budgetItems.name,
        groupName: budgetGroups.name,
      })
      .from(budgetItems)
      .leftJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
      .where(sql`${budgetItems.id} IN ${[...savingsItemIds]}`);

    for (const item of itemRecords) {
      const fullName = item.groupName ? `${item.groupName} → ${item.name}` : item.name;
      savingsItemNamesMap.set(item.id, fullName);
    }
  }

  // Helper to get account name from the pre-fetched maps
  const getAccountNameFromMaps = (type: string, id: number): string => {
    if (type === 'payment_method') {
      return paymentMethodNames.get(id) || UNKNOWN_ACCOUNT_NAME;
    }
    return savingsItemNamesMap.get(id) || UNKNOWN_ACCOUNT_NAME;
  };

  return transferRecords.map((t) => ({
    id: t.id,
    date: t.date,
    amount: parseFloat(t.amount),
    description: t.description,
    sourceAccount: {
      type: t.sourceAccountType as AccountType,
      id: t.sourceAccountId,
      name: getAccountNameFromMaps(t.sourceAccountType, t.sourceAccountId),
    },
    destinationAccount: {
      type: t.destinationAccountType as AccountType,
      id: t.destinationAccountId,
      name: getAccountNameFromMaps(t.destinationAccountType, t.destinationAccountId),
    },
    savingsItemId: t.savingsItemId,
    savingsItemName: t.savingsItemId ? savingsItemNamesMap.get(t.savingsItemId) || null : null,
    accountingMonth: t.accountingMonth,
    accountingYear: t.accountingYear,
  }));
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

  // Determine savingsItemId: if destination is a savings item, link to it
  let savingsItemId: number | null = null;
  if (data.destinationAccountType === 'savings_item') {
    savingsItemId = data.destinationAccountId;
  } else if (data.sourceAccountType === 'savings_item') {
    savingsItemId = data.sourceAccountId;
  }

  const [inserted] = await db
    .insert(transfers)
    .values({
      yearId: budgetYear.id,
      date: data.date,
      amount: data.amount.toString(),
      description: data.description || null,
      sourceAccountType: data.sourceAccountType,
      sourceAccountId: data.sourceAccountId,
      destinationAccountType: data.destinationAccountType,
      destinationAccountId: data.destinationAccountId,
      savingsItemId,
      accountingMonth,
      accountingYear,
    })
    .returning();

  const sourceAccountName = await getAccountName(data.sourceAccountType, data.sourceAccountId);
  const destAccountName = await getAccountName(data.destinationAccountType, data.destinationAccountId);

  let savingsItemName: string | null = null;
  if (savingsItemId) {
    const item = await db.query.budgetItems.findFirst({
      where: eq(budgetItems.id, savingsItemId),
      with: { group: true },
    });
    if (item?.group) {
      savingsItemName = `${item.group.name} → ${item.name}`;
    }
  }

  return {
    id: inserted.id,
    date: inserted.date,
    amount: parseFloat(inserted.amount),
    description: inserted.description,
    sourceAccount: {
      type: data.sourceAccountType,
      id: data.sourceAccountId,
      name: sourceAccountName,
    },
    destinationAccount: {
      type: data.destinationAccountType,
      id: data.destinationAccountId,
      name: destAccountName,
    },
    savingsItemId,
    savingsItemName,
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
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (data.date !== undefined) updates.date = data.date;
  if (data.amount !== undefined) updates.amount = data.amount.toString();
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.sourceAccountType !== undefined) updates.sourceAccountType = data.sourceAccountType;
  if (data.sourceAccountId !== undefined) updates.sourceAccountId = data.sourceAccountId;
  if (data.destinationAccountType !== undefined) updates.destinationAccountType = data.destinationAccountType;
  if (data.destinationAccountId !== undefined) updates.destinationAccountId = data.destinationAccountId;

  // Handle accounting period: if explicit values provided, use them
  // Otherwise, recalculate if date changed
  if (data.accountingMonth !== undefined) {
    updates.accountingMonth = data.accountingMonth;
  }
  if (data.accountingYear !== undefined) {
    updates.accountingYear = data.accountingYear;
  }

  // Recalculate accounting period if date changed but no explicit accounting values provided
  // Use UTC parsing to avoid timezone shifts
  if (data.date !== undefined && data.accountingMonth === undefined && data.accountingYear === undefined) {
    const dateParsed = parseDateForAccounting(data.date);
    updates.accountingMonth = dateParsed.month;
    updates.accountingYear = dateParsed.year;
  }

  // Update savingsItemId based on source/destination
  const srcType = data.sourceAccountType ?? existing.sourceAccountType;
  const srcId = data.sourceAccountId ?? existing.sourceAccountId;
  const dstType = data.destinationAccountType ?? existing.destinationAccountType;
  const dstId = data.destinationAccountId ?? existing.destinationAccountId;

  if (dstType === 'savings_item') {
    updates.savingsItemId = dstId;
  } else if (srcType === 'savings_item') {
    updates.savingsItemId = srcId;
  } else {
    updates.savingsItemId = null;
  }

  const [updated] = await db.update(transfers).set(updates).where(eq(transfers.id, id)).returning();

  // Fetch names for response
  const sourceAccountName = await getAccountName(updated.sourceAccountType as AccountType, updated.sourceAccountId);
  const destAccountName = await getAccountName(
    updated.destinationAccountType as AccountType,
    updated.destinationAccountId
  );

  let savingsItemName: string | null = null;
  if (updated.savingsItemId) {
    const item = await db.query.budgetItems.findFirst({
      where: eq(budgetItems.id, updated.savingsItemId),
      with: { group: true },
    });
    if (item?.group) {
      savingsItemName = `${item.group.name} → ${item.name}`;
    }
  }

  return {
    id: updated.id,
    date: updated.date,
    amount: parseFloat(updated.amount),
    description: updated.description,
    sourceAccount: {
      type: updated.sourceAccountType as AccountType,
      id: updated.sourceAccountId,
      name: sourceAccountName,
    },
    destinationAccount: {
      type: updated.destinationAccountType as AccountType,
      id: updated.destinationAccountId,
      name: destAccountName,
    },
    savingsItemId: updated.savingsItemId,
    savingsItemName,
    accountingMonth: updated.accountingMonth,
    accountingYear: updated.accountingYear,
  };
}

// Get available accounts for transfer UI
export async function getAvailableAccounts(year: number): Promise<AccountIdentifier[]> {
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });

  if (!budgetYear) {
    return [];
  }

  const accounts: AccountIdentifier[] = [];

  // Get payment methods that are accounts
  const paymentMethodAccounts = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.isAccount, true))
    .orderBy(paymentMethods.sortOrder);

  for (const pm of paymentMethodAccounts) {
    accounts.push({
      type: 'payment_method',
      id: pm.id,
      name: pm.name,
    });
  }

  // Get savings items
  const savingsItems = await db
    .select({
      id: budgetItems.id,
      name: budgetItems.name,
      groupName: budgetGroups.name,
    })
    .from(budgetItems)
    .innerJoin(budgetGroups, eq(budgetItems.groupId, budgetGroups.id))
    .where(and(eq(budgetItems.yearId, budgetYear.id), eq(budgetGroups.type, 'savings')))
    .orderBy(budgetGroups.sortOrder, budgetItems.sortOrder);

  for (const item of savingsItems) {
    accounts.push({
      type: 'savings_item',
      id: item.id,
      name: `${item.groupName} → ${item.name}`,
    });
  }

  return accounts;
}
