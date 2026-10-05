import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withInheritedBalanceReadContext, withTenantContext, withUserContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import { getAccountsForYear, setAccountBalance } from '../src/services/accounts.js';
import { createYear, getBudgetSummary } from '../src/services/budget.js';
import {
  createYearlyBudget,
  deleteOwnedBudget,
  ParentBudgetNotFoundError,
  ParentBudgetYearMismatchError,
} from '../src/services/budgets.js';

const {
  accountBalances,
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
      SELECT id FROM users WHERE email LIKE 'parent-budget-%@test.com'
    )
  `);
  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE 'parent-budget-%@test.com'`);
}

async function createUser(email: string) {
  const [user] = await superuserDb
    .insert(users)
    .values({ email, passwordHash: 'hash', name: email.split('@')[0] })
    .returning();
  return user;
}

async function createParentBudget(userId: string, startYear: number) {
  const [budget] = await superuserDb
    .insert(budgets)
    .values({ userId, startYear, description: `Parent ${startYear}` })
    .returning();
  const [year] = await superuserDb.insert(budgetYears).values({ budgetId: budget.id, year: startYear }).returning();
  const [savingsAccount] = await superuserDb
    .insert(paymentMethods)
    .values({ userId, name: 'Emergency', institution: 'Bank', sortOrder: 1, isSavingsAccount: true })
    .returning();
  const [checkingAccount] = await superuserDb
    .insert(paymentMethods)
    .values({ userId, name: 'Checking', institution: 'Bank', sortOrder: 0 })
    .returning();
  const [linkedCard] = await superuserDb
    .insert(paymentMethods)
    .values({ userId, name: 'Card', sortOrder: 2, linkedPaymentMethodId: checkingAccount.id })
    .returning();

  const [dailyGroup] = await superuserDb
    .insert(budgetGroups)
    .values({ budgetId: budget.id, name: 'Daily Life', slug: 'daily-life', type: 'expense', sortOrder: 2 })
    .returning();
  const [dailyItem] = await superuserDb
    .insert(budgetItems)
    .values({
      yearId: year.id,
      groupId: dailyGroup.id,
      name: 'Groceries',
      slug: 'groceries',
      sortOrder: 3,
      yearlyBudget: '6000.00',
    })
    .returning();
  await superuserDb
    .insert(monthlyValues)
    .values({ itemId: dailyItem.id, month: 1, budget: '800.00', actual: '700.00' });
  await superuserDb.insert(accountBalances).values([
    { yearId: year.id, paymentMethodId: checkingAccount.id, initialBalance: '1000.00' },
    { yearId: year.id, paymentMethodId: savingsAccount.id, initialBalance: '200.00' },
    { yearId: year.id, paymentMethodId: linkedCard.id, initialBalance: '999.00' },
  ]);
  await superuserDb.insert(transactions).values({
    yearId: year.id,
    itemId: dailyItem.id,
    date: `${startYear}-01-10`,
    amount: '100.00',
    paymentMethodId: checkingAccount.id,
    accountingMonth: 1,
    accountingYear: startYear,
  });

  const [savingsGroup] = await superuserDb
    .insert(budgetGroups)
    .values({ budgetId: budget.id, name: 'Parent Savings', slug: 'epargne', type: 'savings', sortOrder: 5 })
    .returning();
  const [savingsItem] = await superuserDb
    .insert(budgetItems)
    .values({
      yearId: year.id,
      groupId: savingsGroup.id,
      name: 'Parent Emergency',
      slug: `savings-${savingsAccount.id}`,
      sortOrder: 7,
      yearlyBudget: '1234.00',
      savingsAccountId: savingsAccount.id,
    })
    .returning();
  await superuserDb
    .insert(monthlyValues)
    .values({ itemId: savingsItem.id, month: 1, budget: '500.00', actual: '25.00' });
  await superuserDb.insert(transfers).values({
    yearId: year.id,
    date: `${startYear}-12-15`,
    amount: '250.00',
    sourceAccountId: checkingAccount.id,
    destinationAccountId: savingsAccount.id,
    accountingMonth: 12,
    accountingYear: startYear,
  });

  return {
    budget,
    year,
    checkingAccount,
    savingsAccount,
    linkedCard,
    dailyGroup,
    dailyItem,
    savingsGroup,
    savingsItem,
  };
}

async function getChildItems(childBudgetId: number) {
  const [childYear] = await superuserDb.select().from(budgetYears).where(eq(budgetYears.budgetId, childBudgetId));
  const groups = await superuserDb
    .select()
    .from(budgetGroups)
    .where(eq(budgetGroups.budgetId, childBudgetId))
    .orderBy(budgetGroups.sortOrder);
  const items = await superuserDb
    .select()
    .from(budgetItems)
    .where(eq(budgetItems.yearId, childYear.id))
    .orderBy(budgetItems.sortOrder);
  const itemIds = items.map((item) => item.id);
  const values = itemIds.length
    ? await superuserDb.select().from(monthlyValues).where(inArray(monthlyValues.itemId, itemIds))
    : [];

  return { childYear, groups, items, values };
}

async function getAccountBalances(yearId: number) {
  return await superuserDb
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.yearId, yearId))
    .orderBy(accountBalances.paymentMethodId);
}

async function getEffectiveAccounts(ownerId: string, budgetId: number, year: number, requesterId = ownerId) {
  return await withTenantContext(requesterId, budgetId, (tx) => getAccountsForYear(tx, year, budgetId, ownerId));
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await superuserClient.end();
});

describe('parent budget creation', () => {
  it('persists the parent link, imports category structure, and inherits live parent December balances', async () => {
    const owner = await createUser('parent-budget-owner@test.com');
    const parent = await createParentBudget(owner.id, 2098);

    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2099, 'Child', parent.budget.id)
    );

    expect(child.parentBudgetId).toBe(parent.budget.id);

    const [storedChild] = await superuserDb.select().from(budgets).where(eq(budgets.id, child.id));
    expect(storedChild.parentBudgetId).toBe(parent.budget.id);

    const { childYear, groups, items, values } = await getChildItems(child.id);
    expect(
      groups.map((group) => ({ name: group.name, slug: group.slug, type: group.type, sortOrder: group.sortOrder }))
    ).toEqual([
      { name: 'Daily Life', slug: 'daily-life', type: 'expense', sortOrder: 2 },
      { name: 'Parent Savings', slug: 'epargne', type: 'savings', sortOrder: 5 },
    ]);

    expect(items.map((item) => ({ name: item.name, slug: item.slug, sortOrder: item.sortOrder }))).toEqual([
      { name: 'Groceries', slug: 'groceries', sortOrder: 3 },
      { name: 'Parent Emergency', slug: `savings-${parent.savingsAccount.id}`, sortOrder: 7 },
    ]);
    expect(items.map((item) => item.savingsAccountId).filter((id) => id === parent.savingsAccount.id)).toHaveLength(1);
    expect(items.every((item) => Number(item.yearlyBudget) === 0)).toBe(true);
    expect(values).toHaveLength(24);
    expect(values.every((value) => Number(value.budget) === 0 && Number(value.actual) === 0)).toBe(true);

    const childBalances = await getAccountBalances(childYear.id);
    expect(childBalances).toHaveLength(2);
    expect(childBalances).toContainEqual(
      expect.objectContaining({
        paymentMethodId: parent.checkingAccount.id,
        initialBalance: '650.00',
        inheritedFromParent: true,
      })
    );
    expect(childBalances).toContainEqual(
      expect.objectContaining({
        paymentMethodId: parent.savingsAccount.id,
        initialBalance: '450.00',
        inheritedFromParent: true,
      })
    );

    await superuserDb.insert(transactions).values({
      yearId: parent.year.id,
      itemId: parent.dailyItem.id,
      date: '2098-12-20',
      amount: '300.00',
      paymentMethodId: parent.checkingAccount.id,
      accountingMonth: 12,
      accountingYear: 2098,
    });

    const accountsAfterParentEdit = await getEffectiveAccounts(owner.id, child.id, 2099);
    expect(accountsAfterParentEdit.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 350,
        inheritedFromParent: true,
      })
    );
    expect(accountsAfterParentEdit.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.savingsAccount.id,
        initialBalance: 450,
        inheritedFromParent: true,
      })
    );

    const summaryAfterParentEdit = await withTenantContext(owner.id, child.id, (tx) =>
      getBudgetSummary(tx, 2099, child.id, owner.id)
    );
    expect(summaryAfterParentEdit.initialBalance).toBe(350);
    expect(summaryAfterParentEdit.remainingBalance).toBe(350);

    await withUserContext(owner.id, (tx) => deleteOwnedBudget(tx, owner.id, parent.budget.id));
    const [storedChildAfterParentDeletion] = await superuserDb.select().from(budgets).where(eq(budgets.id, child.id));
    expect(storedChildAfterParentDeletion.parentBudgetId).toBeNull();
    const frozenBalances = await getAccountBalances(childYear.id);
    expect(frozenBalances).toHaveLength(2);
    expect(frozenBalances).toContainEqual(
      expect.objectContaining({
        paymentMethodId: parent.checkingAccount.id,
        initialBalance: '350.00',
        inheritedFromParent: false,
      })
    );
    expect(frozenBalances).toContainEqual(
      expect.objectContaining({
        paymentMethodId: parent.savingsAccount.id,
        initialBalance: '450.00',
        inheritedFromParent: false,
      })
    );
    expect((await getChildItems(child.id)).items).toHaveLength(items.length);
  });

  it('lets a child override one inherited account while other accounts keep following the parent', async () => {
    const owner = await createUser('parent-budget-override-owner@test.com');
    const parent = await createParentBudget(owner.id, 2105);
    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2106, 'Child', parent.budget.id)
    );

    await withTenantContext(owner.id, child.id, (tx) =>
      setAccountBalance(tx, 2106, parent.checkingAccount.id, 777, child.id, owner.id)
    );
    await superuserDb.insert(transfers).values({
      yearId: parent.year.id,
      date: '2105-12-20',
      amount: '50.00',
      sourceAccountId: parent.checkingAccount.id,
      destinationAccountId: parent.savingsAccount.id,
      accountingMonth: 12,
      accountingYear: 2105,
    });

    const accounts = await getEffectiveAccounts(owner.id, child.id, 2106);
    expect(accounts.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 777,
        inheritedFromParent: false,
      })
    );
    expect(accounts.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.savingsAccount.id,
        initialBalance: 500,
        inheritedFromParent: true,
      })
    );
  });

  it('does not use legacy parent inheritance for non-start years inside a child budget', async () => {
    const owner = await createUser('parent-budget-child-extra-year-owner@test.com');
    const parent = await createParentBudget(owner.id, 2130);
    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2131, 'Child', parent.budget.id)
    );
    const { childYear } = await getChildItems(child.id);
    await superuserDb
      .update(budgetItems)
      .set({ slug: 'emergency-fund' })
      .where(and(eq(budgetItems.yearId, childYear.id), eq(budgetItems.savingsAccountId, parent.savingsAccount.id)));

    await withTenantContext(owner.id, child.id, (tx) => createYear(tx, 2129, 0, child.id, owner.id));
    await withTenantContext(owner.id, child.id, (tx) => createYear(tx, 2132, 0, child.id, owner.id));

    const [laterYear] = await superuserDb
      .select()
      .from(budgetYears)
      .where(and(eq(budgetYears.budgetId, child.id), eq(budgetYears.year, 2132)));
    const laterSavingsItems = await superuserDb
      .select()
      .from(budgetItems)
      .where(and(eq(budgetItems.yearId, laterYear.id), eq(budgetItems.savingsAccountId, parent.savingsAccount.id)));
    expect(laterSavingsItems).toHaveLength(1);

    const earlierAccounts = await getEffectiveAccounts(owner.id, child.id, 2129);
    expect(earlierAccounts.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 0,
        inheritedFromParent: false,
      })
    );

    const laterAccountsBeforeParentEdit = await getEffectiveAccounts(owner.id, child.id, 2132);
    expect(laterAccountsBeforeParentEdit.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 650,
        inheritedFromParent: false,
      })
    );

    await superuserDb.insert(transactions).values({
      yearId: parent.year.id,
      itemId: parent.dailyItem.id,
      date: '2130-12-20',
      amount: '300.00',
      paymentMethodId: parent.checkingAccount.id,
      accountingMonth: 12,
      accountingYear: 2130,
    });

    const startYearAccountsAfterParentEdit = await getEffectiveAccounts(owner.id, child.id, 2131);
    expect(startYearAccountsAfterParentEdit.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 350,
        inheritedFromParent: true,
      })
    );

    const laterAccountsAfterParentEdit = await getEffectiveAccounts(owner.id, child.id, 2132);
    expect(laterAccountsAfterParentEdit.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 650,
        inheritedFromParent: false,
      })
    );
  });

  it('inherits parent accounts added after child creation and freezes them on parent deletion', async () => {
    const owner = await createUser('parent-budget-new-account-owner@test.com');
    const parent = await createParentBudget(owner.id, 2107);
    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2108, 'Child', parent.budget.id)
    );
    const [newAccount] = await superuserDb
      .insert(paymentMethods)
      .values({ userId: owner.id, name: 'Brokerage', institution: 'Bank', sortOrder: 3 })
      .returning();
    await superuserDb
      .insert(accountBalances)
      .values({ yearId: parent.year.id, paymentMethodId: newAccount.id, initialBalance: '100.00' });
    await superuserDb.insert(transactions).values({
      yearId: parent.year.id,
      itemId: parent.dailyItem.id,
      date: '2107-12-20',
      amount: '30.00',
      paymentMethodId: newAccount.id,
      accountingMonth: 12,
      accountingYear: 2107,
    });

    const accounts = await getEffectiveAccounts(owner.id, child.id, 2108);
    expect(accounts.accounts).toContainEqual(
      expect.objectContaining({
        id: newAccount.id,
        initialBalance: 70,
        inheritedFromParent: true,
      })
    );

    const { childYear } = await getChildItems(child.id);
    expect(await getAccountBalances(childYear.id)).not.toContainEqual(
      expect.objectContaining({ paymentMethodId: newAccount.id })
    );

    await withUserContext(owner.id, (tx) => deleteOwnedBudget(tx, owner.id, parent.budget.id));

    const frozenBalances = await getAccountBalances(childYear.id);
    expect(frozenBalances).toContainEqual(
      expect.objectContaining({
        paymentMethodId: newAccount.id,
        initialBalance: '70.00',
        inheritedFromParent: false,
      })
    );
  });

  it('allows a collaborator to read live inherited balances from a shared child without parent access', async () => {
    const owner = await createUser('parent-budget-shared-child-owner@test.com');
    const collaborator = await createUser('parent-budget-shared-child-reader@test.com');
    const parent = await createParentBudget(owner.id, 2115);
    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2116, 'Child', parent.budget.id)
    );
    await superuserDb.insert(budgetShares).values({ budgetId: child.id, userId: collaborator.id, role: 'read' });
    await superuserDb.insert(transactions).values({
      yearId: parent.year.id,
      itemId: parent.dailyItem.id,
      date: '2115-12-20',
      amount: '300.00',
      paymentMethodId: parent.checkingAccount.id,
      accountingMonth: 12,
      accountingYear: 2115,
    });

    await expect(getEffectiveAccounts(owner.id, parent.budget.id, 2115, collaborator.id)).resolves.toMatchObject({
      accounts: [],
    });

    const childAccounts = await getEffectiveAccounts(owner.id, child.id, 2116, collaborator.id);
    expect(childAccounts.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 350,
        inheritedFromParent: true,
      })
    );
  });

  it('keeps the privileged parent balance context read-only', async () => {
    const owner = await createUser('parent-budget-readonly-owner@test.com');
    const parent = await createParentBudget(owner.id, 2119);

    await expect(
      withInheritedBalanceReadContext(owner.id, parent.budget.id, async (tx) => {
        await tx.update(budgets).set({ description: 'Changed' }).where(eq(budgets.id, parent.budget.id));
      })
    ).rejects.toThrow();

    const [storedParent] = await superuserDb.select().from(budgets).where(eq(budgets.id, parent.budget.id));
    expect(storedParent.description).toBe(parent.budget.description);
  });

  it('handles concurrent shared child inherited balance reads', async () => {
    const owner = await createUser('parent-budget-shared-concurrent-owner@test.com');
    const collaborator = await createUser('parent-budget-shared-concurrent-reader@test.com');
    const parent = await createParentBudget(owner.id, 2117);
    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2118, 'Child', parent.budget.id)
    );
    await superuserDb.insert(budgetShares).values({ budgetId: child.id, userId: collaborator.id, role: 'read' });
    await superuserDb.insert(transactions).values({
      yearId: parent.year.id,
      itemId: parent.dailyItem.id,
      date: '2117-12-20',
      amount: '300.00',
      paymentMethodId: parent.checkingAccount.id,
      accountingMonth: 12,
      accountingYear: 2117,
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () => getEffectiveAccounts(owner.id, child.id, 2118, collaborator.id))
    );

    for (const result of results) {
      expect(result.accounts).toContainEqual(
        expect.objectContaining({
          id: parent.checkingAccount.id,
          initialBalance: 350,
          inheritedFromParent: true,
        })
      );
    }
  });

  it('propagates parent balance changes through a grandchild chain', async () => {
    const owner = await createUser('parent-budget-grandchild-owner@test.com');
    const parent = await createParentBudget(owner.id, 2110);
    const child = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2111, 'Child', parent.budget.id)
    );
    const grandchild = await withUserContext(owner.id, (tx) =>
      createYearlyBudget(tx, owner.id, 2112, 'Grandchild', child.id)
    );

    await superuserDb.insert(transactions).values({
      yearId: parent.year.id,
      itemId: parent.dailyItem.id,
      date: '2110-12-20',
      amount: '300.00',
      paymentMethodId: parent.checkingAccount.id,
      accountingMonth: 12,
      accountingYear: 2110,
    });

    const accounts = await getEffectiveAccounts(owner.id, grandchild.id, 2112);
    expect(accounts.accounts).toContainEqual(
      expect.objectContaining({
        id: parent.checkingAccount.id,
        initialBalance: 350,
        inheritedFromParent: true,
      })
    );
  });

  it('rejects parent budgets that are not the previous year before creating a child budget', async () => {
    const owner = await createUser('parent-budget-year-owner@test.com');
    const parent = await createParentBudget(owner.id, 2102);

    await expect(
      withUserContext(owner.id, (tx) => createYearlyBudget(tx, owner.id, 2104, 'Child', parent.budget.id))
    ).rejects.toBeInstanceOf(ParentBudgetYearMismatchError);

    await expect(
      superuserDb
        .select()
        .from(budgets)
        .where(and(eq(budgets.userId, owner.id), eq(budgets.startYear, 2104)))
    ).resolves.toHaveLength(0);
  });

  it('rejects shared parent budgets because the parent must be owned', async () => {
    const owner = await createUser('parent-budget-shared-requester@test.com');
    const other = await createUser('parent-budget-shared-owner@test.com');
    const parent = await createParentBudget(other.id, 2100);
    await superuserDb.insert(budgetShares).values({ budgetId: parent.budget.id, userId: owner.id, role: 'write' });

    await expect(
      withUserContext(owner.id, (tx) => createYearlyBudget(tx, owner.id, 2101, 'Child', parent.budget.id))
    ).rejects.toBeInstanceOf(ParentBudgetNotFoundError);

    await expect(
      superuserDb
        .select()
        .from(budgets)
        .where(and(eq(budgets.userId, owner.id), eq(budgets.startYear, 2101)))
    ).resolves.toHaveLength(0);
  });
});
