import Decimal from 'decimal.js';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import {
  accountBalances,
  budgetGroups,
  budgetItems,
  budgetShares,
  budgets,
  budgetYears,
  monthlyValues,
  users,
} from '../db/schema.js';
import * as accountsSvc from './accounts.js';
import { createYear } from './budget.js';

export type BudgetAccessRole = 'owner' | 'read' | 'write';

export interface AccessibleBudget {
  id: number;
  description: string | null;
  year: number;
  startYear: number;
  years: number[];
  parentBudgetId: number | null;
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

export class ParentBudgetNotFoundError extends Error {
  constructor() {
    super('Parent budget not found');
    this.name = 'ParentBudgetNotFoundError';
  }
}

export class ParentBudgetYearMismatchError extends Error {
  public readonly expectedYear: number;

  constructor(expectedYear: number) {
    super('Parent budget must be the previous year');
    this.name = 'ParentBudgetYearMismatchError';
    this.expectedYear = expectedYear;
  }
}

export type DeleteBudgetResult =
  | { status: 'deleted'; budgets: AccessibleBudget[]; defaultBudgetId: number }
  | { status: 'shared' }
  | { status: 'not-found' };

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

  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(created.id)}, true)`);
  await createYear(tx, created.startYear, 0, created.id, userId);

  return created;
}

export async function listAccessibleBudgets(tx: DbClient, userId: string): Promise<AccessibleBudget[]> {
  const accessible = await tx.query.budgets.findMany({
    orderBy: [asc(budgets.id)],
    with: {
      user: true,
    },
  });
  const shares = await tx.query.budgetShares.findMany({
    where: eq(budgetShares.userId, userId),
  });
  const roleByBudgetId = new Map(shares.map((share) => [share.budgetId, share.role]));

  const budgetsWithYears: AccessibleBudget[] = [];
  for (const budget of accessible) {
    const years = await listBudgetYearsInContext(tx, budget.id);
    budgetsWithYears.push({
      id: budget.id,
      description: budget.description,
      year: budget.startYear,
      startYear: budget.startYear,
      years,
      parentBudgetId: budget.parentBudgetId,
      ownerId: budget.userId,
      ownerName: budget.user.name,
      ownerEmail: budget.user.email,
      role: budget.userId === userId ? 'owner' : roleByBudgetId.get(budget.id) === 'write' ? 'write' : 'read',
    });
  }
  return budgetsWithYears;
}

async function listBudgetYearsInContext(tx: DbClient, budgetId: number): Promise<number[]> {
  const [contextRow] = await tx.execute(sql<{ budgetId: string | null }>`
    SELECT current_setting('app.budget_id', true) AS "budgetId"
  `);
  const previousBudgetId = contextRow?.budgetId ?? null;

  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(budgetId)}, true)`);
  try {
    const years = await tx.query.budgetYears.findMany({
      where: eq(budgetYears.budgetId, budgetId),
      orderBy: [asc(budgetYears.year)],
      columns: { year: true },
    });
    return years.map((budgetYear) => budgetYear.year);
  } finally {
    await tx.execute(sql`SELECT set_config('app.budget_id', ${previousBudgetId ?? ''}, true)`);
  }
}

export async function createYearlyBudget(
  tx: DbClient,
  userId: string,
  year: number,
  description: string | null = null,
  parentBudgetId: number | null = null
): Promise<AccessibleBudget> {
  const parentBudget = parentBudgetId
    ? await tx.query.budgets.findFirst({
        where: and(eq(budgets.id, parentBudgetId), eq(budgets.userId, userId)),
      })
    : null;

  if (parentBudgetId && !parentBudget) {
    throw new ParentBudgetNotFoundError();
  }

  if (parentBudget && parentBudget.startYear !== year - 1) {
    throw new ParentBudgetYearMismatchError(parentBudget.startYear + 1);
  }

  const parentAccountBalanceSnapshots = parentBudget
    ? await getParentAccountBalanceSnapshots(tx, parentBudget.id, parentBudget.startYear, userId)
    : [];

  const [createdBudget] = await tx
    .insert(budgets)
    .values({
      userId,
      parentBudgetId,
      description,
      startYear: year,
    })
    .returning();

  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(createdBudget.id)}, true)`);
  const createdYear = await createYear(tx, year, 0, createdBudget.id, userId);

  if (parentBudget) {
    await copyParentCategories(tx, parentBudget.id, parentBudget.startYear, createdBudget.id, createdYear.id);
    await createChildAccountBalanceSnapshots(tx, createdYear.id, parentAccountBalanceSnapshots);
  }

  const createdWithUser = await tx.query.budgets.findFirst({
    where: eq(budgets.id, createdBudget.id),
    with: { user: true },
  });

  if (!createdWithUser) {
    throw new Error('Failed to create budget');
  }

  return {
    id: createdWithUser.id,
    description: createdWithUser.description,
    year,
    startYear: createdWithUser.startYear,
    years: [year],
    parentBudgetId: createdWithUser.parentBudgetId,
    ownerId: createdWithUser.userId,
    ownerName: createdWithUser.user.name,
    ownerEmail: createdWithUser.user.email,
    role: 'owner',
  };
}

async function getParentAccountBalanceSnapshots(
  tx: DbClient,
  parentBudgetId: number,
  parentYear: number,
  userId: string
) {
  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(parentBudgetId)}, true)`);
  const { accounts } = await accountsSvc.getAccountsForYear(tx, parentYear, parentBudgetId, userId);

  return accounts.map((account) => ({
    paymentMethodId: account.id,
    initialBalance: new Decimal(String(account.monthlyBalances[11] ?? 0)).toDecimalPlaces(2).toFixed(2),
  }));
}

async function createChildAccountBalanceSnapshots(
  tx: DbClient,
  childYearId: number,
  snapshots: { paymentMethodId: number; initialBalance: string }[]
) {
  if (snapshots.length === 0) {
    return;
  }

  await tx.insert(accountBalances).values(
    snapshots.map((snapshot) => ({
      yearId: childYearId,
      paymentMethodId: snapshot.paymentMethodId,
      initialBalance: snapshot.initialBalance,
      inheritedFromParent: true,
    }))
  );
}

async function copyParentCategories(
  tx: DbClient,
  parentBudgetId: number,
  parentStartYear: number,
  childBudgetId: number,
  childYearId: number
) {
  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(parentBudgetId)}, true)`);

  const parentYear = await tx.query.budgetYears.findFirst({
    where: and(eq(budgetYears.budgetId, parentBudgetId), eq(budgetYears.year, parentStartYear)),
  });

  if (!parentYear) {
    await tx.execute(sql`SELECT set_config('app.budget_id', ${String(childBudgetId)}, true)`);
    return;
  }

  const parentGroups = await tx.query.budgetGroups.findMany({
    where: eq(budgetGroups.budgetId, parentBudgetId),
    orderBy: [asc(budgetGroups.sortOrder), asc(budgetGroups.id)],
    with: {
      items: {
        where: eq(budgetItems.yearId, parentYear.id),
        orderBy: [asc(budgetItems.sortOrder), asc(budgetItems.id)],
      },
    },
  });

  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(childBudgetId)}, true)`);

  for (const parentGroup of parentGroups) {
    let childGroup = await tx.query.budgetGroups.findFirst({
      where: and(eq(budgetGroups.budgetId, childBudgetId), eq(budgetGroups.slug, parentGroup.slug)),
    });

    if (childGroup) {
      [childGroup] = await tx
        .update(budgetGroups)
        .set({
          name: parentGroup.name,
          type: parentGroup.type,
          sortOrder: parentGroup.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(budgetGroups.id, childGroup.id))
        .returning();
    } else {
      [childGroup] = await tx
        .insert(budgetGroups)
        .values({
          budgetId: childBudgetId,
          name: parentGroup.name,
          slug: parentGroup.slug,
          type: parentGroup.type,
          sortOrder: parentGroup.sortOrder,
        })
        .returning();
    }

    for (const parentItem of parentGroup.items) {
      const existingItem = await tx.query.budgetItems.findFirst({
        where: and(
          eq(budgetItems.yearId, childYearId),
          eq(budgetItems.groupId, childGroup.id),
          parentItem.savingsAccountId
            ? or(eq(budgetItems.slug, parentItem.slug), eq(budgetItems.savingsAccountId, parentItem.savingsAccountId))
            : eq(budgetItems.slug, parentItem.slug)
        ),
      });

      if (existingItem) {
        await tx
          .update(budgetItems)
          .set({
            name: parentItem.name,
            slug: parentItem.slug,
            sortOrder: parentItem.sortOrder,
            yearlyBudget: '0',
            savingsAccountId: parentItem.savingsAccountId,
            updatedAt: new Date(),
          })
          .where(eq(budgetItems.id, existingItem.id));
        continue;
      }

      const [childItem] = await tx
        .insert(budgetItems)
        .values({
          yearId: childYearId,
          groupId: childGroup.id,
          name: parentItem.name,
          slug: parentItem.slug,
          sortOrder: parentItem.sortOrder,
          yearlyBudget: '0',
          savingsAccountId: parentItem.savingsAccountId,
        })
        .returning();

      await tx.insert(monthlyValues).values(
        Array.from({ length: 12 }, (_, index) => ({
          itemId: childItem.id,
          month: index + 1,
          budget: '0',
          actual: '0',
        }))
      );
    }
  }
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

export async function deleteOwnedBudget(tx: DbClient, userId: string, budgetId: number): Promise<DeleteBudgetResult> {
  const access = await getAccessibleBudget(tx, userId, budgetId);
  if (!access) {
    return { status: 'not-found' };
  }
  if (access.role !== 'owner') {
    return { status: 'shared' };
  }

  await materializeInheritedChildBalances(tx, budgetId, userId);

  const deleted = await tx
    .delete(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
    .returning({ id: budgets.id });

  if (deleted.length === 0) {
    return { status: 'not-found' };
  }

  const ownBudget = await getOrCreateDefaultBudget(tx, userId);
  const accessibleBudgets = await listAccessibleBudgets(tx, userId);

  return { status: 'deleted', budgets: accessibleBudgets, defaultBudgetId: ownBudget.id };
}

async function materializeInheritedChildBalances(tx: DbClient, parentBudgetId: number, userId: string) {
  const childBudgets = await tx.query.budgets.findMany({
    where: and(eq(budgets.parentBudgetId, parentBudgetId), eq(budgets.userId, userId)),
    columns: { id: true, startYear: true },
  });

  for (const childBudget of childBudgets) {
    await tx.execute(sql`SELECT set_config('app.budget_id', ${String(childBudget.id)}, true)`);

    const childYear = await tx.query.budgetYears.findFirst({
      where: and(eq(budgetYears.budgetId, childBudget.id), eq(budgetYears.year, childBudget.startYear)),
      columns: { id: true },
    });

    if (!childYear) {
      continue;
    }

    const childBalanceRows = await tx.select().from(accountBalances).where(eq(accountBalances.yearId, childYear.id));
    const childBalanceRowsByPaymentMethod = new Map(childBalanceRows.map((row) => [row.paymentMethodId, row]));
    const inheritedRows = childBalanceRows.filter((row) => row.inheritedFromParent);

    const { accounts } = await accountsSvc.getAccountsForYear(tx, childBudget.startYear, childBudget.id, userId);
    const effectiveOpeningByPaymentMethod = new Map(
      accounts.map((account) => [account.id, new Decimal(String(account.initialBalance)).toDecimalPlaces(2).toFixed(2)])
    );
    const effectiveAccountIds = new Set(effectiveOpeningByPaymentMethod.keys());

    for (const inheritedRow of inheritedRows) {
      const effectiveOpening = effectiveOpeningByPaymentMethod.get(inheritedRow.paymentMethodId);
      if (effectiveOpening === undefined) {
        await tx
          .update(accountBalances)
          .set({
            inheritedFromParent: false,
            updatedAt: new Date(),
          })
          .where(eq(accountBalances.id, inheritedRow.id));
        continue;
      }

      await tx
        .update(accountBalances)
        .set({
          initialBalance: effectiveOpening,
          inheritedFromParent: false,
          updatedAt: new Date(),
        })
        .where(eq(accountBalances.id, inheritedRow.id));
    }

    const missingInheritedBalances = accounts
      .filter((account) => account.inheritedFromParent && !childBalanceRowsByPaymentMethod.has(account.id))
      .map((account) => ({
        yearId: childYear.id,
        paymentMethodId: account.id,
        initialBalance: new Decimal(String(account.initialBalance)).toDecimalPlaces(2).toFixed(2),
        inheritedFromParent: false,
      }));

    if (missingInheritedBalances.length > 0) {
      await tx.insert(accountBalances).values(missingInheritedBalances);
    }

    for (const inheritedRow of inheritedRows) {
      if (effectiveAccountIds.has(inheritedRow.paymentMethodId)) {
        continue;
      }

      await tx
        .update(accountBalances)
        .set({
          inheritedFromParent: false,
          updatedAt: new Date(),
        })
        .where(eq(accountBalances.id, inheritedRow.id));
    }
  }

  await tx.execute(sql`SELECT set_config('app.budget_id', ${String(parentBudgetId)}, true)`);
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
