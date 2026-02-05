import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { rawDb as db, type DbClient } from './index.js';
import logger from '../logger.js';

/**
 * Tenant context stored in AsyncLocalStorage for RLS enforcement
 */
export interface TenantContext {
  userId: string;
  budgetId: number | null;
  transaction?: DbClient;
}

/**
 * AsyncLocalStorage for storing tenant context per request
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Get the current tenant context from AsyncLocalStorage
 * @returns Current tenant context or undefined if not set
 */
export function getCurrentContext(): TenantContext | undefined {
  return tenantContextStorage.getStore();
}

/**
 * Execute a database operation within a tenant-scoped transaction
 * Sets app.user_id and app.budget_id for Row-Level Security (RLS) policies
 *
 * This function wraps the operation in a transaction and sets the RLS context.
 * The context is also stored in AsyncLocalStorage for automatic propagation.
 *
 * @param userId - The authenticated user's UUID
 * @param budgetId - The user's budget ID
 * @param callback - Async function to execute within the transaction
 * @returns Result of the callback function
 *
 * @example
 * const result = await withTenantContext(userId, budgetId, async (tx) => {
 *   return await tx.query.budgets.findMany();
 * });
 */
export async function withTenantContext<T>(
  userId: string,
  budgetId: number | null,
  callback: (tx: DbClient) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Set RLS context variables in the database transaction
    // Note: SET LOCAL does not support parameterized queries, so we use sql.raw
    await tx.execute(sql.raw(`SET LOCAL app.user_id = '${userId}'`));

    if (budgetId !== null) {
      await tx.execute(sql.raw(`SET LOCAL app.budget_id = ${budgetId}`));
    }

    // Store context in AsyncLocalStorage for nested calls
    const context: TenantContext = { userId, budgetId, transaction: tx };

    return await tenantContextStorage.run(context, async () => {
      try {
        return await callback(tx);
      } catch (error) {
        logger.error({ error, userId, budgetId }, 'Error in tenant context transaction');
        throw error;
      }
    });
  });
}

/**
 * Execute a database operation with only user context
 * Useful for operations that don't require a budget (e.g., creating a new budget)
 *
 * @param userId - The authenticated user's UUID
 * @param callback - Async function to execute within the transaction
 * @returns Result of the callback function
 */
export async function withUserContext<T>(
  userId: string,
  callback: (tx: DbClient) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Set RLS context variable for user
    // Note: SET LOCAL does not support parameterized queries, so we use sql.raw
    await tx.execute(sql.raw(`SET LOCAL app.user_id = '${userId}'`));

    // Store context in AsyncLocalStorage
    const context: TenantContext = { userId, budgetId: null, transaction: tx };

    return await tenantContextStorage.run(context, async () => {
      try {
        return await callback(tx);
      } catch (error) {
        logger.error({ error, userId }, 'Error in user context transaction');
        throw error;
      }
    });
  });
}

/**
 * Assert that tenant context is set.
 * Throws if context is missing.
 */
export function assertContextSet(): TenantContext {
  const context = getCurrentContext();
  if (!context) {
    throw new Error('Tenant context not set. Database queries must run within withTenantContext or withUserContext.');
  }
  return context;
}

