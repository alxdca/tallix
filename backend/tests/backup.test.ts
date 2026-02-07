/**
 * Backup Export/Import Integration Tests
 *
 * Verifies:
 * 1. Export produces a valid payload with all entity types
 * 2. Round-trip: export → import restores data faithfully
 * 3. Destructive import: existing data is deleted before restore
 * 4. Validation: invalid payloads are rejected with clear errors
 * 5. Atomicity: failed imports leave original data unchanged
 *
 * Run: pnpm test -- tests/backup.test.ts
 */

import { test, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { withTenantContext, withUserContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import * as backupSvc from '../src/services/backup.js';
import type { BackupPayload } from '../src/services/backup.js';

const {
  users,
  budgets,
  budgetYears,
  budgetGroups,
  budgetItems,
  monthlyValues,
  transactions,
  paymentMethods,
  assets,
  assetValues,
  transfers,
  accountBalances,
} = schema;

// Superuser connection for fixture setup (bypasses RLS)
const superuserUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret')
  : `postgresql://${process.env.POSTGRES_USER || 'tallix'}:${process.env.POSTGRES_PASSWORD || 'tallix_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;
const superuserClient = postgres(superuserUrl);
const superuserDb = drizzle(superuserClient, { schema });

// ── Fixtures ──────────────────────────────────────────────────────────

let userAId: string;
let budgetAId: number;
let userBId: string;
let budgetBId: number;

async function setup() {
  // Clean up any previous test data
  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE 'backup-test-%@test.com'`);

  // Create user A with full data
  const [userA] = await superuserDb
    .insert(users)
    .values({ email: 'backup-test-a@test.com', passwordHash: 'hash-a', name: 'Backup User A' })
    .returning();
  userAId = userA.id;

  const [bA] = await superuserDb
    .insert(budgets)
    .values({ userId: userAId, startYear: 2024 })
    .returning();
  budgetAId = bA.id;

  // Payment methods (with linked reference)
  const [pmChecking] = await superuserDb
    .insert(paymentMethods)
    .values({ userId: userAId, name: 'Checking', institution: 'Bank A', sortOrder: 0 })
    .returning();
  const [pmCredit] = await superuserDb
    .insert(paymentMethods)
    .values({
      userId: userAId,
      name: 'Credit Card',
      institution: 'Bank A',
      sortOrder: 1,
      settlementDay: 18,
      linkedPaymentMethodId: pmChecking.id,
    })
    .returning();
  const [pmSavings] = await superuserDb
    .insert(paymentMethods)
    .values({
      userId: userAId,
      name: 'Savings',
      institution: 'Bank B',
      sortOrder: 2,
      isSavingsAccount: true,
      savingsType: 'epargne',
    })
    .returning();

  // Budget years
  const [y2024] = await superuserDb
    .insert(budgetYears)
    .values({ budgetId: budgetAId, year: 8024, initialBalance: '1000.00' })
    .returning();
  const [y2025] = await superuserDb
    .insert(budgetYears)
    .values({ budgetId: budgetAId, year: 8025, initialBalance: '2000.00' })
    .returning();

  // Budget groups
  const [gIncome] = await superuserDb
    .insert(budgetGroups)
    .values({ budgetId: budgetAId, name: 'Salary', slug: 'salary', type: 'income', sortOrder: 0 })
    .returning();
  const [gExpense] = await superuserDb
    .insert(budgetGroups)
    .values({ budgetId: budgetAId, name: 'Housing', slug: 'housing', type: 'expense', sortOrder: 1 })
    .returning();

  // Budget items (year 2024)
  const [iSalary] = await superuserDb
    .insert(budgetItems)
    .values({ yearId: y2024.id, groupId: gIncome.id, name: 'Monthly Salary', slug: 'monthly-salary', sortOrder: 0, yearlyBudget: '500.00' })
    .returning();
  const [iRent] = await superuserDb
    .insert(budgetItems)
    .values({ yearId: y2024.id, groupId: gExpense.id, name: 'Rent', slug: 'rent', sortOrder: 0 })
    .returning();
  // Budget items (year 2025)
  const [iSalary25] = await superuserDb
    .insert(budgetItems)
    .values({ yearId: y2025.id, groupId: gIncome.id, name: 'Monthly Salary', slug: 'monthly-salary', sortOrder: 0 })
    .returning();

  // Monthly values
  await superuserDb.insert(monthlyValues).values([
    { itemId: iSalary.id, month: 1, budget: '5000.00', actual: '0' },
    { itemId: iSalary.id, month: 2, budget: '5000.00', actual: '0' },
    { itemId: iRent.id, month: 1, budget: '1500.00', actual: '0' },
  ]);

  // Transactions
  await superuserDb.insert(transactions).values([
    {
      yearId: y2024.id,
      itemId: iSalary.id,
      date: '8024-01-25',
      description: 'Jan Salary',
      amount: '5000.00',
      paymentMethodId: pmChecking.id,
      accountingMonth: 1,
      accountingYear: 8024,
    },
    {
      yearId: y2024.id,
      itemId: iRent.id,
      date: '8024-01-01',
      description: 'Jan Rent',
      amount: '-1500.00',
      paymentMethodId: pmCredit.id,
      accountingMonth: 1,
      accountingYear: 8024,
      thirdParty: 'Landlord',
    },
  ]);

  // Assets (with parent reference)
  const [aParent] = await superuserDb
    .insert(assets)
    .values({ budgetId: budgetAId, name: 'Real Estate', sortOrder: 0, isSystem: false, isDebt: false })
    .returning();
  const [aChild] = await superuserDb
    .insert(assets)
    .values({ budgetId: budgetAId, name: 'Apartment', sortOrder: 1, isSystem: false, isDebt: false, parentAssetId: aParent.id })
    .returning();

  // Asset values
  await superuserDb.insert(assetValues).values([
    { assetId: aParent.id, yearId: y2024.id, value: '300000.00' },
    { assetId: aChild.id, yearId: y2024.id, value: '250000.00' },
  ]);

  // Account balances
  await superuserDb.insert(accountBalances).values([
    { yearId: y2024.id, paymentMethodId: pmChecking.id, initialBalance: '5000.00' },
    { yearId: y2025.id, paymentMethodId: pmChecking.id, initialBalance: '6000.00' },
  ]);

  // Transfers
  await superuserDb.insert(transfers).values({
    yearId: y2024.id,
    date: '8024-01-15',
    amount: '1000.00',
    sourceAccountId: pmChecking.id,
    destinationAccountId: pmSavings.id,
    accountingMonth: 1,
    accountingYear: 8024,
  });

  // Create user B (empty budget, for round-trip test)
  const [userB] = await superuserDb
    .insert(users)
    .values({ email: 'backup-test-b@test.com', passwordHash: 'hash-b', name: 'Backup User B' })
    .returning();
  userBId = userB.id;

  const [bB] = await superuserDb
    .insert(budgets)
    .values({ userId: userBId, startYear: 2024 })
    .returning();
  budgetBId = bB.id;
}

async function teardown() {
  // Delete in dependency order to avoid FK constraint violations
  // (transactions FK to payment_methods uses ON DELETE RESTRICT)
  await superuserDb.execute(sql`
    DELETE FROM transactions WHERE year_id IN (
      SELECT by.id FROM budget_years by
      JOIN budgets b ON by.budget_id = b.id
      WHERE b.user_id IN (SELECT id FROM users WHERE email LIKE 'backup-test-%@test.com')
    )
  `);
  await superuserDb.execute(sql`
    DELETE FROM transfers WHERE year_id IN (
      SELECT by.id FROM budget_years by
      JOIN budgets b ON by.budget_id = b.id
      WHERE b.user_id IN (SELECT id FROM users WHERE email LIKE 'backup-test-%@test.com')
    )
  `);
  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE 'backup-test-%@test.com'`);
  await superuserClient.end();
}

// ── Tests ─────────────────────────────────────────────────────────────

test('Backup export and import', async () => {
  try {
    await setup();

    // ── Test 1: Export produces valid payload ──
    console.log('\n--- Test 1: Export produces valid payload ---');

    const exported = await withTenantContext(userAId, budgetAId, (tx) =>
      backupSvc.exportBackup(tx, userAId, budgetAId)
    );

    expect(exported.schemaVersion).toBe(1);
    expect(exported.exportedAt).toBeTruthy();
    expect(exported.paymentMethods).toHaveLength(3);
    expect(exported.budgetYears).toHaveLength(2);
    expect(exported.budgetGroups).toHaveLength(2);
    expect(exported.budgetItems).toHaveLength(3);
    expect(exported.monthlyValues).toHaveLength(3);
    expect(exported.transactions).toHaveLength(2);
    expect(exported.assets).toHaveLength(2);
    expect(exported.assetValues).toHaveLength(2);
    expect(exported.transfers).toHaveLength(1);
    expect(exported.accountBalances).toHaveLength(2);

    // Verify linked payment method reference
    const creditCard = exported.paymentMethods.find((pm) => pm.name === 'Credit Card');
    const checking = exported.paymentMethods.find((pm) => pm.name === 'Checking');
    expect(creditCard?.linkedPaymentMethodId).toBe(checking?.id);
    expect(creditCard?.settlementDay).toBe(18);

    // Verify asset parent reference
    const parentAsset = exported.assets.find((a) => a.name === 'Real Estate');
    const childAsset = exported.assets.find((a) => a.name === 'Apartment');
    expect(childAsset?.parentAssetId).toBe(parentAsset?.id);

    // Verify decimal precision preserved as strings
    const salaryItem = exported.budgetItems.find((i) => i.name === 'Monthly Salary' && i.yearId === exported.budgetYears[0].id);
    expect(salaryItem?.yearlyBudget).toBe('500.00');

    // Verify multi-year data
    const yearNumbers = exported.budgetYears.map((y) => y.year).sort();
    expect(yearNumbers).toEqual([8024, 8025]);

    console.log('  Export: all assertions passed');

    // ── Test 2: Round-trip (export from A → import into B) ──
    console.log('\n--- Test 2: Round-trip import ---');

    const importResult = await withTenantContext(userBId, budgetBId, (tx) =>
      backupSvc.importBackup(tx, userBId, budgetBId, exported)
    );

    expect(importResult.paymentMethods).toBe(3);
    expect(importResult.budgetYears).toBe(2);
    expect(importResult.budgetGroups).toBe(2);
    expect(importResult.budgetItems).toBe(3);
    expect(importResult.monthlyValues).toBe(3);
    expect(importResult.transactions).toBe(2);
    expect(importResult.assets).toBe(2);
    expect(importResult.assetValues).toBe(2);
    expect(importResult.transfers).toBe(1);
    expect(importResult.accountBalances).toBe(2);

    // Verify data in user B's budget
    const bPms = await withUserContext(userBId, (tx) =>
      tx.select().from(paymentMethods)
    );
    expect(bPms).toHaveLength(3);

    const bYears = await withTenantContext(userBId, budgetBId, (tx) =>
      tx.select().from(budgetYears)
    );
    expect(bYears).toHaveLength(2);

    const bGroups = await withTenantContext(userBId, budgetBId, (tx) =>
      tx.select().from(budgetGroups)
    );
    expect(bGroups).toHaveLength(2);

    // Verify linked payment method was remapped correctly
    const bCredit = bPms.find((pm) => pm.name === 'Credit Card');
    const bChecking = bPms.find((pm) => pm.name === 'Checking');
    expect(bCredit?.linkedPaymentMethodId).toBe(bChecking?.id);

    // Verify asset parent reference was remapped
    const bAssets = await withTenantContext(userBId, budgetBId, (tx) =>
      tx.select().from(assets)
    );
    const bParent = bAssets.find((a) => a.name === 'Real Estate');
    const bChild = bAssets.find((a) => a.name === 'Apartment');
    expect(bChild?.parentAssetId).toBe(bParent?.id);

    // Verify transactions reference correct items and payment methods
    const bYearIds = bYears.map((y) => y.id);
    const bTxns = await withTenantContext(userBId, budgetBId, async (tx) => {
      const { inArray } = await import('drizzle-orm');
      return tx.select().from(transactions).where(inArray(transactions.yearId, bYearIds));
    });
    expect(bTxns).toHaveLength(2);
    // All transaction payment methods should belong to user B
    const bPmIds = new Set(bPms.map((pm) => pm.id));
    for (const txn of bTxns) {
      expect(bPmIds.has(txn.paymentMethodId)).toBe(true);
    }

    console.log('  Round-trip: all assertions passed');

    // ── Test 3: Destructive import deletes existing data ──
    console.log('\n--- Test 3: Destructive import ---');

    // User B now has data from test 2. Import again — should wipe and re-import.
    const importResult2 = await withTenantContext(userBId, budgetBId, (tx) =>
      backupSvc.importBackup(tx, userBId, budgetBId, exported)
    );
    expect(importResult2.transactions).toBe(2);

    // Verify no duplicate data (should be exactly the same counts as the backup)
    const b2Txns = await withTenantContext(userBId, budgetBId, async (tx) => {
      const { inArray } = await import('drizzle-orm');
      const years = await tx.select({ id: budgetYears.id }).from(budgetYears);
      return tx.select().from(transactions).where(inArray(transactions.yearId, years.map((y) => y.id)));
    });
    expect(b2Txns).toHaveLength(2);

    const b2Groups = await withTenantContext(userBId, budgetBId, (tx) =>
      tx.select().from(budgetGroups)
    );
    expect(b2Groups).toHaveLength(2);

    console.log('  Destructive import: all assertions passed');

    // ── Test 4: Validation rejects invalid payloads ──
    console.log('\n--- Test 4: Validation ---');

    // Missing schemaVersion
    await expect(
      withTenantContext(userBId, budgetBId, (tx) =>
        backupSvc.importBackup(tx, userBId, budgetBId, {} as any)
      )
    ).rejects.toThrow(/Unsupported backup schema version/);

    // Wrong schemaVersion
    await expect(
      withTenantContext(userBId, budgetBId, (tx) =>
        backupSvc.importBackup(tx, userBId, budgetBId, { schemaVersion: 99 } as any)
      )
    ).rejects.toThrow(/Unsupported backup schema version/);

    // Missing arrays
    await expect(
      withTenantContext(userBId, budgetBId, (tx) =>
        backupSvc.importBackup(tx, userBId, budgetBId, { schemaVersion: 1 } as any)
      )
    ).rejects.toThrow(/Missing or invalid/);

    // Broken reference: item references non-existent year
    const brokenPayload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      paymentMethods: [],
      budgetYears: [],
      budgetGroups: [],
      budgetItems: [{ id: 1, yearId: 999, groupId: null, name: 'X', slug: 'x', sortOrder: 0, yearlyBudget: '0', savingsAccountId: null }],
      monthlyValues: [],
      transactions: [],
      assets: [],
      assetValues: [],
      transfers: [],
      accountBalances: [],
    };
    await expect(
      withTenantContext(userBId, budgetBId, (tx) =>
        backupSvc.importBackup(tx, userBId, budgetBId, brokenPayload)
      )
    ).rejects.toThrow(/unknown year backup ID/);

    console.log('  Validation: all assertions passed');

    // ── Test 5: Atomicity — failed import leaves data unchanged ──
    console.log('\n--- Test 5: Atomicity ---');

    // First, check user B's current state (from test 3 import)
    const preAtomicGroups = await withTenantContext(userBId, budgetBId, (tx) =>
      tx.select().from(budgetGroups)
    );
    const preGroupCount = preAtomicGroups.length;

    // Create a payload that will fail partway through (transaction references unknown PM)
    const failPayload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      paymentMethods: [{ id: 1, name: 'Test PM', institution: null, sortOrder: 0, isSavingsAccount: false, savingsType: null, settlementDay: null, linkedPaymentMethodId: null }],
      budgetYears: [{ id: 1, year: 8099, initialBalance: '0' }],
      budgetGroups: [{ id: 1, name: 'Test Group', slug: 'test-group', type: 'expense', sortOrder: 0 }],
      budgetItems: [{ id: 1, yearId: 1, groupId: 1, name: 'Test Item', slug: 'test-item', sortOrder: 0, yearlyBudget: '0', savingsAccountId: null }],
      monthlyValues: [],
      transactions: [{ yearId: 1, itemId: 1, date: '8099-01-01', description: null, comment: null, thirdParty: null, paymentMethodId: 999, amount: '100', accountingMonth: 1, accountingYear: 8099, warning: null }],
      assets: [],
      assetValues: [],
      transfers: [],
      accountBalances: [],
    };

    // This should fail validation (transaction references unknown PM backup ID 999)
    await expect(
      withTenantContext(userBId, budgetBId, (tx) =>
        backupSvc.importBackup(tx, userBId, budgetBId, failPayload)
      )
    ).rejects.toThrow(/unknown payment method backup ID/);

    // Verify data is unchanged (transaction rolled back)
    const postAtomicGroups = await withTenantContext(userBId, budgetBId, (tx) =>
      tx.select().from(budgetGroups)
    );
    expect(postAtomicGroups.length).toBe(preGroupCount);

    console.log('  Atomicity: all assertions passed');

    console.log('\n--- All backup tests passed ---');
  } finally {
    await teardown();
  }
});
