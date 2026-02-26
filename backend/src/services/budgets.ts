import { asc, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { budgets, users } from '../db/schema.js';

/**
 * Get the first budget for a user or create one atomically.
 *
 * We lock the user row to serialize concurrent "find-then-insert" calls
 * for the same user and avoid duplicate default budgets.
 */
export async function getOrCreateDefaultBudget(tx: DbClient, userId: string) {
  await tx.execute(sql`SELECT 1 FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`);

  const existing = await tx.query.budgets.findFirst({
    where: eq(budgets.userId, userId),
    orderBy: [asc(budgets.id)],
  });

  if (existing) {
    return existing;
  }

  const [created] = await tx
    .insert(budgets)
    .values({
      userId,
      description: null,
      startYear: new Date().getFullYear(),
    })
    .returning();

  return created;
}

