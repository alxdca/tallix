import { eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import {
  paymentMethods,
  budgetYears,
  budgetGroups,
  budgetItems,
  monthlyValues,
  transactions,
  assets,
  assetValues,
  transfers,
  accountBalances,
} from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';

// ── Backup payload types ──────────────────────────────────────────────

export interface BackupPaymentMethod {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isSavingsAccount: boolean;
  savingsType: string | null;
  settlementDay: number | null;
  linkedPaymentMethodId: number | null;
}

export interface BackupBudgetYear {
  id: number;
  year: number;
  initialBalance: string;
}

export interface BackupBudgetGroup {
  id: number;
  name: string;
  slug: string;
  type: string;
  sortOrder: number;
}

export interface BackupBudgetItem {
  id: number;
  yearId: number;
  groupId: number | null;
  name: string;
  slug: string;
  sortOrder: number;
  yearlyBudget: string;
  savingsAccountId: number | null;
}

export interface BackupMonthlyValue {
  itemId: number;
  month: number;
  budget: string;
  actual: string;
}

export interface BackupTransaction {
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
}

export interface BackupAsset {
  id: number;
  name: string;
  sortOrder: number;
  isSystem: boolean;
  isDebt: boolean;
  parentAssetId: number | null;
  savingsType: string | null;
}

export interface BackupAssetValue {
  assetId: number;
  yearId: number;
  value: string;
}

export interface BackupTransfer {
  yearId: number;
  date: string;
  amount: string;
  description: string | null;
  sourceAccountId: number;
  destinationAccountId: number;
  accountingMonth: number;
  accountingYear: number;
}

export interface BackupAccountBalance {
  yearId: number;
  paymentMethodId: number;
  initialBalance: string;
}

export interface BackupPayload {
  schemaVersion: 1;
  exportedAt: string;
  paymentMethods: BackupPaymentMethod[];
  budgetYears: BackupBudgetYear[];
  budgetGroups: BackupBudgetGroup[];
  budgetItems: BackupBudgetItem[];
  monthlyValues: BackupMonthlyValue[];
  transactions: BackupTransaction[];
  assets: BackupAsset[];
  assetValues: BackupAssetValue[];
  transfers: BackupTransfer[];
  accountBalances: BackupAccountBalance[];
}

export interface ImportSummary {
  paymentMethods: number;
  budgetYears: number;
  budgetGroups: number;
  budgetItems: number;
  monthlyValues: number;
  transactions: number;
  assets: number;
  assetValues: number;
  transfers: number;
  accountBalances: number;
}

// ── Export ─────────────────────────────────────────────────────────────

export async function exportBackup(
  tx: DbClient,
  userId: string,
  budgetId: number
): Promise<BackupPayload> {
  // Payment methods (user-scoped)
  const pms = await tx
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .orderBy(paymentMethods.sortOrder);

  // Budget years
  const years = await tx
    .select()
    .from(budgetYears)
    .where(eq(budgetYears.budgetId, budgetId))
    .orderBy(budgetYears.year);

  const yearIds = years.map((y) => y.id);

  // Budget groups
  const groups = await tx
    .select()
    .from(budgetGroups)
    .where(eq(budgetGroups.budgetId, budgetId))
    .orderBy(budgetGroups.sortOrder);

  // Budget items (for all years)
  const items =
    yearIds.length > 0
      ? await tx
          .select()
          .from(budgetItems)
          .where(inArray(budgetItems.yearId, yearIds))
          .orderBy(budgetItems.sortOrder)
      : [];

  const itemIds = items.map((i) => i.id);

  // Monthly values
  const mvs =
    itemIds.length > 0
      ? await tx
          .select()
          .from(monthlyValues)
          .where(inArray(monthlyValues.itemId, itemIds))
      : [];

  // Transactions
  const txns =
    yearIds.length > 0
      ? await tx
          .select()
          .from(transactions)
          .where(inArray(transactions.yearId, yearIds))
      : [];

  // Assets
  const assetRows = await tx
    .select()
    .from(assets)
    .where(eq(assets.budgetId, budgetId))
    .orderBy(assets.sortOrder);

  const assetIds = assetRows.map((a) => a.id);

  // Asset values
  const avs =
    assetIds.length > 0
      ? await tx
          .select()
          .from(assetValues)
          .where(inArray(assetValues.assetId, assetIds))
      : [];

  // Transfers
  const xfers =
    yearIds.length > 0
      ? await tx
          .select()
          .from(transfers)
          .where(inArray(transfers.yearId, yearIds))
      : [];

  // Account balances
  const balances =
    yearIds.length > 0
      ? await tx
          .select()
          .from(accountBalances)
          .where(inArray(accountBalances.yearId, yearIds))
      : [];

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    paymentMethods: pms.map((pm) => ({
      id: pm.id,
      name: pm.name,
      institution: pm.institution,
      sortOrder: pm.sortOrder,
      isSavingsAccount: pm.isSavingsAccount,
      savingsType: pm.savingsType,
      settlementDay: pm.settlementDay,
      linkedPaymentMethodId: pm.linkedPaymentMethodId,
    })),
    budgetYears: years.map((y) => ({
      id: y.id,
      year: y.year,
      initialBalance: y.initialBalance,
    })),
    budgetGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      type: g.type,
      sortOrder: g.sortOrder,
    })),
    budgetItems: items.map((i) => ({
      id: i.id,
      yearId: i.yearId,
      groupId: i.groupId,
      name: i.name,
      slug: i.slug,
      sortOrder: i.sortOrder,
      yearlyBudget: i.yearlyBudget,
      savingsAccountId: i.savingsAccountId,
    })),
    monthlyValues: mvs.map((mv) => ({
      itemId: mv.itemId,
      month: mv.month,
      budget: mv.budget,
      actual: mv.actual,
    })),
    transactions: txns.map((t) => ({
      yearId: t.yearId,
      itemId: t.itemId,
      date: t.date,
      description: t.description,
      comment: t.comment,
      thirdParty: t.thirdParty,
      paymentMethodId: t.paymentMethodId,
      amount: t.amount,
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
      warning: t.warning,
    })),
    assets: assetRows.map((a) => ({
      id: a.id,
      name: a.name,
      sortOrder: a.sortOrder,
      isSystem: a.isSystem,
      isDebt: a.isDebt,
      parentAssetId: a.parentAssetId,
      savingsType: a.savingsType,
    })),
    assetValues: avs.map((av) => ({
      assetId: av.assetId,
      yearId: av.yearId,
      value: av.value,
    })),
    transfers: xfers.map((xf) => ({
      yearId: xf.yearId,
      date: xf.date,
      amount: xf.amount,
      description: xf.description,
      sourceAccountId: xf.sourceAccountId,
      destinationAccountId: xf.destinationAccountId,
      accountingMonth: xf.accountingMonth,
      accountingYear: xf.accountingYear,
    })),
    accountBalances: balances.map((ab) => ({
      yearId: ab.yearId,
      paymentMethodId: ab.paymentMethodId,
      initialBalance: ab.initialBalance,
    })),
  };
}

// ── Validation ────────────────────────────────────────────────────────

export function validateBackupPayload(payload: unknown): asserts payload is BackupPayload {
  if (!payload || typeof payload !== 'object') {
    throw new AppError(400, 'Invalid backup payload');
  }
  const p = payload as Record<string, unknown>;

  if (p.schemaVersion !== 1) {
    throw new AppError(400, `Unsupported backup schema version: ${p.schemaVersion}. Expected: 1`, {
      code: 'BACKUP_UNSUPPORTED_VERSION',
    });
  }

  const requiredArrays = [
    'paymentMethods',
    'budgetYears',
    'budgetGroups',
    'budgetItems',
    'monthlyValues',
    'transactions',
    'assets',
    'assetValues',
    'transfers',
    'accountBalances',
  ] as const;

  for (const key of requiredArrays) {
    if (!Array.isArray(p[key])) {
      throw new AppError(400, `Missing or invalid "${key}" array in backup payload`, {
        code: 'BACKUP_INVALID_SCHEMA',
      });
    }
  }

  // Validate internal referential integrity
  const pmIds = new Set((p.paymentMethods as BackupPaymentMethod[]).map((pm) => pm.id));
  const yearIds = new Set((p.budgetYears as BackupBudgetYear[]).map((y) => y.id));
  const groupIds = new Set((p.budgetGroups as BackupBudgetGroup[]).map((g) => g.id));
  const itemIds = new Set((p.budgetItems as BackupBudgetItem[]).map((i) => i.id));
  const assetIds = new Set((p.assets as BackupAsset[]).map((a) => a.id));

  for (const item of p.budgetItems as BackupBudgetItem[]) {
    if (!yearIds.has(item.yearId)) {
      throw new AppError(400, `Budget item "${item.name}" references unknown year backup ID: ${item.yearId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (item.groupId !== null && !groupIds.has(item.groupId)) {
      throw new AppError(400, `Budget item "${item.name}" references unknown group backup ID: ${item.groupId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (item.savingsAccountId !== null && !pmIds.has(item.savingsAccountId)) {
      throw new AppError(400, `Budget item "${item.name}" references unknown payment method backup ID: ${item.savingsAccountId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const mv of p.monthlyValues as BackupMonthlyValue[]) {
    if (!itemIds.has(mv.itemId)) {
      throw new AppError(400, `Monthly value references unknown item backup ID: ${mv.itemId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const t of p.transactions as BackupTransaction[]) {
    if (!yearIds.has(t.yearId)) {
      throw new AppError(400, `Transaction references unknown year backup ID: ${t.yearId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (t.itemId !== null && !itemIds.has(t.itemId)) {
      throw new AppError(400, `Transaction references unknown item backup ID: ${t.itemId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (!pmIds.has(t.paymentMethodId)) {
      throw new AppError(400, `Transaction references unknown payment method backup ID: ${t.paymentMethodId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const av of p.assetValues as BackupAssetValue[]) {
    if (!assetIds.has(av.assetId)) {
      throw new AppError(400, `Asset value references unknown asset backup ID: ${av.assetId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (!yearIds.has(av.yearId)) {
      throw new AppError(400, `Asset value references unknown year backup ID: ${av.yearId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const xf of p.transfers as BackupTransfer[]) {
    if (!yearIds.has(xf.yearId)) {
      throw new AppError(400, `Transfer references unknown year backup ID: ${xf.yearId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (!pmIds.has(xf.sourceAccountId)) {
      throw new AppError(400, `Transfer references unknown source account backup ID: ${xf.sourceAccountId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (!pmIds.has(xf.destinationAccountId)) {
      throw new AppError(400, `Transfer references unknown destination account backup ID: ${xf.destinationAccountId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const ab of p.accountBalances as BackupAccountBalance[]) {
    if (!yearIds.has(ab.yearId)) {
      throw new AppError(400, `Account balance references unknown year backup ID: ${ab.yearId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
    if (!pmIds.has(ab.paymentMethodId)) {
      throw new AppError(400, `Account balance references unknown payment method backup ID: ${ab.paymentMethodId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const a of p.assets as BackupAsset[]) {
    if (a.parentAssetId !== null && !assetIds.has(a.parentAssetId)) {
      throw new AppError(400, `Asset "${a.name}" references unknown parent asset backup ID: ${a.parentAssetId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }

  for (const pm of p.paymentMethods as BackupPaymentMethod[]) {
    if (pm.linkedPaymentMethodId !== null && !pmIds.has(pm.linkedPaymentMethodId)) {
      throw new AppError(400, `Payment method "${pm.name}" references unknown linked payment method backup ID: ${pm.linkedPaymentMethodId}`, {
        code: 'BACKUP_INVALID_REFERENCE',
      });
    }
  }
}

// ── Import ────────────────────────────────────────────────────────────

export async function importBackup(
  tx: DbClient,
  userId: string,
  budgetId: number,
  payload: BackupPayload
): Promise<ImportSummary> {
  validateBackupPayload(payload);

  // ── Step 0: Delete all existing data in reverse dependency order ──

  // Get existing year IDs and item IDs for cascading deletes
  const existingYears = await tx
    .select({ id: budgetYears.id })
    .from(budgetYears)
    .where(eq(budgetYears.budgetId, budgetId));
  const existingYearIds = existingYears.map((y) => y.id);

  if (existingYearIds.length > 0) {
    // Transfers
    await tx.delete(transfers).where(inArray(transfers.yearId, existingYearIds));
    // Account balances
    await tx.delete(accountBalances).where(inArray(accountBalances.yearId, existingYearIds));
    // Transactions
    await tx.delete(transactions).where(inArray(transactions.yearId, existingYearIds));
  }

  // Get existing item IDs
  const existingItems =
    existingYearIds.length > 0
      ? await tx
          .select({ id: budgetItems.id })
          .from(budgetItems)
          .where(inArray(budgetItems.yearId, existingYearIds))
      : [];
  const existingItemIds = existingItems.map((i) => i.id);

  if (existingItemIds.length > 0) {
    await tx.delete(monthlyValues).where(inArray(monthlyValues.itemId, existingItemIds));
  }

  if (existingYearIds.length > 0) {
    await tx.delete(budgetItems).where(inArray(budgetItems.yearId, existingYearIds));
  }

  // Budget groups
  await tx.delete(budgetGroups).where(eq(budgetGroups.budgetId, budgetId));
  // Budget years
  await tx.delete(budgetYears).where(eq(budgetYears.budgetId, budgetId));

  // Asset values → assets
  const existingAssets = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.budgetId, budgetId));
  const existingAssetIds = existingAssets.map((a) => a.id);

  if (existingAssetIds.length > 0) {
    await tx.delete(assetValues).where(inArray(assetValues.assetId, existingAssetIds));
  }
  await tx.delete(assets).where(eq(assets.budgetId, budgetId));

  // Payment methods (user-scoped)
  await tx.delete(paymentMethods).where(eq(paymentMethods.userId, userId));

  // ── Step 1: Payment methods (two-pass for linkedPaymentMethodId) ──

  const pmIdMap = new Map<number, number>();

  for (const pm of payload.paymentMethods) {
    const [inserted] = await tx
      .insert(paymentMethods)
      .values({
        userId,
        name: pm.name,
        institution: pm.institution,
        sortOrder: pm.sortOrder,
        isSavingsAccount: pm.isSavingsAccount,
        savingsType: pm.savingsType,
        settlementDay: pm.settlementDay,
        linkedPaymentMethodId: null, // set in pass 2
      })
      .returning();
    pmIdMap.set(pm.id, inserted.id);
  }

  // Pass 2: update linked payment method references
  for (const pm of payload.paymentMethods) {
    if (pm.linkedPaymentMethodId !== null) {
      const newId = pmIdMap.get(pm.id)!;
      const linkedNewId = pmIdMap.get(pm.linkedPaymentMethodId)!;
      await tx
        .update(paymentMethods)
        .set({ linkedPaymentMethodId: linkedNewId })
        .where(eq(paymentMethods.id, newId));
    }
  }

  // ── Step 2: Budget years ──

  const yearIdMap = new Map<number, number>();

  for (const y of payload.budgetYears) {
    const [inserted] = await tx
      .insert(budgetYears)
      .values({
        budgetId,
        year: y.year,
        initialBalance: y.initialBalance,
      })
      .returning();
    yearIdMap.set(y.id, inserted.id);
  }

  // ── Step 3: Budget groups ──

  const groupIdMap = new Map<number, number>();

  for (const g of payload.budgetGroups) {
    const [inserted] = await tx
      .insert(budgetGroups)
      .values({
        budgetId,
        name: g.name,
        slug: g.slug,
        type: g.type,
        sortOrder: g.sortOrder,
      })
      .returning();
    groupIdMap.set(g.id, inserted.id);
  }

  // ── Step 4: Budget items ──

  const itemIdMap = new Map<number, number>();

  for (const item of payload.budgetItems) {
    const [inserted] = await tx
      .insert(budgetItems)
      .values({
        yearId: yearIdMap.get(item.yearId)!,
        groupId: item.groupId !== null ? groupIdMap.get(item.groupId)! : null,
        name: item.name,
        slug: item.slug,
        sortOrder: item.sortOrder,
        yearlyBudget: item.yearlyBudget,
        savingsAccountId:
          item.savingsAccountId !== null ? pmIdMap.get(item.savingsAccountId)! : null,
      })
      .returning();
    itemIdMap.set(item.id, inserted.id);
  }

  // ── Step 5: Monthly values (bulk) ──

  if (payload.monthlyValues.length > 0) {
    await tx.insert(monthlyValues).values(
      payload.monthlyValues.map((mv) => ({
        itemId: itemIdMap.get(mv.itemId)!,
        month: mv.month,
        budget: mv.budget,
        actual: mv.actual,
      }))
    );
  }

  // ── Step 6: Transactions (bulk in chunks to avoid parameter limits) ──

  if (payload.transactions.length > 0) {
    const txnValues = payload.transactions.map((t) => ({
      yearId: yearIdMap.get(t.yearId)!,
      itemId: t.itemId !== null ? itemIdMap.get(t.itemId)! : null,
      date: t.date,
      description: t.description,
      comment: t.comment,
      thirdParty: t.thirdParty,
      paymentMethodId: pmIdMap.get(t.paymentMethodId)!,
      amount: t.amount,
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
      warning: t.warning,
    }));

    // Insert in chunks of 500 to avoid hitting PostgreSQL parameter limits
    for (let i = 0; i < txnValues.length; i += 500) {
      await tx.insert(transactions).values(txnValues.slice(i, i + 500));
    }
  }

  // ── Step 7: Assets (two-pass for parentAssetId) ──

  const assetIdMap = new Map<number, number>();

  for (const a of payload.assets) {
    const [inserted] = await tx
      .insert(assets)
      .values({
        budgetId,
        name: a.name,
        sortOrder: a.sortOrder,
        isSystem: a.isSystem,
        isDebt: a.isDebt,
        parentAssetId: null, // set in pass 2
        savingsType: a.savingsType,
      })
      .returning();
    assetIdMap.set(a.id, inserted.id);
  }

  // Pass 2: update parent references
  for (const a of payload.assets) {
    if (a.parentAssetId !== null) {
      const newId = assetIdMap.get(a.id)!;
      const parentNewId = assetIdMap.get(a.parentAssetId)!;
      await tx
        .update(assets)
        .set({ parentAssetId: parentNewId })
        .where(eq(assets.id, newId));
    }
  }

  // ── Step 8: Asset values (bulk) ──

  if (payload.assetValues.length > 0) {
    await tx.insert(assetValues).values(
      payload.assetValues.map((av) => ({
        assetId: assetIdMap.get(av.assetId)!,
        yearId: yearIdMap.get(av.yearId)!,
        value: av.value,
      }))
    );
  }

  // ── Step 9: Account balances (bulk) ──

  if (payload.accountBalances.length > 0) {
    await tx.insert(accountBalances).values(
      payload.accountBalances.map((ab) => ({
        yearId: yearIdMap.get(ab.yearId)!,
        paymentMethodId: pmIdMap.get(ab.paymentMethodId)!,
        initialBalance: ab.initialBalance,
      }))
    );
  }

  // ── Step 10: Transfers (bulk) ──

  if (payload.transfers.length > 0) {
    await tx.insert(transfers).values(
      payload.transfers.map((xf) => ({
        yearId: yearIdMap.get(xf.yearId)!,
        date: xf.date,
        amount: xf.amount,
        description: xf.description,
        sourceAccountId: pmIdMap.get(xf.sourceAccountId)!,
        destinationAccountId: pmIdMap.get(xf.destinationAccountId)!,
        accountingMonth: xf.accountingMonth,
        accountingYear: xf.accountingYear,
      }))
    );
  }

  return {
    paymentMethods: payload.paymentMethods.length,
    budgetYears: payload.budgetYears.length,
    budgetGroups: payload.budgetGroups.length,
    budgetItems: payload.budgetItems.length,
    monthlyValues: payload.monthlyValues.length,
    transactions: payload.transactions.length,
    assets: payload.assets.length,
    assetValues: payload.assetValues.length,
    transfers: payload.transfers.length,
    accountBalances: payload.accountBalances.length,
  };
}
