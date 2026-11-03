import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenantContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import { createYear, deleteYear, getStartYear } from '../src/services/budget.js';

const client = postgres(process.env.DATABASE_URL!.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret'));
const admin = drizzle(client, { schema });

async function cleanup() {
  await admin.execute(
    sql`DELETE FROM budgets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'year-delete-%@test.com')`
  );
  await admin.execute(sql`DELETE FROM users WHERE email LIKE 'year-delete-%@test.com'`);
}

async function setup() {
  const [owner, writer, stranger] = await admin
    .insert(schema.users)
    .values([
      { email: 'year-delete-owner@test.com', passwordHash: 'test' },
      { email: 'year-delete-writer@test.com', passwordHash: 'test' },
      { email: 'year-delete-stranger@test.com', passwordHash: 'test' },
    ])
    .returning();
  const [budget, other] = await admin
    .insert(schema.budgets)
    .values([
      { userId: owner.id, startYear: 2026, description: 'Family' },
      { userId: owner.id, startYear: 2027, description: 'Other' },
    ])
    .returning();
  await admin.insert(schema.budgetShares).values({ budgetId: budget.id, userId: writer.id, role: 'write' });
  const years = await admin
    .insert(schema.budgetYears)
    .values([
      { budgetId: budget.id, year: 2026 },
      { budgetId: budget.id, year: 2027 },
      { budgetId: other.id, year: 2027 },
    ])
    .returning();
  const [group] = await admin
    .insert(schema.budgetGroups)
    .values({ budgetId: budget.id, name: 'Expenses', slug: 'expenses' })
    .returning();
  const items = await admin
    .insert(schema.budgetItems)
    .values(
      years.slice(0, 2).map((year) => ({
        yearId: year.id,
        groupId: group.id,
        name: 'Rent',
        slug: 'rent',
        yearlyBudget: '1200.00',
      }))
    )
    .returning();
  await admin
    .insert(schema.monthlyValues)
    .values(items.map((item) => ({ itemId: item.id, month: 1, budget: '100.00', actual: '90.00' })));
  const [checking, savings] = await admin
    .insert(schema.paymentMethods)
    .values([
      { userId: owner.id, name: 'Checking' },
      { userId: owner.id, name: 'Savings', isSavingsAccount: true },
    ])
    .returning();
  await admin
    .insert(schema.accountBalances)
    .values(
      years.slice(0, 2).map((year) => ({ yearId: year.id, paymentMethodId: checking.id, initialBalance: '1000.00' }))
    );
  const transactions = await admin
    .insert(schema.transactions)
    .values(
      years.slice(0, 2).map((year, index) => ({
        yearId: year.id,
        itemId: items[index].id,
        paymentMethodId: checking.id,
        date: `${year.year}-01-15`,
        amount: '90.00',
        accountingYear: year.year,
        accountingMonth: 1,
      }))
    )
    .returning();
  await admin.insert(schema.transfers).values(
    years.slice(0, 2).map((year) => ({
      yearId: year.id,
      sourceAccountId: checking.id,
      destinationAccountId: savings.id,
      date: `${year.year}-02-15`,
      amount: '10.00',
      accountingYear: year.year,
      accountingMonth: 2,
    }))
  );
  await admin.insert(schema.entryOrderOverrides).values(
    years.slice(0, 2).map((year, index) => ({
      yearId: year.id,
      entryType: 'transaction',
      entryId: transactions[index].id,
      sortOffset: 1,
    }))
  );
  const [asset] = await admin.insert(schema.assets).values({ budgetId: budget.id, name: 'Home' }).returning();
  await admin
    .insert(schema.assetValues)
    .values(years.slice(0, 2).map((year) => ({ assetId: asset.id, yearId: year.id, value: '5000.00' })));
  const run = <T>(fn: (tx: Parameters<typeof deleteYear>[0]) => Promise<T>, userId = owner.id) =>
    withTenantContext(userId, budget.id, fn);
  const remove = (year: number, userId = owner.id) => run((tx) => deleteYear(tx, year, budget.id, userId), userId);
  return { owner, writer, stranger, budget, other, years, items, group, checking, asset, run, remove };
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe('single budget year deletion', () => {
  it('cascades only the selected year, preserving shared data and allowing recreation with its preceding plan', async () => {
    const ctx = await setup();
    const target = ctx.years[1];
    expect(await ctx.remove(2027)).toEqual({ id: target.id });
    expect(await admin.select().from(schema.budgetYears).where(eq(schema.budgetYears.id, target.id))).toEqual([]);
    for (const table of [
      schema.budgetItems,
      schema.transactions,
      schema.transfers,
      schema.accountBalances,
      schema.assetValues,
      schema.entryOrderOverrides,
    ]) {
      expect(await admin.select().from(table).where(eq(table.yearId, target.id))).toEqual([]);
      expect(await admin.select().from(table).where(eq(table.yearId, ctx.years[0].id))).toHaveLength(1);
    }
    expect(
      await admin.select().from(schema.monthlyValues).where(eq(schema.monthlyValues.itemId, ctx.items[1].id))
    ).toEqual([]);
    expect(
      await admin.select().from(schema.monthlyValues).where(eq(schema.monthlyValues.itemId, ctx.items[0].id))
    ).toHaveLength(1);
    expect(await admin.select().from(schema.budgets).where(eq(schema.budgets.id, ctx.budget.id))).toHaveLength(1);
    expect(await admin.select().from(schema.budgetGroups).where(eq(schema.budgetGroups.id, ctx.group.id))).toHaveLength(
      1
    );
    expect(await admin.select().from(schema.assets).where(eq(schema.assets.id, ctx.asset.id))).toHaveLength(1);
    expect(
      await admin.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.userId, ctx.owner.id))
    ).toHaveLength(2);
    expect(
      await admin.select().from(schema.budgetShares).where(eq(schema.budgetShares.budgetId, ctx.budget.id))
    ).toHaveLength(1);
    expect(await admin.select().from(schema.budgetYears).where(eq(schema.budgetYears.budgetId, ctx.other.id))).toEqual([
      ctx.years[2],
    ]);

    const recreated = await ctx.run((tx) => createYear(tx, 2027, 0, ctx.budget.id, ctx.owner.id));
    expect(recreated.id).not.toBe(target.id);
    const copied = await admin.query.budgetItems.findFirst({
      where: eq(schema.budgetItems.yearId, recreated.id),
      orderBy: schema.budgetItems.id,
      with: { monthlyValues: true, transactions: true },
    });
    expect(copied?.yearlyBudget).toBe('1200.00');
    expect(Number(copied?.monthlyValues.find((value) => value.month === 1)?.budget)).toBe(100);
    expect(copied?.monthlyValues.every((value) => Number(value.actual) === 0)).toBe(true);
    expect(copied?.transactions).toEqual([]);
    expect(await admin.select().from(schema.transfers).where(eq(schema.transfers.yearId, recreated.id))).toEqual([]);
  });

  it('refuses to delete the final year and leaves it intact', async () => {
    const ctx = await setup();
    await ctx.remove(2027);
    await expect(ctx.remove(2026)).rejects.toMatchObject({ statusCode: 400, code: 'CANNOT_DELETE_LAST_BUDGET_YEAR' });
    expect(
      await admin.select().from(schema.budgetYears).where(eq(schema.budgetYears.budgetId, ctx.budget.id))
    ).toHaveLength(1);
  });

  it('serializes simultaneous deletions so at least one year remains', async () => {
    const ctx = await setup();
    const results = await Promise.allSettled([ctx.remove(2026), ctx.remove(2027)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await admin.select().from(schema.budgetYears).where(eq(schema.budgetYears.budgetId, ctx.budget.id))
    ).toHaveLength(1);
  });

  it('rejects collaborators and outsiders even when called directly', async () => {
    const ctx = await setup();
    await expect(ctx.remove(2027, ctx.writer.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ctx.remove(2027, ctx.stranger.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await admin.select().from(schema.budgetYears).where(eq(schema.budgetYears.budgetId, ctx.budget.id))
    ).toHaveLength(2);
  });

  it('does not delete a year absent from the selected budget', async () => {
    const ctx = await setup();
    expect(await ctx.remove(2028)).toBeNull();
  });

  it('keeps the inheritance anchor but returns a remaining year for legacy defaults', async () => {
    const ctx = await setup();
    await ctx.remove(2026);
    expect(await ctx.run((tx) => getStartYear(tx, ctx.budget.id))).toBe(2027);
    const storedBudget = await admin.query.budgets.findFirst({ where: eq(schema.budgets.id, ctx.budget.id) });
    expect(storedBudget?.startYear).toBe(2026);
  });
});
