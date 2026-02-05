/**
 * RLS Enforcement Integration Tests
 *
 * Verifies that PostgreSQL Row-Level Security policies correctly:
 * 1. Isolate data between tenants (cross-tenant reads/writes blocked)
 * 2. Fail closed when context is missing (no data leaks)
 * 3. Allow same-tenant access normally
 * 4. Handle shared budgets correctly
 * 5. Runtime guard on `db` proxy throws without context
 *
 * Run: npx tsx tests/rls-enforcement.test.ts
 * Requires: running PostgreSQL with migrations applied
 */

// CRITICAL: Load .env BEFORE importing db (otherwise falls back to hardcoded superuser)
import 'dotenv/config';

import { sql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { db, rawDb } from '../src/db/index.js';
import { withTenantContext, withUserContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
const {
  users,
  budgets,
  budgetShares,
  budgetYears,
  budgetGroups,
  budgetItems,
  transactions,
  paymentMethods,
  settings,
} = schema;

// Create a separate connection with superuser for fixture setup
// This bypasses RLS and avoids infinite recursion with FK constraints
const superuserUrl = process.env.DATABASE_URL?.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret') || 
                     'postgresql://tallix:tallix_secret@localhost:5432/tallix';
const superuserClient = postgres(superuserUrl);
const superuserDb = drizzle(superuserClient, { schema });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed++;
    errors.push(`FAIL: ${message}`);
    console.error(`  ✗ ${message}`);
  } else {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

async function assertThrows(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
    failed++;
    errors.push(`FAIL: ${message} (did not throw)`);
    console.error(`  ✗ ${message} (did not throw)`);
  } catch {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

function assertThrowsSync(fn: () => unknown, message: string) {
  try {
    fn();
    failed++;
    errors.push(`FAIL: ${message} (did not throw)`);
    console.error(`  ✗ ${message} (did not throw)`);
  } catch {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

// Fixture IDs
let userAId: string;
let userBId: string;
let budgetAId: number;
let budgetBId: number;
let yearAId: number;
let groupAId: number;
let itemAId: number;

// ---------------------------------------------------------------------------
// Setup: create fixtures using rawDb (bypasses guard + RLS since we're the db owner)
// ---------------------------------------------------------------------------

async function setup() {
  console.log('\n--- Setting up test fixtures ---');

  // Clean up any previous test data (use superuser)
  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE 'rls-test-%@test.com'`);

  // Create fixtures using superuser connection (bypasses RLS and FK recursion issues)
  const [userA] = await superuserDb
    .insert(users)
    .values({ email: 'rls-test-a@test.com', passwordHash: 'hash-a', name: 'User A' })
    .returning();
  const [userB] = await superuserDb
    .insert(users)
    .values({ email: 'rls-test-b@test.com', passwordHash: 'hash-b', name: 'User B' })
    .returning();

  userAId = userA.id;
  userBId = userB.id;

  // Create budgets
  const [bA] = await superuserDb.insert(budgets).values({ userId: userAId }).returning();
  const [bB] = await superuserDb.insert(budgets).values({ userId: userBId }).returning();
  budgetAId = bA.id;
  budgetBId = bB.id;

  // Create budget years
  const [yA] = await superuserDb
    .insert(budgetYears)
    .values({ budgetId: budgetAId, year: 9901 })
    .returning();
  yearAId = yA.id;

  // Create a group in budget A
  const [gA] = await superuserDb
    .insert(budgetGroups)
    .values({ budgetId: budgetAId, name: 'Test Group', slug: 'test-group', type: 'expense', sortOrder: 0 })
    .returning();
  groupAId = gA.id;

  // Create an item
  const [iA] = await superuserDb
    .insert(budgetItems)
    .values({ yearId: yearAId, groupId: groupAId, name: 'Test Item', slug: 'test-item', sortOrder: 0 })
    .returning();
  itemAId = iA.id;

  // Payment methods
  await superuserDb
    .insert(paymentMethods)
    .values({ userId: userAId, name: 'Card A', sortOrder: 0 })
    .returning();
  await superuserDb
    .insert(paymentMethods)
    .values({ userId: userBId, name: 'Card B', sortOrder: 0 })
    .returning();

  // Create a transaction in budget A
  await superuserDb.insert(transactions).values({
    yearId: yearAId,
    itemId: itemAId,
    date: '2099-01-15',
    amount: '100.00',
    paymentMethod: 'Card A',
    accountingMonth: 1,
    accountingYear: 9901,
  });

  // Settings for user A
  await superuserDb.insert(settings).values({ userId: userAId, key: 'theme', value: 'dark' });

  console.log('  Fixtures created.\n');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown() {
  console.log('\n--- Cleaning up test fixtures ---');
  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE 'rls-test-%@test.com'`);
  await superuserClient.end();
  console.log('  Done.\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testSameTenantAccess() {
  console.log('Test: Same-tenant access works');

  const txns = await withTenantContext(userAId, budgetAId, async (tx) => {
    return await tx.query.transactions.findMany();
  });
  assert(txns.length >= 1, 'User A can read own transactions');

  const yrs = await withTenantContext(userAId, budgetAId, async (tx) => {
    return await tx.query.budgetYears.findMany();
  });
  assert(yrs.length >= 1, 'User A can read own budget years');

  const pms = await withUserContext(userAId, async (tx) => {
    return await tx.query.paymentMethods.findMany();
  });
  assert(pms.length >= 1, 'User A can read own payment methods');
}

async function testCrossTenantReadBlocked() {
  console.log('Test: Cross-tenant reads return empty');

  // User B tries to read User A's budget data
  const txns = await withTenantContext(userBId, budgetAId, async (tx) => {
    return await tx.query.transactions.findMany();
  });
  assert(txns.length === 0, 'User B cannot read User A transactions via tenant context');

  const yrs = await withTenantContext(userBId, budgetAId, async (tx) => {
    return await tx.query.budgetYears.findMany();
  });
  assert(yrs.length === 0, 'User B cannot read User A budget years');

  // User B tries to read User A's payment methods
  const pmsAsB = await withUserContext(userBId, async (tx) => {
    return tx.query.paymentMethods.findMany({ where: eq(paymentMethods.userId, userAId) });
  });
  assert(pmsAsB.length === 0, 'User B cannot read User A payment methods');

  // User B tries to read User A's settings
  const settingsAsB = await withUserContext(userBId, async (tx) => {
    return tx.query.settings.findMany({ where: eq(settings.userId, userAId) });
  });
  assert(settingsAsB.length === 0, 'User B cannot read User A settings');
}

async function testCrossTenantWriteBlocked() {
  console.log('Test: Cross-tenant writes are rejected');

  // User B tries to insert a transaction into User A's budget
  await assertThrows(
    () =>
      withTenantContext(userBId, budgetBId, async (tx) => {
        await tx.insert(transactions).values({
          yearId: yearAId,
          itemId: itemAId,
          date: '2099-06-01',
          amount: '999.00',
          paymentMethod: 'Hack',
          accountingMonth: 6,
          accountingYear: 9901,
        });
      }),
    'User B cannot insert transaction into User A budget'
  );

  // User B tries to insert a setting for User A
  await assertThrows(
    () =>
      withUserContext(userBId, async (tx) => {
        await tx.insert(settings).values({ userId: userAId, key: 'hacked', value: 'yes' });
      }),
    'User B cannot insert setting for User A'
  );
}

async function testMissingContextFailsClosed() {
  console.log('Test: Queries without RLS context fail closed');

  // Use rawDb to open a bare transaction (no SET LOCAL) — simulates missing context at DB level
  const result = await rawDb.transaction(async (tx) => {
    const rows = await tx.query.transactions.findMany();
    return rows;
  });
  assert(result.length === 0, 'No transactions visible without RLS context');

  const pmResult = await rawDb.transaction(async (tx) => {
    const rows = await tx.query.paymentMethods.findMany();
    return rows;
  });
  assert(pmResult.length === 0, 'No payment methods visible without RLS context');

  const settingsResult = await rawDb.transaction(async (tx) => {
    const rows = await tx.query.settings.findMany();
    return rows;
  });
  assert(settingsResult.length === 0, 'No settings visible without RLS context');
}

async function testDbProxyGuard() {
  console.log('Test: Guarded db proxy throws without context');

  // db.query should throw outside a context wrapper
  assertThrowsSync(
    () => db.query.transactions.findMany(),
    'db.query throws without context'
  );

  assertThrowsSync(
    () => db.select().from(transactions),
    'db.select() throws without context'
  );

  assertThrowsSync(
    () => db.insert(transactions).values({} as any),
    'db.insert() throws without context'
  );

  assertThrowsSync(
    () => db.execute(sql`SELECT 1`),
    'db.execute() throws without context'
  );
}

async function testBudgetSharingReadOnly() {
  console.log('Test: Shared budget access (reader role)');

  // Share budget A with User B as reader (use superuser to avoid RLS recursion)
  await superuserDb.insert(budgetShares).values({
    budgetId: budgetAId,
    userId: userBId,
    role: 'reader',
  });

  try {
    // User B should now see budget A's data via tenant context
    const txns = await withTenantContext(userBId, budgetAId, async (tx) => {
      return await tx.query.transactions.findMany();
    });
    assert(txns.length >= 1, 'Shared reader can read transactions');

    // User B should NOT be able to write to shared budget
    await assertThrows(
      () =>
        withTenantContext(userBId, budgetAId, async (tx) => {
          await tx.insert(transactions).values({
            yearId: yearAId,
            itemId: itemAId,
            date: '2099-07-01',
            amount: '50.00',
            paymentMethod: 'Card B',
            accountingMonth: 7,
            accountingYear: 9901,
          });
        }),
      'Shared reader cannot insert transactions'
    );
  } finally {
    // Clean up share (use superuser to avoid RLS recursion)
    await superuserDb
      .delete(budgetShares)
      .where(sql`budget_id = ${budgetAId} AND user_id = ${userBId}`);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== RLS Enforcement Tests ===\n');

  try {
    await setup();
    await testSameTenantAccess();
    await testCrossTenantReadBlocked();
    await testCrossTenantWriteBlocked();
    await testMissingContextFailsClosed();
    await testDbProxyGuard();
    await testBudgetSharingReadOnly();
  } catch (err) {
    console.error('\nUnexpected error during tests:', err);
    failed++;
  } finally {
    await teardown();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (errors.length > 0) {
    console.log('\nFailures:');
    for (const e of errors) {
      console.log(`  - ${e}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
