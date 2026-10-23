import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenantContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import * as accountsSvc from '../src/services/accounts.js';
import { getBudgetSummary } from '../src/services/budget.js';

const adminClient = postgres(process.env.DATABASE_URL!.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret'));
const adminDb = drizzle(adminClient, { schema });

async function cleanup() {
  await adminDb.execute(
    sql`DELETE FROM budgets WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'account-links-%@test.com')`
  );
  await adminDb.execute(sql`DELETE FROM users WHERE email LIKE 'account-links-%@test.com'`);
}

async function setup(yearNumbers = [2025, 2026, 2027]) {
  const [user] = await adminDb
    .insert(schema.users)
    .values({ email: 'account-links-owner@test.com', passwordHash: 'test' })
    .returning();
  const [budget] = await adminDb.insert(schema.budgets).values({ userId: user.id, startYear: 2025 }).returning();
  const years = await adminDb
    .insert(schema.budgetYears)
    .values(yearNumbers.map((year) => ({ budgetId: budget.id, year })))
    .returning();
  const [checking, savings] = await adminDb
    .insert(schema.paymentMethods)
    .values([
      { userId: user.id, name: 'Checking' },
      { userId: user.id, name: 'Savings', isSavingsAccount: true },
    ])
    .returning();
  const [card] = await adminDb
    .insert(schema.paymentMethods)
    .values({ userId: user.id, name: 'Card', linkedPaymentMethodId: checking.id })
    .returning();
  const [expenseGroup] = await adminDb
    .insert(schema.budgetGroups)
    .values({ budgetId: budget.id, name: 'Expenses', slug: 'expenses', type: 'expense' })
    .returning();
  const items = await adminDb
    .insert(schema.budgetItems)
    .values(years.map((year) => ({ yearId: year.id, groupId: expenseGroup.id, name: 'Expenses', slug: 'expenses' })))
    .returning();
  await adminDb.insert(schema.accountBalances).values(
    years.map((year) => ({
      yearId: year.id,
      paymentMethodId: checking.id,
      initialBalance: year.year === 2025 ? '1000' : '9999',
    }))
  );
  const run = <T>(fn: (tx: Parameters<typeof accountsSvc.getAccountsForYear>[0]) => Promise<T>) =>
    withTenantContext(user.id, budget.id, fn);
  const accounts = (year: number) => run((tx) => accountsSvc.getAccountsForYear(tx, year, budget.id, user.id));
  const account = async (year: number, id = checking.id) =>
    (await accounts(year)).accounts.find((account) => account.id === id)!;
  const expense = async (year: number, amount: string, methodId = checking.id, accountingYear = year) => {
    const [transaction] = await adminDb
      .insert(schema.transactions)
      .values({
        yearId: years.find((row) => row.year === year)!.id,
        itemId: items.find((item) => item.yearId === years.find((row) => row.year === year)!.id)!.id,
        date: `${year}-01-15`,
        amount,
        paymentMethodId: methodId,
        accountingMonth: 1,
        accountingYear,
      })
      .returning();
    return transaction;
  };
  return { user, budget, years, checking, savings, card, run, account, accounts, expense };
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await adminClient.end();
});

describe('calculated closing and live year opening balances', () => {
  it('migrates only legacy explicit parent start-year overrides, relinking all later snapshots', async () => {
    const migration = readFileSync(
      new URL('../drizzle/0036_add_opening_balance_overrides.sql', import.meta.url),
      'utf8'
    );
    await adminClient.begin(async (tx) => {
      await tx`CREATE TEMP TABLE budgets (id integer, start_year integer, parent_budget_id integer) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE budget_years (id integer, budget_id integer, year integer) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE account_balances (id integer, year_id integer, inherited_from_parent boolean) ON COMMIT DROP`;
      await tx`INSERT INTO budgets VALUES (1, 2025, NULL), (2, 2026, 1)`;
      await tx`INSERT INTO budget_years VALUES (10, 1, 2025), (20, 2, 2026), (21, 2, 2027)`;
      await tx`INSERT INTO account_balances VALUES (1, 10, false), (2, 20, false), (3, 20, true), (4, 21, false)`;
      await tx.unsafe(migration);
      const rows = await tx`SELECT id, opening_balance_overridden FROM account_balances ORDER BY id`;
      expect([...rows]).toEqual([
        { id: 1, opening_balance_overridden: false },
        { id: 2, opening_balance_overridden: true },
        { id: 3, opening_balance_overridden: false },
        { id: 4, opening_balance_overridden: false },
      ]);
    });
  });

  it('ignores old snapshots and propagates activity edits and deletion through three years and summaries', async () => {
    const ctx = await setup();
    const expense = await ctx.expense(2025, '100');
    await ctx.expense(2026, '50', ctx.card.id);
    expect(await ctx.account(2025)).toMatchObject({
      initialBalance: 1000,
      endOfYearBalance: 900,
      linkedFromYear: null,
      canRestoreBalanceLink: false,
      openingBalanceOverridden: false,
    });
    expect(await ctx.account(2026)).toMatchObject({
      initialBalance: 900,
      endOfYearBalance: 850,
      linkedFromYear: 2025,
      canRestoreBalanceLink: true,
      openingBalanceOverridden: false,
    });
    expect((await ctx.account(2027)).initialBalance).toBe(850);
    await adminDb.update(schema.transactions).set({ amount: '200' }).where(eq(schema.transactions.id, expense.id));
    expect((await ctx.account(2027)).initialBalance).toBe(750);
    const effective = await ctx.run((tx) =>
      accountsSvc.getEffectiveInitialBalanceMap(tx, 2027, ctx.budget.id, ctx.user.id)
    );
    expect(effective.get(ctx.checking.id)!.toNumber()).toBe(750);
    const summary = await ctx.run((tx) => getBudgetSummary(tx, 2027, ctx.budget.id, ctx.user.id));
    expect(summary.initialBalance).toBe(750);
    await adminDb.delete(schema.transactions).where(eq(schema.transactions.id, expense.id));
    expect((await ctx.account(2027)).initialBalance).toBe(950);
  });

  it('makes a saved override a propagation boundary and restores the live source', async () => {
    const ctx = await setup();
    const expense = await ctx.expense(2025, '100');
    await ctx.expense(2026, '50');
    await ctx.run((tx) => accountsSvc.setAccountBalance(tx, 2026, ctx.checking.id, 500, ctx.budget.id, ctx.user.id));
    expect(await ctx.account(2026)).toMatchObject({
      initialBalance: 500,
      endOfYearBalance: 450,
      linkedFromYear: null,
      openingBalanceOverridden: true,
      canRestoreBalanceLink: true,
    });
    expect((await ctx.account(2027)).initialBalance).toBe(450);
    await adminDb.update(schema.transactions).set({ amount: '200' }).where(eq(schema.transactions.id, expense.id));
    expect((await ctx.account(2027)).initialBalance).toBe(450);
    await ctx.run((tx) => accountsSvc.restoreAccountBalanceLink(tx, 2026, ctx.checking.id, ctx.budget.id, ctx.user.id));
    expect(await ctx.account(2026)).toMatchObject({
      initialBalance: 800,
      linkedFromYear: 2025,
      openingBalanceOverridden: false,
    });
    expect((await ctx.account(2027)).initialBalance).toBe(750);
    const [stored] = await adminDb
      .select()
      .from(schema.accountBalances)
      .where(
        and(
          eq(schema.accountBalances.yearId, ctx.years[1].id),
          eq(schema.accountBalances.paymentMethodId, ctx.checking.id)
        )
      );
    expect(stored.openingBalanceOverridden).toBe(false);
  });

  it('uses the nearest available year across gaps and follows inserted and deleted intervening years', async () => {
    const ctx = await setup([2025, 2028]);
    await ctx.expense(2025, '1100');
    expect(await ctx.account(2028)).toMatchObject({ initialBalance: -100, linkedFromYear: 2025 });
    const [middle] = await adminDb
      .insert(schema.budgetYears)
      .values({ budgetId: ctx.budget.id, year: 2026 })
      .returning();
    await ctx.run((tx) => accountsSvc.setAccountBalance(tx, 2026, ctx.checking.id, 0, ctx.budget.id, ctx.user.id));
    expect(await ctx.account(2028)).toMatchObject({ initialBalance: 0, linkedFromYear: 2026 });
    await adminDb.delete(schema.budgetYears).where(eq(schema.budgetYears.id, middle.id));
    expect(await ctx.account(2028)).toMatchObject({ initialBalance: -100, linkedFromYear: 2025 });
  });

  it('links missing rows and applies accounting-year activity, savings categories and both transfer legs once', async () => {
    const ctx = await setup();
    await ctx.expense(2025, '100', ctx.card.id);
    await ctx.expense(2025, '25', ctx.checking.id, 2026);
    const [group] = await adminDb
      .insert(schema.budgetGroups)
      .values({ budgetId: ctx.budget.id, name: 'Savings', slug: 'savings', type: 'savings' })
      .returning();
    const [item] = await adminDb
      .insert(schema.budgetItems)
      .values({
        yearId: ctx.years[0].id,
        groupId: group.id,
        name: 'Savings',
        slug: 'savings',
        savingsAccountId: ctx.savings.id,
      })
      .returning();
    await adminDb.insert(schema.transactions).values({
      yearId: ctx.years[0].id,
      itemId: item.id,
      date: '2025-01-15',
      amount: '50',
      paymentMethodId: ctx.card.id,
      accountingMonth: 1,
      accountingYear: 2025,
    });
    await adminDb.insert(schema.transfers).values({
      yearId: ctx.years[0].id,
      date: '2025-12-20',
      amount: '100',
      sourceAccountId: ctx.checking.id,
      destinationAccountId: ctx.savings.id,
      accountingMonth: 12,
      accountingYear: 2025,
      destinationAccountingMonth: 1,
      destinationAccountingYear: 2026,
    });
    expect(await ctx.account(2025)).toMatchObject({ initialBalance: 1000, endOfYearBalance: 750 });
    expect(await ctx.account(2025, ctx.savings.id)).toMatchObject({ endOfYearBalance: 50 });
    expect(await ctx.account(2026)).toMatchObject({ initialBalance: 750, endOfYearBalance: 725 });
    expect(await ctx.account(2026, ctx.savings.id)).toMatchObject({
      initialBalance: 50,
      endOfYearBalance: 150,
      linkedFromYear: 2025,
    });
  });

  it('retains cent precision over a longer chain without caching across requests', async () => {
    const ctx = await setup(Array.from({ length: 10 }, (_, index) => 2025 + index));
    await ctx.run((tx) => accountsSvc.setAccountBalance(tx, 2025, ctx.checking.id, 0.3, ctx.budget.id, ctx.user.id));
    const transaction = await ctx.expense(2025, '0.10');
    await ctx.expense(2026, '0.10');
    const readsByYear = new Map<number, number>();
    await ctx.run((tx) => {
      const countedTx = new Proxy(tx, {
        get(target, property) {
          if (property !== 'query') return Reflect.get(target, property);
          return {
            ...target.query,
            budgetYears: {
              ...target.query.budgetYears,
              findFirst: async (options: Parameters<typeof tx.query.budgetYears.findFirst>[0]) => {
                const row = await target.query.budgetYears.findFirst(options);
                if (row) readsByYear.set(row.year, (readsByYear.get(row.year) ?? 0) + 1);
                return row;
              },
            },
          };
        },
      });
      return accountsSvc.getAccountsForYear(countedTx, 2034, ctx.budget.id, ctx.user.id);
    });
    expect(readsByYear.size).toBe(10);
    expect([...readsByYear.values()]).toEqual(Array(10).fill(1));
    expect(await ctx.account(2034)).toMatchObject({ initialBalance: 0.1, endOfYearBalance: 0.1, linkedFromYear: 2033 });
    await adminDb.update(schema.transactions).set({ amount: '0.20' }).where(eq(schema.transactions.id, transaction.id));
    expect((await ctx.account(2034)).initialBalance).toBe(0);
  });

  it('rejects restoration without a source or for foreign or linked payment methods', async () => {
    const ctx = await setup();
    await expect(
      ctx.run((tx) => accountsSvc.restoreAccountBalanceLink(tx, 2025, ctx.checking.id, ctx.budget.id, ctx.user.id))
    ).rejects.toThrow('No balance link');
    await expect(
      ctx.run((tx) => accountsSvc.restoreAccountBalanceLink(tx, 2026, ctx.card.id, ctx.budget.id, ctx.user.id))
    ).rejects.toThrow('Payment method');
    const [other] = await adminDb
      .insert(schema.users)
      .values({ email: 'account-links-other@test.com', passwordHash: 'test' })
      .returning();
    const [foreign] = await adminDb
      .insert(schema.paymentMethods)
      .values({ userId: other.id, name: 'Foreign' })
      .returning();
    await expect(
      ctx.run((tx) => accountsSvc.restoreAccountBalanceLink(tx, 2026, foreign.id, ctx.budget.id, ctx.user.id))
    ).rejects.toThrow('Payment method');
    await expect(
      ctx.run((tx) => accountsSvc.setAccountBalance(tx, 2026, foreign.id, 10, ctx.budget.id, ctx.user.id))
    ).rejects.toThrow('Payment method');
  });
});
