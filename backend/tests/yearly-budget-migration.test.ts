import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { withTenantContext, withUserContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import { createYearlyBudget, getAccessibleBudget, shareBudgetWithUser } from '../src/services/budgets.js';

const {
  users,
  budgets,
  budgetShares,
  budgetYears,
  budgetGroups,
  budgetItems,
  monthlyValues,
  transactions,
  paymentMethods,
  accountBalances,
  transfers,
  entryOrderOverrides,
  assets,
  assetValues,
} = schema;

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = resolve(here, '../drizzle');
const migrationSql = readFileSync(resolve(drizzleDir, '0032_split_yearly_budgets.sql'), 'utf8');

function buildSuperuserUrl(databaseName?: string) {
  const base = process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret')
    : `postgresql://${process.env.POSTGRES_USER || 'tallix'}:${process.env.POSTGRES_PASSWORD || 'tallix_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;
  if (!databaseName) return base;
  const url = new URL(base);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withIsolatedMigratedDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const databaseName = `tallix_yearly_migration_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const admin = postgres(buildSuperuserUrl(), { max: 1 });
  let isolatedClient: postgres.Sql | null = null;

  try {
    await admin.unsafe(`CREATE DATABASE ${databaseName}`);
    isolatedClient = postgres(buildSuperuserUrl(databaseName), { max: 1 });

    for (const file of readdirSync(drizzleDir).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
      if (file >= '0032_split_yearly_budgets.sql') break;
      await isolatedClient.unsafe(readFileSync(resolve(drizzleDir, file), 'utf8'));
    }

    return await fn(drizzle(isolatedClient, { schema }));
  } finally {
    if (isolatedClient) await isolatedClient.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.end();
  }
}

test('yearly split migration preserves moved year data and copied shares', async () => {
  await withIsolatedMigratedDb(async (db) => {
    const [owner] = await db
      .insert(users)
      .values({ email: 'yearly-migration-owner@test.com', passwordHash: 'hash', name: 'Owner' })
      .returning();
    const [collaborator] = await db
      .insert(users)
      .values({ email: 'yearly-migration-collab@test.com', passwordHash: 'hash', name: 'Collaborator' })
      .returning();

    const [budget] = await db
      .insert(budgets)
      .values({ userId: owner.id, description: 'Legacy household', startYear: 9024 })
      .returning();
    await db.insert(budgetShares).values({ budgetId: budget.id, userId: collaborator.id, role: 'write' });

    const [year2024] = await db.insert(budgetYears).values({ budgetId: budget.id, year: 9024 }).returning();
    const [year2025] = await db.insert(budgetYears).values({ budgetId: budget.id, year: 9025 }).returning();
    const [group] = await db
      .insert(budgetGroups)
      .values({ budgetId: budget.id, name: 'Housing', slug: 'housing', type: 'expense', sortOrder: 0 })
      .returning();
    const [movedItem] = await db
      .insert(budgetItems)
      .values({ yearId: year2024.id, groupId: group.id, name: 'Rent', slug: 'rent', yearlyBudget: '1200.00' })
      .returning();
    const [keptItem] = await db
      .insert(budgetItems)
      .values({ yearId: year2025.id, groupId: group.id, name: 'Rent', slug: 'rent', yearlyBudget: '1300.00' })
      .returning();

    const [account] = await db.insert(paymentMethods).values({ userId: owner.id, name: 'Checking' }).returning();
    const [savingsAccount] = await db
      .insert(paymentMethods)
      .values({ userId: owner.id, name: 'Savings', isSavingsAccount: true, savingsType: 'epargne' })
      .returning();
    const [movedSavingsItem] = await db
      .insert(budgetItems)
      .values({
        yearId: year2024.id,
        groupId: group.id,
        name: 'Emergency fund',
        slug: 'emergency-fund',
        yearlyBudget: '2400.00',
        savingsAccountId: savingsAccount.id,
      })
      .returning();
    const [movedMonthlyValue] = await db
      .insert(monthlyValues)
      .values({ itemId: movedItem.id, month: 1, budget: '100.00', actual: '90.00' })
      .returning();
    const [movedSavingsMonthlyValue] = await db
      .insert(monthlyValues)
      .values({ itemId: movedSavingsItem.id, month: 2, budget: '200.00', actual: '180.00' })
      .returning();
    const [transaction] = await db
      .insert(transactions)
      .values({
        yearId: year2024.id,
        itemId: movedItem.id,
        date: '9024-01-02',
        amount: '100.00',
        paymentMethodId: account.id,
        accountingMonth: 1,
        accountingYear: 9024,
        createdByUserId: owner.id,
      })
      .returning();
    const [balance] = await db
      .insert(accountBalances)
      .values({ yearId: year2024.id, paymentMethodId: account.id, initialBalance: '345.67' })
      .returning();
    const [transfer] = await db
      .insert(transfers)
      .values({
        yearId: year2024.id,
        date: '9024-02-03',
        amount: '50.25',
        description: 'Move to savings',
        sourceAccountId: account.id,
        destinationAccountId: savingsAccount.id,
        accountingMonth: 2,
        accountingYear: 9024,
      })
      .returning();
    const [transactionOrder] = await db
      .insert(entryOrderOverrides)
      .values({ yearId: year2024.id, entryType: 'transaction', entryId: transaction.id, sortOffset: -1 })
      .returning();
    const [transferOrder] = await db
      .insert(entryOrderOverrides)
      .values({ yearId: year2024.id, entryType: 'transfer', entryId: transfer.id, sortOffset: 2 })
      .returning();

    const [parentAsset] = await db
      .insert(assets)
      .values({ budgetId: budget.id, name: 'Real Estate', sortOrder: 1 })
      .returning();
    const [childAsset] = await db
      .insert(assets)
      .values({ budgetId: budget.id, name: 'Apartment', sortOrder: 2, parentAssetId: parentAsset.id })
      .returning();
    const [movedAssetValue] = await db
      .insert(assetValues)
      .values({ assetId: childAsset.id, yearId: year2024.id, value: '250000.00' })
      .returning();
    const [keptAssetValue] = await db
      .insert(assetValues)
      .values({ assetId: childAsset.id, yearId: year2025.id, value: '260000.00' })
      .returning();

    await db.execute(sql.raw(migrationSql));

    const ownerBudgets = await db.select().from(budgets).where(eq(budgets.userId, owner.id)).orderBy(budgets.startYear);
    expect(ownerBudgets.map((row) => row.startYear)).toEqual([9024, 9025]);

    const movedBudget = ownerBudgets[0];
    const originalBudget = ownerBudgets[1];
    expect(originalBudget.id).toBe(budget.id);
    expect(originalBudget.startYear).toBe(9025);
    expect(movedBudget.id).not.toBe(budget.id);
    const movedShares = await db.select().from(budgetShares).where(eq(budgetShares.budgetId, movedBudget.id));
    expect(movedShares).toMatchObject([{ userId: collaborator.id, role: 'write' }]);

    const [movedYear] = await db.select().from(budgetYears).where(eq(budgetYears.id, year2024.id));
    expect(movedYear.budgetId).toBe(movedBudget.id);
    const [keptYear] = await db.select().from(budgetYears).where(eq(budgetYears.id, year2025.id));
    expect(keptYear.budgetId).toBe(originalBudget.id);

    const [updatedMovedItem] = await db.select().from(budgetItems).where(eq(budgetItems.id, movedItem.id));
    const [movedGroup] = await db.select().from(budgetGroups).where(eq(budgetGroups.id, updatedMovedItem.groupId!));
    const [updatedMovedSavingsItem] = await db
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.id, movedSavingsItem.id));
    const [updatedKeptItem] = await db.select().from(budgetItems).where(eq(budgetItems.id, keptItem.id));
    const [originalGroup] = await db.select().from(budgetGroups).where(eq(budgetGroups.id, group.id));
    expect({
      movedItem: {
        id: updatedMovedItem.id,
        yearId: updatedMovedItem.yearId,
        groupChanged: updatedMovedItem.groupId !== group.id,
        groupBudgetId: movedGroup.budgetId,
        yearlyBudget: updatedMovedItem.yearlyBudget,
      },
      movedSavingsItem: {
        id: updatedMovedSavingsItem.id,
        yearId: updatedMovedSavingsItem.yearId,
        groupId: updatedMovedSavingsItem.groupId,
        savingsAccountId: updatedMovedSavingsItem.savingsAccountId,
        yearlyBudget: updatedMovedSavingsItem.yearlyBudget,
      },
      keptItem: {
        id: updatedKeptItem.id,
        yearId: updatedKeptItem.yearId,
        groupId: updatedKeptItem.groupId,
        groupBudgetId: originalGroup.budgetId,
      },
    }).toEqual({
      movedItem: {
        id: movedItem.id,
        yearId: year2024.id,
        groupChanged: true,
        groupBudgetId: movedBudget.id,
        yearlyBudget: '1200.00',
      },
      movedSavingsItem: {
        id: movedSavingsItem.id,
        yearId: year2024.id,
        groupId: movedGroup.id,
        savingsAccountId: savingsAccount.id,
        yearlyBudget: '2400.00',
      },
      keptItem: {
        id: keptItem.id,
        yearId: year2025.id,
        groupId: group.id,
        groupBudgetId: originalBudget.id,
      },
    });

    const [updatedMovedMonthlyValue] = await db
      .select()
      .from(monthlyValues)
      .where(eq(monthlyValues.id, movedMonthlyValue.id));
    const [updatedMovedSavingsMonthlyValue] = await db
      .select()
      .from(monthlyValues)
      .where(eq(monthlyValues.id, movedSavingsMonthlyValue.id));
    expect([
      {
        id: updatedMovedMonthlyValue.id,
        itemId: updatedMovedMonthlyValue.itemId,
        month: updatedMovedMonthlyValue.month,
        budget: updatedMovedMonthlyValue.budget,
        actual: updatedMovedMonthlyValue.actual,
      },
      {
        id: updatedMovedSavingsMonthlyValue.id,
        itemId: updatedMovedSavingsMonthlyValue.itemId,
        month: updatedMovedSavingsMonthlyValue.month,
        budget: updatedMovedSavingsMonthlyValue.budget,
        actual: updatedMovedSavingsMonthlyValue.actual,
      },
    ]).toEqual([
      { id: movedMonthlyValue.id, itemId: movedItem.id, month: 1, budget: '100.00', actual: '90.00' },
      {
        id: movedSavingsMonthlyValue.id,
        itemId: movedSavingsItem.id,
        month: 2,
        budget: '200.00',
        actual: '180.00',
      },
    ]);

    const [updatedTransaction] = await db.select().from(transactions).where(eq(transactions.id, transaction.id));
    const [updatedBalance] = await db.select().from(accountBalances).where(eq(accountBalances.id, balance.id));
    const [updatedTransfer] = await db.select().from(transfers).where(eq(transfers.id, transfer.id));
    const movedOrderRows = await db
      .select()
      .from(entryOrderOverrides)
      .where(eq(entryOrderOverrides.yearId, year2024.id))
      .orderBy(entryOrderOverrides.entryType);
    expect({
      transaction: {
        id: updatedTransaction.id,
        yearId: updatedTransaction.yearId,
        itemId: updatedTransaction.itemId,
        amount: updatedTransaction.amount,
      },
      balance: {
        id: updatedBalance.id,
        yearId: updatedBalance.yearId,
        paymentMethodId: updatedBalance.paymentMethodId,
        initialBalance: updatedBalance.initialBalance,
      },
      transfer: {
        id: updatedTransfer.id,
        yearId: updatedTransfer.yearId,
        amount: updatedTransfer.amount,
        sourceAccountId: updatedTransfer.sourceAccountId,
        destinationAccountId: updatedTransfer.destinationAccountId,
      },
      orderOverrides: movedOrderRows.map((row) => ({
        id: row.id,
        entryType: row.entryType,
        entryId: row.entryId,
        sortOffset: row.sortOffset,
      })),
    }).toEqual({
      transaction: { id: transaction.id, yearId: year2024.id, itemId: movedItem.id, amount: '100.00' },
      balance: { id: balance.id, yearId: year2024.id, paymentMethodId: account.id, initialBalance: '345.67' },
      transfer: {
        id: transfer.id,
        yearId: year2024.id,
        amount: '50.25',
        sourceAccountId: account.id,
        destinationAccountId: savingsAccount.id,
      },
      orderOverrides: [
        { id: transactionOrder.id, entryType: 'transaction', entryId: transaction.id, sortOffset: -1 },
        { id: transferOrder.id, entryType: 'transfer', entryId: transfer.id, sortOffset: 2 },
      ],
    });

    const [movedValue] = await db.select().from(assetValues).where(eq(assetValues.yearId, year2024.id));
    const [movedChildAsset] = await db.select().from(assets).where(eq(assets.id, movedValue.assetId));
    const [movedParentAsset] = await db.select().from(assets).where(eq(assets.id, movedChildAsset.parentAssetId!));
    const [updatedKeptValue] = await db.select().from(assetValues).where(eq(assetValues.id, keptAssetValue.id));
    const [updatedOriginalChildAsset] = await db.select().from(assets).where(eq(assets.id, childAsset.id));
    expect({
      movedValue: {
        id: movedValue.id,
        value: movedValue.value,
        yearId: movedValue.yearId,
        assetChanged: movedValue.assetId !== childAsset.id,
      },
      movedChildAsset: {
        budgetId: movedChildAsset.budgetId,
        name: movedChildAsset.name,
        parentAssetId: movedChildAsset.parentAssetId,
      },
      movedParentAsset: {
        budgetId: movedParentAsset.budgetId,
        name: movedParentAsset.name,
        parentAssetId: movedParentAsset.parentAssetId,
      },
      keptValue: {
        id: updatedKeptValue.id,
        assetId: updatedKeptValue.assetId,
        yearId: updatedKeptValue.yearId,
        value: updatedKeptValue.value,
      },
      originalChildAsset: {
        id: updatedOriginalChildAsset.id,
        budgetId: updatedOriginalChildAsset.budgetId,
        parentAssetId: updatedOriginalChildAsset.parentAssetId,
      },
    }).toEqual({
      movedValue: { id: movedAssetValue.id, value: '250000.00', yearId: year2024.id, assetChanged: true },
      movedChildAsset: {
        budgetId: movedBudget.id,
        name: 'Apartment',
        parentAssetId: movedParentAsset.id,
      },
      movedParentAsset: {
        budgetId: movedBudget.id,
        name: 'Real Estate',
        parentAssetId: null,
      },
      keptValue: { id: keptAssetValue.id, assetId: childAsset.id, yearId: year2025.id, value: '260000.00' },
      originalChildAsset: {
        id: childAsset.id,
        budgetId: originalBudget.id,
        parentAssetId: parentAsset.id,
      },
    });
  });
});

test('yearly split migration keeps the current calendar year on the original budget id when a future year exists', async () => {
  await withIsolatedMigratedDb(async (db) => {
    const [{ currentYear }] = await db.execute<{ currentYear: number }>(
      sql`SELECT EXTRACT(YEAR FROM now())::integer AS "currentYear"`
    );
    const [owner] = await db
      .insert(users)
      .values({ email: 'yearly-migration-current-owner@test.com', passwordHash: 'hash', name: 'Owner' })
      .returning();
    const [budget] = await db
      .insert(budgets)
      .values({ userId: owner.id, description: 'Current year wins', startYear: currentYear - 1 })
      .returning();
    const [pastYear] = await db
      .insert(budgetYears)
      .values({ budgetId: budget.id, year: currentYear - 1 })
      .returning();
    const [keptCurrentYear] = await db
      .insert(budgetYears)
      .values({ budgetId: budget.id, year: currentYear })
      .returning();
    const [futureYear] = await db
      .insert(budgetYears)
      .values({ budgetId: budget.id, year: currentYear + 1 })
      .returning();

    await db.execute(sql.raw(migrationSql));

    const migratedBudgets = await db.select().from(budgets).where(eq(budgets.userId, owner.id));
    const [updatedOriginalBudget] = migratedBudgets.filter((row) => row.id === budget.id);
    const [updatedPastYear] = await db.select().from(budgetYears).where(eq(budgetYears.id, pastYear.id));
    const [updatedCurrentYear] = await db.select().from(budgetYears).where(eq(budgetYears.id, keptCurrentYear.id));
    const [updatedFutureYear] = await db.select().from(budgetYears).where(eq(budgetYears.id, futureYear.id));

    expect({
      budgetCount: migratedBudgets.length,
      originalBudget: { id: updatedOriginalBudget.id, startYear: updatedOriginalBudget.startYear },
      currentYearBudgetId: updatedCurrentYear.budgetId,
    }).toEqual({
      budgetCount: 3,
      originalBudget: { id: budget.id, startYear: currentYear },
      currentYearBudgetId: budget.id,
    });
    expect(updatedPastYear.budgetId).not.toBe(budget.id);
    expect(updatedFutureYear.budgetId).not.toBe(budget.id);
    expect(updatedPastYear.budgetId).not.toBe(updatedFutureYear.budgetId);
  });
});

test('same-year budgets remain independently shareable under RLS', async () => {
  const superuserClient = postgres(buildSuperuserUrl(), { max: 1 });
  const superuserDb = drizzle(superuserClient, { schema });
  const ownerEmail = `yearly-share-owner-${Date.now()}@test.com`;
  const collaboratorEmail = `yearly-share-collab-${Date.now()}@test.com`;
  try {
    const [owner] = await superuserDb.insert(users).values({ email: ownerEmail, passwordHash: 'hash' }).returning();
    const [collaborator] = await superuserDb
      .insert(users)
      .values({ email: collaboratorEmail, passwordHash: 'hash' })
      .returning();

    const budgetA = await withUserContext(owner.id, (tx) => createYearlyBudget(tx, owner.id, 9040, 'A'));
    const budgetB = await withUserContext(owner.id, (tx) => createYearlyBudget(tx, owner.id, 9040, 'B'));

    await withTenantContext(owner.id, budgetA.id, (tx) =>
      shareBudgetWithUser(tx, budgetA.id, owner.id, collaboratorEmail, 'read')
    );

    await expect(
      withUserContext(collaborator.id, (tx) => getAccessibleBudget(tx, collaborator.id, budgetA.id))
    ).resolves.toMatchObject({ role: 'read' });
    await expect(
      withUserContext(collaborator.id, (tx) => getAccessibleBudget(tx, collaborator.id, budgetB.id))
    ).resolves.toBeNull();

    await superuserDb
      .update(budgetShares)
      .set({ role: 'write' })
      .where(sql`budget_id = ${budgetA.id} AND user_id = ${collaborator.id}`);

    await expect(
      withUserContext(collaborator.id, (tx) => getAccessibleBudget(tx, collaborator.id, budgetA.id))
    ).resolves.toMatchObject({ role: 'write' });
    await expect(
      withUserContext(collaborator.id, (tx) => getAccessibleBudget(tx, collaborator.id, budgetB.id))
    ).resolves.toBeNull();

    await superuserDb.delete(budgetShares).where(sql`budget_id = ${budgetA.id} AND user_id = ${collaborator.id}`);

    await expect(
      withUserContext(collaborator.id, (tx) => getAccessibleBudget(tx, collaborator.id, budgetA.id))
    ).resolves.toBeNull();
    await expect(
      withUserContext(collaborator.id, (tx) => getAccessibleBudget(tx, collaborator.id, budgetB.id))
    ).resolves.toBeNull();
  } finally {
    await superuserDb.delete(users).where(sql`email IN (${ownerEmail}, ${collaboratorEmail})`);
    await superuserClient.end();
  }
});
