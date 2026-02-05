# Row-Level Security (RLS) Implementation

## Overview

This application enforces multi-tenant data isolation at the PostgreSQL level using Row-Level Security (RLS). Every table containing user or budget data has RLS policies that restrict access based on session variables set at the start of each transaction.

## Architecture

### Context Variables

Two PostgreSQL session variables drive all RLS policies:

- `app.user_id` — the authenticated user's UUID (set on every request)
- `app.budget_id` — the active budget ID (set for budget-scoped operations)

These are set via `SET LOCAL` inside a transaction, so they automatically reset when the transaction ends.

### Context Wrappers

All database access in route handlers goes through one of two wrappers defined in `src/db/context.ts`:

| Wrapper | Sets | Use case |
|---------|------|----------|
| `withTenantContext(userId, budgetId, cb)` | `app.user_id` + `app.budget_id` | Budget-scoped operations (transactions, budget items, transfers, accounts) |
| `withUserContext(userId, cb)` | `app.user_id` only | User-scoped operations (payment methods, settings, budget lookup) |

Both wrappers open a transaction, set the RLS variables, and pass the transaction handle (`tx`) to the callback. All service functions accept `tx: DbClient` as their first parameter.

### Example

```typescript
// In a route handler:
const result = await withTenantContext(userId, budgetId, (tx) =>
  transactionsSvc.getTransactionsForYear(tx, year, budgetId)
);

// In the service:
export async function getTransactionsForYear(tx: DbClient, year: number, budgetId: number) {
  return tx.query.transactions.findMany({
    where: and(eq(transactions.budgetId, budgetId), ...),
  });
}
```

### Auth Exception

The auth service (`src/services/auth.ts`) uses a hybrid approach:

**Pre-authentication operations** (no user context available):
- Login, registration, setup status check → use `rawDb`
- RLS policy allows **SELECT and INSERT only** when `app.user_id` is not set (migration 0015)

**Post-authentication operations** (user context available):
- User profile updates, password changes, budget creation → use `withUserContext`
- RLS policy requires `user_id = get_current_user_id()` for UPDATE/DELETE operations
- This minimizes the RLS bypass surface area

### Runtime Guard

The default `db` export (`src/db/index.ts`) is wrapped in a Proxy that enforces context checks at runtime:

- **Guarded methods**: `query`, `select`, `insert`, `update`, `delete`, `execute`
- **Behavior**: Throws an error if called without active tenant context (from `withTenantContext` or `withUserContext`)
- **Error message**: "Direct db.{method}() called without tenant context. Use withTenantContext/withUserContext, or import rawDb for infrastructure code."

For legitimate infrastructure code that must run without tenant context, use `rawDb`:

```typescript
import { rawDb } from '../db/index.js';

// Infrastructure operations (auth, migrations, test fixtures)
const user = await rawDb.query.users.findFirst({ ... });
```

This runtime guard prevents accidental unscoped database access in application code.

## RLS Policy Coverage

All policies are defined in migrations `0013_enable_rls.sql`, `0014_harden_rls_policies.sql`, and `0015_narrow_auth_policy.sql`.

### Tables with RLS enabled

| Table | Policy scope | Notes |
|-------|-------------|-------|
| `users` | `user_id = app.user_id` | Auth exception: SELECT/INSERT only when no context (migration 0015) |
| `budgets` | Owner full access; shared users SELECT | Uses `is_budget_authorized()` |
| `budget_shares` | Owner manages; shared users read own | |
| `budget_years` | `budget_id` authorized | |
| `budget_groups` | `budget_id` authorized | |
| `budget_items` | `budget_id` authorized via year/group | FK validation on `group_id` |
| `budget_monthly_values` | Via item's budget chain | |
| `transactions` | `budget_id` match | FK validation on `item_id` |
| `payment_methods` | `user_id = app.user_id` | |
| `account_balances` | Via payment method's user | FK validation on `payment_method_id` |
| `transfers` | `budget_id` authorized | FK validation on source/dest accounts |
| `settings` | `user_id = app.user_id` | |

### Budget Sharing

The `is_budget_authorized(p_budget_id)` helper function (defined as `SECURITY DEFINER`) checks whether the current user is the budget owner or has a share entry. Budget-scoped tables use this for their `USING` clause. Write access is restricted to budget owners only via `WITH CHECK`.

## Fail-Closed Behavior

The application implements fail-closed behavior at two layers:

### Application Layer (Runtime Guard)
- The `db` proxy throws an error when accessed without tenant context
- Prevents accidental unscoped queries from ever reaching the database
- Error is thrown immediately at the call site for easy debugging

### Database Layer (RLS Policies)
When no context variables are set (only possible via `rawDb`):
- Queries return empty results (not errors) for most tables
- The `users` table allows **SELECT and INSERT only** without context (auth exception for login/register)
- UPDATE and DELETE operations on `users` require context (migration 0015)
- This is verified by the RLS enforcement tests (`tests/rls-enforcement.test.ts`)

## DB Role Requirements

**CRITICAL**: The application database role must NOT have `BYPASSRLS` or superuser privileges.

### Enforcement

The startup check in `src/index.ts` verifies the runtime database role:

- **Production (default)**: Application **exits immediately** if the role has `BYPASSRLS` or is a superuser
- **Local development**: Can be overridden with `ALLOW_UNSAFE_DB_ROLE=true` environment variable (⚠️ **NEVER use in production**)

### Recommended Role Setup

- **`app_user`**: Used by the application at runtime
  - No `BYPASSRLS` privilege
  - No superuser privilege
  - Has SELECT, INSERT, UPDATE, DELETE on application tables
  
- **`maintenance_user`**: Used for migrations and admin tasks only
  - May have elevated privileges
  - Never used by the running application

### Creating a Safe Runtime Role

```sql
-- Create application role
CREATE ROLE app_user WITH LOGIN PASSWORD 'secure_password';

-- Grant necessary permissions (adjust schema as needed)
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Verify role is safe
SELECT rolname, rolsuper, rolbypassrls 
FROM pg_roles 
WHERE rolname = 'app_user';
-- Should show: rolsuper = f, rolbypassrls = f
```

## Guardrails

- **Runtime guard**: The `db` export is wrapped in a Proxy that throws an error when accessed outside `withTenantContext` or `withUserContext`. This prevents accidental unscoped database access at the application layer.
- **Startup role check**: On boot, the app queries `pg_roles` and **exits immediately** if the current role can bypass RLS (unless `ALLOW_UNSAFE_DB_ROLE=true` for local dev). This prevents the application from starting with an unsafe database configuration.
- **Enforcement tests**: `npm run test:rls` (or `npx tsx tests/rls-enforcement.test.ts`) runs integration tests verifying:
  - Runtime guard throws without context
  - Cross-tenant isolation
  - Fail-closed behavior at database layer
  - Budget sharing permissions
