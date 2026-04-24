import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { withTenantContext } from '../src/db/context.js';
import * as schema from '../src/db/schema.js';
import { createTransaction, getThirdParties } from '../src/services/transactions.js';

const { users, budgets, budgetYears, paymentMethods, transactions } = schema;

const superuserUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/tallix_app:tallix_app_secret/, 'tallix:tallix_secret')
  : `postgresql://${process.env.POSTGRES_USER || 'tallix'}:${process.env.POSTGRES_PASSWORD || 'tallix_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;

const superuserClient = postgres(superuserUrl);
const superuserDb = drizzle(superuserClient, { schema });

const emailPrefix = 'third-party-autocomplete-test';

let userAId: string;
let budgetAId: number;
let userBId: string;
let yearAId: number;
let paymentMethodAId: number;

async function deleteFixtures() {
  await superuserDb.execute(sql`
    DELETE FROM transactions
    WHERE year_id IN (
      SELECT by.id
      FROM budget_years by
      JOIN budgets b ON b.id = by.budget_id
      JOIN users u ON u.id = b.user_id
      WHERE u.email LIKE ${`${emailPrefix}-%@test.com`}
    )
  `);

  await superuserDb.execute(sql`DELETE FROM users WHERE email LIKE ${`${emailPrefix}-%@test.com`}`);
}

describe('third party autocomplete', () => {
  beforeAll(async () => {
    await deleteFixtures();

    const [userA] = await superuserDb
      .insert(users)
      .values({ email: `${emailPrefix}-a@test.com`, passwordHash: 'hash-a', name: 'Autocomplete A' })
      .returning();
    const [userB] = await superuserDb
      .insert(users)
      .values({ email: `${emailPrefix}-b@test.com`, passwordHash: 'hash-b', name: 'Autocomplete B' })
      .returning();
    userAId = userA.id;
    userBId = userB.id;

    const [budgetA] = await superuserDb.insert(budgets).values({ userId: userAId, startYear: 2026 }).returning();
    const [budgetB] = await superuserDb.insert(budgets).values({ userId: userBId, startYear: 2026 }).returning();
    budgetAId = budgetA.id;

    const [yearA] = await superuserDb.insert(budgetYears).values({ budgetId: budgetA.id, year: 2026 }).returning();
    const [yearB] = await superuserDb.insert(budgetYears).values({ budgetId: budgetB.id, year: 2026 }).returning();
    yearAId = yearA.id;

    const [paymentMethodA] = await superuserDb
      .insert(paymentMethods)
      .values({ userId: userAId, name: 'Card A', sortOrder: 0 })
      .returning();
    paymentMethodAId = paymentMethodA.id;
    const [paymentMethodB] = await superuserDb
      .insert(paymentMethods)
      .values({ userId: userBId, name: 'Card B', sortOrder: 0 })
      .returning();

    await superuserDb.insert(transactions).values([
      {
        yearId: yearA.id,
        thirdParty: 'Migros',
        date: '2026-01-01',
        amount: '10.00',
        paymentMethodId: paymentMethodA.id,
        accountingMonth: 1,
        accountingYear: 2026,
      },
      {
        yearId: yearA.id,
        thirdParty: 'Migros',
        date: '2026-01-02',
        amount: '11.00',
        paymentMethodId: paymentMethodA.id,
        accountingMonth: 1,
        accountingYear: 2026,
      },
      {
        yearId: yearA.id,
        thirdParty: 'MIGROLINO',
        date: '2026-01-03',
        amount: '12.00',
        paymentMethodId: paymentMethodA.id,
        accountingMonth: 1,
        accountingYear: 2026,
      },
      {
        yearId: yearA.id,
        thirdParty: 'Coop',
        date: '2026-01-04',
        amount: '13.00',
        paymentMethodId: paymentMethodA.id,
        accountingMonth: 1,
        accountingYear: 2026,
      },
      {
        yearId: yearB.id,
        thirdParty: 'Migros France',
        date: '2026-01-05',
        amount: '14.00',
        paymentMethodId: paymentMethodB.id,
        accountingMonth: 1,
        accountingYear: 2026,
      },
    ]);
  });

  afterAll(async () => {
    await deleteFixtures();
    await superuserClient.end();
  });

  it('returns budget-scoped matching third parties ordered by frequency', async () => {
    const results = await withTenantContext(userAId, budgetAId, (tx) => getThirdParties(tx, 'mig', budgetAId));

    expect(results).toEqual(['Migros', 'MIGROLINO']);
    expect(results).not.toContain('Migros France');
  });

  it('uses the same budget scoping for the initial top suggestions', async () => {
    const results = await withTenantContext(userAId, budgetAId, (tx) => getThirdParties(tx, undefined, budgetAId));

    expect(results[0]).toBe('Migros');
    expect(results).toContain('Coop');
    expect(results).not.toContain('Migros France');
  });

  it('invalidates cached suggestions when a transaction creates a new third party', async () => {
    const before = await withTenantContext(userAId, budgetAId, (tx) => getThirdParties(tx, 'aldi', budgetAId));
    expect(before).toEqual([]);

    await withTenantContext(userAId, budgetAId, (tx) =>
      createTransaction(tx, userAId, budgetAId, {
        yearId: yearAId,
        date: '2026-01-06',
        thirdParty: 'Aldi',
        paymentMethodId: paymentMethodAId,
        amount: 15,
      })
    );

    const after = await withTenantContext(userAId, budgetAId, (tx) => getThirdParties(tx, 'aldi', budgetAId));
    expect(after).toEqual(['Aldi']);
  });
});
