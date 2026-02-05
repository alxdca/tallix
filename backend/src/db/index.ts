import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Construct DATABASE_URL from components if not provided
const connectionString = process.env.DATABASE_URL || 
  `postgresql://${process.env.APP_DB_USER || 'tallix_app'}:${process.env.APP_DB_PASSWORD || 'tallix_app_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;

// Create postgres client
const client = postgres(connectionString);

// Create drizzle instance
const _db = drizzle(client, { schema });

// Type alias for database client — works for both the root db instance and transactions.
// PgTransaction lacks $client, so we omit it to allow both types.
export type DbClient = Omit<typeof _db, '$client'>;

/**
 * Unguarded database connection for infrastructure code that legitimately
 * operates outside tenant context: context wrappers, auth, startup checks.
 *
 * DO NOT use in tenant-scoped services or routes.
 */
export const rawDb = _db;

/**
 * Guarded database connection. Throws on query/mutation methods if no
 * tenant context (AsyncLocalStorage) is active. This catches accidental
 * `import { db }` usage in code that should go through withTenantContext.
 *
 * The guard is lazy-loaded from context.ts to avoid circular imports.
 */
const GUARDED_METHODS = new Set([
  'query',
  'select',
  'selectDistinct',
  'insert',
  'update',
  'delete',
  'execute',
]);

export const db: typeof _db = new Proxy(_db, {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && GUARDED_METHODS.has(prop)) {
      // Lazy import to avoid circular dependency (context.ts imports from this file)
      const { getCurrentContext } = require('./context.js');
      if (!getCurrentContext()) {
        throw new Error(
          `Direct db.${prop}() called without tenant context. ` +
            'Use withTenantContext/withUserContext, or import rawDb for infrastructure code.'
        );
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

// Export schema for use in queries
export * from './schema.js';
