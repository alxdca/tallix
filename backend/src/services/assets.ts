import Decimal from 'decimal.js';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { assets, assetValues, budgetYears, paymentMethods } from '../db/schema.js';
import * as accountsSvc from './accounts.js';

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface Asset {
  id: number;
  name: string;
  sortOrder: number;
  isSystem: boolean;
  isDebt: boolean;
  parentAssetId: number | null;
  savingsType: string | null;
  yearlyValues: Record<number, number>; // year -> value
}

export interface AssetsResponse {
  assets: Asset[];
  years: number[]; // Available years for this budget
}

const SYSTEM_ASSET_CHECKINGS = 'Checkings';
const SYSTEM_ASSET_SAVINGS_EPARGNE = 'Savings';
const SYSTEM_ASSET_PENSION = 'Pension';
const SYSTEM_ASSET_INVESTMENTS = 'Investments';

// Get all assets with yearly values for a budget
export async function getAssets(tx: DbClient, budgetId: number, userId: string): Promise<AssetsResponse> {
  // Get all years for this budget
  const years = await tx
    .select({ year: budgetYears.year })
    .from(budgetYears)
    .where(eq(budgetYears.budgetId, budgetId))
    .orderBy(asc(budgetYears.year));

  const yearsList = years.map((y) => y.year);

  // Initialize system assets if they don't exist
  await ensureSystemAssets(tx, budgetId);

  // Get all assets for this budget
  const allAssets = await tx
    .select()
    .from(assets)
    .where(eq(assets.budgetId, budgetId))
    .orderBy(asc(assets.sortOrder), asc(assets.id));

  // Get all asset values
  const values = await tx
    .select({
      assetId: assetValues.assetId,
      yearId: assetValues.yearId,
      value: assetValues.value,
    })
    .from(assetValues)
    .where(
      inArray(assetValues.assetId, tx.select({ id: assets.id }).from(assets).where(eq(assets.budgetId, budgetId)))
    );

  // Create a map of year ID to year number
  const yearIdToYear = new Map<number, number>();
  for (const y of years) {
    const yearRecord = await tx.query.budgetYears.findFirst({
      where: and(eq(budgetYears.budgetId, budgetId), eq(budgetYears.year, y.year)),
    });
    if (yearRecord) {
      yearIdToYear.set(yearRecord.id, y.year);
    }
  }

  // Create a map of asset ID -> year -> value
  const assetValuesMap = new Map<number, Record<number, number>>();
  for (const v of values) {
    const year = yearIdToYear.get(v.yearId);
    if (!year) continue;

    if (!assetValuesMap.has(v.assetId)) {
      assetValuesMap.set(v.assetId, {});
    }
    assetValuesMap.get(v.assetId)![year] = parseFloat(v.value);
  }

  // Get current year for determining which system assets to calculate
  const currentYear = new Date().getFullYear();

  // Process system assets (Checkings and Savings)
  const assetsResult: Asset[] = [];
  for (const asset of allAssets) {
    let yearlyValues: Record<number, number> = {};

    if (asset.isSystem) {
      // For system assets: calculate current year from accounts, use stored values for past years
      const storedValues = assetValuesMap.get(asset.id) || {};

      for (const year of yearsList) {
        if (year === currentYear) {
          // Calculate current year from accounts
          const calculated = await calculateSystemAssetValues(
            tx,
            asset.name,
            asset.savingsType,
            [year],
            budgetId,
            userId
          );
          yearlyValues[year] = calculated[year] || 0;
        } else {
          // Use stored value for past years
          yearlyValues[year] = storedValues[year] || 0;
        }
      }
    } else {
      // Use stored values for custom assets
      yearlyValues = assetValuesMap.get(asset.id) || {};
    }

    assetsResult.push({
      id: asset.id,
      name: asset.name,
      sortOrder: asset.sortOrder,
      isSystem: asset.isSystem,
      isDebt: asset.isDebt,
      parentAssetId: asset.parentAssetId,
      savingsType: asset.savingsType,
      yearlyValues,
    });
  }

  return {
    assets: assetsResult,
    years: yearsList,
  };
}

// Calculate system asset values from accounts
async function calculateSystemAssetValues(
  tx: DbClient,
  assetName: string,
  savingsType: string | null,
  years: number[],
  budgetId: number,
  userId: string
): Promise<Record<number, number>> {
  const yearlyValues: Record<number, number> = {};

  // Get all payment methods to map account IDs to savings types
  const allPaymentMethods = await tx.select().from(paymentMethods).where(eq(paymentMethods.userId, userId));

  const paymentMethodMap = new Map(allPaymentMethods.map((pm) => [pm.id, pm]));

  for (const year of years) {
    try {
      const accountsData = await accountsSvc.getAccountsForYear(tx, year, budgetId, userId);

      if (assetName === SYSTEM_ASSET_CHECKINGS) {
        // Sum year-end balance of all non-savings accounts (month 12)
        const total = accountsData.accounts
          .filter((acc) => !acc.isSavingsAccount)
          .reduce((sum, acc) => {
            const yearEndBalance = acc.monthlyBalances[11] || 0; // December (0-indexed)
            return sum + yearEndBalance;
          }, 0);
        yearlyValues[year] = total;
      } else if (savingsType === 'epargne') {
        // Savings (Épargne) - only savings accounts with type 'epargne' or null
        const total = accountsData.accounts
          .filter((acc) => {
            if (!acc.isSavingsAccount) return false;
            const pm = paymentMethodMap.get(acc.id);
            return !pm?.savingsType || pm.savingsType === 'epargne';
          })
          .reduce((sum, acc) => {
            const yearEndBalance = acc.monthlyBalances[11] || 0; // December (0-indexed)
            return sum + yearEndBalance;
          }, 0);
        yearlyValues[year] = total;
      } else if (savingsType === 'prevoyance') {
        // Pension (Prévoyance) - only savings accounts with type 'prevoyance'
        const total = accountsData.accounts
          .filter((acc) => {
            if (!acc.isSavingsAccount) return false;
            const pm = paymentMethodMap.get(acc.id);
            return pm?.savingsType === 'prevoyance';
          })
          .reduce((sum, acc) => {
            const yearEndBalance = acc.monthlyBalances[11] || 0; // December (0-indexed)
            return sum + yearEndBalance;
          }, 0);
        yearlyValues[year] = total;
      } else if (savingsType === 'investissements') {
        // Investments (Investissements) - only savings accounts with type 'investissements'
        const total = accountsData.accounts
          .filter((acc) => {
            if (!acc.isSavingsAccount) return false;
            const pm = paymentMethodMap.get(acc.id);
            return pm?.savingsType === 'investissements';
          })
          .reduce((sum, acc) => {
            const yearEndBalance = acc.monthlyBalances[11] || 0; // December (0-indexed)
            return sum + yearEndBalance;
          }, 0);
        yearlyValues[year] = total;
      }
    } catch (_error) {
      // If year doesn't exist or has issues, set value to 0
      yearlyValues[year] = 0;
    }
  }

  return yearlyValues;
}

// Ensure system assets exist for a budget
async function ensureSystemAssets(tx: DbClient, budgetId: number): Promise<void> {
  const allAssets = await tx.select().from(assets).where(eq(assets.budgetId, budgetId));
  const assetByName = new Map(allAssets.map((a) => [a.name, a]));

  const ensureSystemAsset = async (
    name: string,
    updates: { sortOrder: number; parentAssetId: number | null; savingsType: string | null }
  ): Promise<{ id: number } | null> => {
    const existing = assetByName.get(name);
    if (!existing) {
      const [created] = await tx
        .insert(assets)
        .values({
          budgetId,
          name,
          sortOrder: updates.sortOrder,
          isSystem: true,
          isDebt: false,
          parentAssetId: updates.parentAssetId,
          savingsType: updates.savingsType,
        })
        .returning();
      assetByName.set(name, created);
      return created;
    }

    const needsUpdate =
      !existing.isSystem ||
      existing.isDebt ||
      existing.sortOrder !== updates.sortOrder ||
      existing.parentAssetId !== updates.parentAssetId ||
      existing.savingsType !== updates.savingsType;

    if (needsUpdate) {
      await tx
        .update(assets)
        .set({
          isSystem: true,
          isDebt: false,
          sortOrder: updates.sortOrder,
          parentAssetId: updates.parentAssetId,
          savingsType: updates.savingsType,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, existing.id));
    }

    return existing;
  };

  // Create all system assets as top-level (no parent-child relationships)
  await ensureSystemAsset(SYSTEM_ASSET_CHECKINGS, {
    sortOrder: 0,
    parentAssetId: null,
    savingsType: null,
  });

  await ensureSystemAsset(SYSTEM_ASSET_SAVINGS_EPARGNE, {
    sortOrder: 1,
    parentAssetId: null,
    savingsType: 'epargne',
  });

  await ensureSystemAsset(SYSTEM_ASSET_PENSION, {
    sortOrder: 2,
    parentAssetId: null,
    savingsType: 'prevoyance',
  });

  await ensureSystemAsset(SYSTEM_ASSET_INVESTMENTS, {
    sortOrder: 3,
    parentAssetId: null,
    savingsType: 'investissements',
  });
}

// Create a new custom asset
export async function createAsset(tx: DbClient, budgetId: number, name: string, isDebt = false): Promise<Asset> {
  // Check if asset with this name already exists
  const existing = await tx.query.assets.findFirst({
    where: and(eq(assets.budgetId, budgetId), eq(assets.name, name)),
  });

  if (existing) {
    throw new Error('An asset with this name already exists');
  }

  // Get max sort order
  const maxSortOrder = await tx.select({ max: assets.sortOrder }).from(assets).where(eq(assets.budgetId, budgetId));

  const sortOrder = (maxSortOrder[0]?.max ?? 1) + 1;

  // Insert new asset
  const [newAsset] = await tx
    .insert(assets)
    .values({
      budgetId,
      name,
      sortOrder,
      isSystem: false,
      isDebt,
    })
    .returning();

  return {
    id: newAsset.id,
    name: newAsset.name,
    sortOrder: newAsset.sortOrder,
    isSystem: newAsset.isSystem,
    isDebt: newAsset.isDebt,
    parentAssetId: newAsset.parentAssetId,
    savingsType: newAsset.savingsType,
    yearlyValues: {},
  };
}

// Update asset value for a specific year
export async function updateAssetValue(
  tx: DbClient,
  assetId: number,
  year: number,
  value: number,
  budgetId: number
): Promise<void> {
  // Verify asset exists and belongs to this budget
  const asset = await tx.query.assets.findFirst({
    where: and(eq(assets.id, assetId), eq(assets.budgetId, budgetId)),
  });

  if (!asset) {
    throw new Error('Asset not found or does not belong to this budget');
  }

  // System assets can only be updated for past years, not the current year
  if (asset.isSystem) {
    const currentYear = new Date().getFullYear();
    if (year === currentYear) {
      throw new Error('Cannot update value for system assets in the current year - they are calculated automatically');
    }
  }

  // Get year ID
  const budgetYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.budgetId, budgetId), eq(budgetYears.year, year)),
  });

  if (!budgetYear) {
    throw new Error('Year not found for this budget');
  }

  // Upsert asset value
  await tx
    .insert(assetValues)
    .values({
      assetId,
      yearId: budgetYear.id,
      value: value.toString(),
    })
    .onConflictDoUpdate({
      target: [assetValues.assetId, assetValues.yearId],
      set: {
        value: value.toString(),
        updatedAt: new Date(),
      },
    });
}

// Delete a custom asset
export async function deleteAsset(tx: DbClient, assetId: number, budgetId: number): Promise<void> {
  // Verify asset exists and belongs to this budget
  const asset = await tx.query.assets.findFirst({
    where: and(eq(assets.id, assetId), eq(assets.budgetId, budgetId)),
  });

  if (!asset) {
    throw new Error('Asset not found or does not belong to this budget');
  }

  // System assets cannot be deleted
  if (asset.isSystem) {
    throw new Error('Cannot delete system assets');
  }

  // Delete asset (cascade will delete values)
  await tx.delete(assets).where(eq(assets.id, assetId));
}

// Reorder assets
export async function reorderAssets(tx: DbClient, budgetId: number, assetIds: number[]): Promise<void> {
  // Verify all assets belong to this budget
  const budgetAssets = await tx.select().from(assets).where(eq(assets.budgetId, budgetId));

  const budgetAssetIds = new Set(budgetAssets.map((a) => a.id));
  for (const id of assetIds) {
    if (!budgetAssetIds.has(id)) {
      throw new Error('One or more assets do not belong to this budget');
    }
  }

  // Update sort order for each asset
  for (let i = 0; i < assetIds.length; i++) {
    await tx.update(assets).set({ sortOrder: i, updatedAt: new Date() }).where(eq(assets.id, assetIds[i]));
  }
}
