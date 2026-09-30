import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withUserContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import { deleteOwnedBudget } from '../src/services/budgets.js';

const {
  accountBalances,
  assets,
  assetValues,
  budgetGroups,
  budgetItems,
  budgetShares,
  budgetYears,
  budgets,
  monthlyValues,
  paymentMethods,
  transactions,
  transfers,
  users,
} = schema;

const superuserUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret')
  : `postgresql://${process.env.POSTGRES_USER || 'tallix'}:${process.env.POSTGRES_PASSWORD || 'tallix_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;
const superuserClient = postgres(superuserUrl);
const superuserDb = drizzle(superuserClient, { schema });

async function cleanup() {
  await superuserDb.execute(sql`
    DELETE FROM budgets
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE 'budget-delete-%@test.com'
    )
  `);
  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE 'budget-delete-%@test.com'`);
}

async function createUser(email: string) {
  const [user] = await superuserDb
    .insert(users)
    .values({ email, passwordHash: 'hash', name: email.split('@')[0] })
    .returning();
  return user;
}

async function createPopulatedBudget(userId: string, startYear: number, description: string) {
  const [budget] = await superuserDb.insert(budgets).values({ userId, startYear, description }).returning();
  const [year] = await superuserDb.insert(budgetYears).values({ budgetId: budget.id, year: startYear }).returning();
  const [group] = await superuserDb
    .insert(budgetGroups)
    .values({ budgetId: budget.id, name: 'Housing', slug: `housing-${budget.id}`, type: 'expense', sortOrder: 0 })
    .returning();
  const [item] = await superuserDb
    .insert(budgetItems)
    .values({ yearId: year.id, groupId: group.id, name: 'Rent', slug: `rent-${budget.id}`, sortOrder: 0 })
    .returning();
  const [monthlyValue] = await superuserDb
    .insert(monthlyValues)
    .values({ itemId: item.id, month: 1, budget: '100.00', actual: '90.00' })
    .returning();

  const [checking] = await superuserDb
    .insert(paymentMethods)
    .values({ userId, name: `Checking ${budget.id}`, sortOrder: 0 })
    .returning();
  const [savings] = await superuserDb
    .insert(paymentMethods)
    .values({ userId, name: `Savings ${budget.id}`, sortOrder: 1, isSavingsAccount: true })
    .returning();

  const [transaction] = await superuserDb
    .insert(transactions)
    .values({
      yearId: year.id,
      itemId: item.id,
      date: `${startYear}-01-10`,
      amount: '42.00',
      paymentMethodId: checking.id,
      accountingMonth: 1,
      accountingYear: startYear,
    })
    .returning();
  const [transfer] = await superuserDb
    .insert(transfers)
    .values({
      yearId: year.id,
      date: `${startYear}-01-11`,
      amount: '12.00',
      sourceAccountId: checking.id,
      destinationAccountId: savings.id,
      accountingMonth: 1,
      accountingYear: startYear,
    })
    .returning();
  const [accountBalance] = await superuserDb
    .insert(accountBalances)
    .values({ yearId: year.id, paymentMethodId: checking.id, initialBalance: '1000.00' })
    .returning();
  const [asset] = await superuserDb
    .insert(assets)
    .values({ budgetId: budget.id, name: `Apartment ${budget.id}`, sortOrder: 0 })
    .returning();
  const [assetValue] = await superuserDb
    .insert(assetValues)
    .values({ assetId: asset.id, yearId: year.id, value: '250000.00' })
    .returning();

  return {
    budget,
    year,
    group,
    item,
    monthlyValue,
    checking,
    savings,
    transaction,
    transfer,
    accountBalance,
    asset,
    assetValue,
  };
}

async function countByBudget(budgetId: number) {
  const yearRows = await superuserDb
    .select({ id: budgetYears.id })
    .from(budgetYears)
    .where(eq(budgetYears.budgetId, budgetId));
  const yearIds = yearRows.map((row) => row.id);
  const groupRows = await superuserDb
    .select({ id: budgetGroups.id })
    .from(budgetGroups)
    .where(eq(budgetGroups.budgetId, budgetId));
  const itemRows = yearIds.length
    ? await superuserDb.select({ id: budgetItems.id }).from(budgetItems).where(inArray(budgetItems.yearId, yearIds))
    : [];
  const itemIds = itemRows.map((row) => row.id);
  const assetRows = await superuserDb.select({ id: assets.id }).from(assets).where(eq(assets.budgetId, budgetId));
  const assetIds = assetRows.map((row) => row.id);

  return {
    budgets: (await superuserDb.select().from(budgets).where(eq(budgets.id, budgetId))).length,
    years: yearRows.length,
    groups: groupRows.length,
    items: itemRows.length,
    monthlyValues: itemIds.length
      ? (await superuserDb.select().from(monthlyValues).where(inArray(monthlyValues.itemId, itemIds))).length
      : 0,
    transactions: yearIds.length
      ? (await superuserDb.select().from(transactions).where(inArray(transactions.yearId, yearIds))).length
      : 0,
    transfers: yearIds.length
      ? (await superuserDb.select().from(transfers).where(inArray(transfers.yearId, yearIds))).length
      : 0,
    accountBalances: yearIds.length
      ? (await superuserDb.select().from(accountBalances).where(inArray(accountBalances.yearId, yearIds))).length
      : 0,
    assets: assetRows.length,
    assetValues: assetIds.length
      ? (await superuserDb.select().from(assetValues).where(inArray(assetValues.assetId, assetIds))).length
      : 0,
    shares: (await superuserDb.select().from(budgetShares).where(eq(budgetShares.budgetId, budgetId))).length,
  };
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await superuserClient.end();
});

describe('deleteOwnedBudget', () => {
  it('deletes an owned budget, cascades budget data, and keeps accounts plus other budgets', async () => {
    const owner = await createUser('budget-delete-owner@test.com');
    const collaborator = await createUser('budget-delete-collaborator@test.com');
    const deletedFixture = await createPopulatedBudget(owner.id, 2091, 'To delete');
    const keptFixture = await createPopulatedBudget(owner.id, 2092, 'Keep me');
    await superuserDb
      .insert(budgetShares)
      .values({ budgetId: deletedFixture.budget.id, userId: collaborator.id, role: 'write' });

    const result = await withUserContext(owner.id, (tx) => deleteOwnedBudget(tx, owner.id, deletedFixture.budget.id));

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.defaultBudgetId).toBe(keptFixture.budget.id);
      expect(result.budgets.map((budget) => budget.id)).toEqual([keptFixture.budget.id]);
    }
    await expect(countByBudget(deletedFixture.budget.id)).resolves.toEqual({
      budgets: 0,
      years: 0,
      groups: 0,
      items: 0,
      monthlyValues: 0,
      transactions: 0,
      transfers: 0,
      accountBalances: 0,
      assets: 0,
      assetValues: 0,
      shares: 0,
    });
    await expect(
      superuserDb.select().from(budgetYears).where(eq(budgetYears.id, deletedFixture.year.id))
    ).resolves.toHaveLength(0);
    await expect(
      superuserDb.select().from(budgetGroups).where(eq(budgetGroups.id, deletedFixture.group.id))
    ).resolves.toHaveLength(0);
    await expect(
      superuserDb.select().from(budgetItems).where(eq(budgetItems.id, deletedFixture.item.id))
    ).resolves.toHaveLength(0);
    await expect(
      superuserDb.select().from(monthlyValues).where(eq(monthlyValues.id, deletedFixture.monthlyValue.id))
    ).resolves.toHaveLength(0);
    await expect(
      superuserDb.select().from(transactions).where(eq(transactions.id, deletedFixture.transaction.id))
    ).resolves.toHaveLength(0);
    await expect(
      superuserDb.select().from(transfers).where(eq(transfers.id, deletedFixture.transfer.id))
    ).resolves.toHaveLength(0);
    await expect(
      superuserDb.select().from(accountBalances).where(eq(accountBalances.id, deletedFixture.accountBalance.id))
    ).resolves.toHaveLength(0);
    await expect(superuserDb.select().from(assets).where(eq(assets.id, deletedFixture.asset.id))).resolves.toHaveLength(
      0
    );
    await expect(
      superuserDb.select().from(assetValues).where(eq(assetValues.id, deletedFixture.assetValue.id))
    ).resolves.toHaveLength(0);

    await expect(countByBudget(keptFixture.budget.id)).resolves.toMatchObject({
      budgets: 1,
      years: 1,
      groups: 1,
      items: 1,
      transactions: 1,
      transfers: 1,
      accountBalances: 1,
      assets: 1,
      assetValues: 1,
    });
    await expect(
      superuserDb.select().from(paymentMethods).where(eq(paymentMethods.id, deletedFixture.checking.id))
    ).resolves.toHaveLength(1);
    await expect(
      superuserDb.select().from(paymentMethods).where(eq(paymentMethods.id, deletedFixture.savings.id))
    ).resolves.toHaveLength(1);
  });

  it('rejects read/write collaborators and unrelated users without deleting the budget', async () => {
    const owner = await createUser('budget-delete-shared-owner@test.com');
    const reader = await createUser('budget-delete-reader@test.com');
    const writer = await createUser('budget-delete-writer@test.com');
    const outsider = await createUser('budget-delete-outsider@test.com');
    const fixture = await createPopulatedBudget(owner.id, 2093, 'Shared');
    await superuserDb.insert(budgetShares).values([
      { budgetId: fixture.budget.id, userId: reader.id, role: 'read' },
      { budgetId: fixture.budget.id, userId: writer.id, role: 'write' },
    ]);

    await expect(
      withUserContext(reader.id, (tx) => deleteOwnedBudget(tx, reader.id, fixture.budget.id))
    ).resolves.toEqual({
      status: 'shared',
    });
    await expect(
      withUserContext(writer.id, (tx) => deleteOwnedBudget(tx, writer.id, fixture.budget.id))
    ).resolves.toEqual({
      status: 'shared',
    });
    await expect(
      withUserContext(outsider.id, (tx) => deleteOwnedBudget(tx, outsider.id, fixture.budget.id))
    ).resolves.toEqual({
      status: 'not-found',
    });

    await expect(superuserDb.select().from(budgets).where(eq(budgets.id, fixture.budget.id))).resolves.toHaveLength(1);
  });

  it('creates a new default budget when the deleted budget was the last owned budget', async () => {
    const owner = await createUser('budget-delete-last-owner@test.com');
    const fixture = await createPopulatedBudget(owner.id, 2094, 'Only budget');

    const result = await withUserContext(owner.id, (tx) => deleteOwnedBudget(tx, owner.id, fixture.budget.id));

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.defaultBudgetId).not.toBe(fixture.budget.id);
      expect(result.budgets).toHaveLength(1);
      expect(result.budgets[0]).toMatchObject({ id: result.defaultBudgetId, role: 'owner' });
    }

    const remainingBudgets = await superuserDb.select().from(budgets).where(eq(budgets.userId, owner.id));
    expect(remainingBudgets).toHaveLength(1);
    expect(remainingBudgets[0].id).not.toBe(fixture.budget.id);

    const fallbackYears = await superuserDb
      .select()
      .from(budgetYears)
      .where(eq(budgetYears.budgetId, remainingBudgets[0].id));
    expect(fallbackYears).toHaveLength(1);
    await expect(
      superuserDb
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.userId, owner.id), eq(paymentMethods.name, fixture.checking.name)))
    ).resolves.toHaveLength(1);
  });
});
