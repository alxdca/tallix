import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenantContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import { getAccountsForYear } from '../src/services/accounts.js';
import { getBudgetDataForYear } from '../src/services/budget.js';
import { createTransfer, updateTransfer } from '../src/services/transfers.js';

const adminUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret')
  : `postgresql://${process.env.POSTGRES_USER || 'tallix'}:${process.env.POSTGRES_PASSWORD || 'tallix_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;
const adminClient = postgres(adminUrl);
const adminDb = drizzle(adminClient, { schema });

async function cleanup() {
  await adminDb.execute(
    sql`DELETE FROM budgets WHERE user_id IN (SELECT id FROM users WHERE email = 'transfer-periods@test.com')`
  );
  await adminDb.execute(sql`DELETE FROM users WHERE email = 'transfer-periods@test.com'`);
}

async function setup() {
  const [user] = await adminDb
    .insert(schema.users)
    .values({ email: 'transfer-periods@test.com', passwordHash: 'test' })
    .returning();
  const [budget] = await adminDb.insert(schema.budgets).values({ userId: user.id, startYear: 2026 }).returning();
  const years = await adminDb
    .insert(schema.budgetYears)
    .values([2026, 2027].map((year) => ({ budgetId: budget.id, year })))
    .returning();
  const [cembra, revolut, savings] = await adminDb
    .insert(schema.paymentMethods)
    .values([
      { userId: user.id, name: 'Cembra', settlementDay: 20 },
      { userId: user.id, name: 'Revolut' },
      { userId: user.id, name: 'Savings', isSavingsAccount: true },
    ])
    .returning();
  await adminDb.insert(schema.accountBalances).values(
    years.flatMap((year) =>
      [cembra, revolut, savings].map((account) => ({
        yearId: year.id,
        paymentMethodId: account.id,
        initialBalance: '0',
        inheritedFromParent: false,
      }))
    )
  );
  const [group] = await adminDb
    .insert(schema.budgetGroups)
    .values({ budgetId: budget.id, name: 'Savings', slug: 'savings', type: 'savings' })
    .returning();
  await adminDb.insert(schema.budgetItems).values(
    years.map((year) => ({
      yearId: year.id,
      groupId: group.id,
      name: 'Savings',
      slug: 'savings',
      savingsAccountId: savings.id,
    }))
  );
  const run = <T>(callback: (tx: Parameters<typeof getAccountsForYear>[0]) => Promise<T>) =>
    withTenantContext(user.id, budget.id, callback);
  const accounts = (year: number) => run((tx) => getAccountsForYear(tx, year, budget.id, user.id));
  const budgetData = (year: number) => run((tx) => getBudgetDataForYear(tx, year, budget.id, user.id));
  const create = (date: string, extra: Partial<Parameters<typeof createTransfer>[2]> = {}) =>
    run((tx) =>
      createTransfer(
        tx,
        2026,
        {
          date,
          amount: 200,
          sourceAccountId: cembra.id,
          destinationAccountId: revolut.id,
          ...extra,
        },
        budget.id,
        user.id
      )
    );
  return { user, budget, years, cembra, revolut, savings, run, accounts, budgetData, create };
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await adminClient.end();
});

describe('transfer accounting balances', () => {
  it('backfills existing transfer periods without changing their timing', async () => {
    const migration = readFileSync(
      new URL('../drizzle/0035_add_transfer_destination_accounting.sql', import.meta.url),
      'utf8'
    );
    await adminClient.begin(async (tx) => {
      await tx`CREATE TEMP TABLE transfers (accounting_month integer NOT NULL, accounting_year integer NOT NULL) ON COMMIT DROP`;
      await tx`INSERT INTO transfers (accounting_month, accounting_year) VALUES (9, 2026), (1, 2027)`;
      await tx.unsafe(migration);
      const rows =
        await tx`SELECT accounting_month, accounting_year, destination_accounting_month, destination_accounting_year FROM transfers ORDER BY accounting_year`;
      expect([...rows]).toEqual([
        {
          accounting_month: 9,
          accounting_year: 2026,
          destination_accounting_month: 9,
          destination_accounting_year: 2026,
        },
        {
          accounting_month: 1,
          accounting_year: 2027,
          destination_accounting_month: 1,
          destination_accounting_year: 2027,
        },
      ]);
    });
  });

  it('credits Revolut in August and debits the Cembra statement in September', async () => {
    const ctx = await setup();
    await ctx.create('2026-08-24');
    const result = await ctx.accounts(2026);
    const revolut = result.accounts.find((account) => account.id === ctx.revolut.id)!;
    const cembra = result.accounts.find((account) => account.id === ctx.cembra.id)!;
    expect(revolut.monthlyBalances[6]).toBe(0);
    expect(revolut.monthlyBalances[7]).toBe(200);
    expect(revolut.monthlyBalances[8]).toBe(200);
    expect(cembra.monthlyBalances[7]).toBe(0);
    expect(cembra.monthlyBalances[8]).toBe(-200);
    expect(result.lastActiveMonth).toBe(9);
  });

  it('posts each side only in its own year across December and January', async () => {
    const ctx = await setup();
    await ctx.create('2026-12-24');
    const december = await ctx.accounts(2026);
    const january = await ctx.accounts(2027);
    expect(december.accounts.find((account) => account.id === ctx.revolut.id)!.monthlyBalances[11]).toBe(200);
    expect(december.accounts.find((account) => account.id === ctx.cembra.id)!.monthlyBalances[11]).toBe(0);
    expect(january.accounts.find((account) => account.id === ctx.cembra.id)!.monthlyBalances[0]).toBe(-200);
    expect(january.accounts.find((account) => account.id === ctx.revolut.id)!.monthlyBalances[0]).toBe(0);
    expect(december.lastActiveMonth).toBe(12);
    expect(january.lastActiveMonth).toBe(1);
  });

  it('lets an existing September transfer receive an August destination override', async () => {
    const ctx = await setup();
    const transfer = await ctx.create('2026-08-24', { accountingMonth: 9, accountingYear: 2026 });
    await ctx.run((tx) =>
      updateTransfer(
        tx,
        transfer.id,
        { destinationAccountingMonth: 8, destinationAccountingYear: 2026 },
        ctx.budget.id,
        ctx.user.id
      )
    );
    const result = await ctx.accounts(2026);
    expect(result.accounts.find((account) => account.id === ctx.revolut.id)!.monthlyBalances[7]).toBe(200);
    expect(result.accounts.find((account) => account.id === ctx.cembra.id)!.monthlyBalances[7]).toBe(0);
    expect(result.accounts.find((account) => account.id === ctx.cembra.id)!.monthlyBalances[8]).toBe(-200);
  });

  it('preserves the shared period for legacy rows without destination fields', async () => {
    const ctx = await setup();
    await adminDb.insert(schema.transfers).values({
      yearId: ctx.years[0].id,
      date: '2026-08-24',
      amount: '200',
      sourceAccountId: ctx.cembra.id,
      destinationAccountId: ctx.revolut.id,
      accountingMonth: 9,
      accountingYear: 2026,
    });
    const result = await ctx.accounts(2026);
    expect(result.accounts.find((account) => account.id === ctx.revolut.id)!.monthlyBalances[7]).toBe(0);
    expect(result.accounts.find((account) => account.id === ctx.revolut.id)!.monthlyBalances[8]).toBe(200);
  });

  it('uses the destination period for savings actuals without counting a transfer as an expense', async () => {
    const ctx = await setup();
    await ctx.create('2026-08-24', { destinationAccountId: ctx.savings.id });
    const data = await ctx.budgetData(2026);
    const item = data.groups.find((group) => group.type === 'savings')!.items[0];
    expect(item.months[7].actual).toBe(200);
    expect(item.months[8].actual).toBe(0);
    expect(data.groups.filter((group) => group.type === 'expense').flatMap((group) => group.items)).toEqual([]);
  });

  it('includes incoming savings from a transfer entered in the previous budget year', async () => {
    const ctx = await setup();
    await ctx.create('2026-12-15', {
      destinationAccountId: ctx.savings.id,
      destinationAccountingMonth: 1,
      destinationAccountingYear: 2027,
    });
    const january = await ctx.accounts(2027);
    expect(january.accounts.find((account) => account.id === ctx.savings.id)!.monthlyBalances[0]).toBe(200);
    const data = await ctx.budgetData(2027);
    expect(data.groups.find((group) => group.type === 'savings')!.items[0].months[0].actual).toBe(200);
    const priorData = await ctx.budgetData(2026);
    expect(priorData.groups.find((group) => group.type === 'savings')!.items[0].months[11].actual).toBe(0);
  });

  it('uses the source period for a savings withdrawal with an earlier destination period', async () => {
    const ctx = await setup();
    await ctx.create('2026-08-24', {
      sourceAccountId: ctx.savings.id,
      sourceAccountingMonth: 9,
      sourceAccountingYear: 2026,
    });
    const data = await ctx.budgetData(2026);
    const item = data.groups.find((group) => group.type === 'savings')!.items[0];
    expect(item.months[7].actual).toBe(0);
    expect(item.months[8].actual).toBe(-200);
    const result = await ctx.accounts(2026);
    expect(result.accounts.find((account) => account.id === ctx.savings.id)!.monthlyBalances[7]).toBe(0);
    expect(result.accounts.find((account) => account.id === ctx.savings.id)!.monthlyBalances[8]).toBe(-200);
    expect(result.accounts.find((account) => account.id === ctx.revolut.id)!.monthlyBalances[7]).toBe(200);
  });
});
