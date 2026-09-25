import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { budgetShares, budgets, users } from '../db/schema.js';

export type BudgetAccessRole = 'owner' | 'read' | 'write';

export interface AccessibleBudget {
  id: number;
  description: string | null;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string;
  role: BudgetAccessRole;
}

export class BudgetShareUserNotFoundError extends Error {
  constructor() {
    super('No registered user found with that email address');
    this.name = 'BudgetShareUserNotFoundError';
  }
}

export class BudgetAlreadyOwnedError extends Error {
  constructor() {
    super('You already own this budget');
    this.name = 'BudgetAlreadyOwnedError';
  }
}

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

export async function listAccessibleBudgets(tx: DbClient, userId: string): Promise<AccessibleBudget[]> {
  const accessible = await tx.query.budgets.findMany({
    orderBy: [asc(budgets.id)],
    with: { user: true },
  });
  const shares = await tx.query.budgetShares.findMany({
    where: eq(budgetShares.userId, userId),
  });
  const roleByBudgetId = new Map(shares.map((share) => [share.budgetId, share.role]));

  return accessible.map((budget) => ({
    id: budget.id,
    description: budget.description,
    ownerId: budget.userId,
    ownerName: budget.user.name,
    ownerEmail: budget.user.email,
    role: budget.userId === userId ? 'owner' : roleByBudgetId.get(budget.id) === 'write' ? 'write' : 'read',
  }));
}

export async function getAccessibleBudget(tx: DbClient, userId: string, budgetId: number) {
  const budget = await tx.query.budgets.findFirst({
    where: eq(budgets.id, budgetId),
  });
  if (!budget) return null;

  if (budget.userId === userId) {
    return { budget, role: 'owner' as const };
  }

  const share = await tx.query.budgetShares.findFirst({
    where: and(eq(budgetShares.budgetId, budgetId), eq(budgetShares.userId, userId)),
  });
  if (!share) return null;

  return { budget, role: share.role === 'write' ? ('write' as const) : ('read' as const) };
}

export async function listBudgetShares(tx: DbClient, budgetId: number) {
  const shares = await tx.query.budgetShares.findMany({
    where: eq(budgetShares.budgetId, budgetId),
    orderBy: [asc(budgetShares.id)],
    with: { user: true },
  });

  return shares.map((share) => ({
    id: share.id,
    userId: share.userId,
    email: share.user.email,
    name: share.user.name,
    role: share.role === 'write' ? ('write' as const) : ('read' as const),
  }));
}

export async function shareBudgetWithUser(
  tx: DbClient,
  budgetId: number,
  ownerId: string,
  email: string,
  role: Exclude<BudgetAccessRole, 'owner'>
) {
  const result = await tx.execute(sql<{ user_id: string | null }>`
    SELECT find_user_id_by_email(${budgetId}, ${email}) AS user_id
  `);
  const targetUserId = (result[0] as { user_id?: string | null } | undefined)?.user_id;
  if (!targetUserId) {
    throw new BudgetShareUserNotFoundError();
  }
  if (targetUserId === ownerId) {
    throw new BudgetAlreadyOwnedError();
  }

  const [share] = await tx
    .insert(budgetShares)
    .values({ budgetId, userId: targetUserId, role })
    .onConflictDoUpdate({
      target: [budgetShares.budgetId, budgetShares.userId],
      set: { role, updatedAt: new Date() },
    })
    .returning();

  return share;
}

export async function updateBudgetShare(
  tx: DbClient,
  budgetId: number,
  shareId: number,
  role: Exclude<BudgetAccessRole, 'owner'>
) {
  const [share] = await tx
    .update(budgetShares)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(budgetShares.id, shareId), eq(budgetShares.budgetId, budgetId)))
    .returning();
  return share ?? null;
}

export async function deleteBudgetShare(tx: DbClient, budgetId: number, shareId: number): Promise<boolean> {
  const deleted = await tx
    .delete(budgetShares)
    .where(and(eq(budgetShares.id, shareId), eq(budgetShares.budgetId, budgetId)))
    .returning({ id: budgetShares.id });
  return deleted.length > 0;
}
