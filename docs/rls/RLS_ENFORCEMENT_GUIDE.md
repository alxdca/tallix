# RLS Enforcement Guide

Practical guide for developers working on this codebase. Read `RLS_IMPLEMENTATION.md` for architecture details.

## Rules

1. **Never import `db` in a service file**. Import `DbClient` type instead.
   - **Exception**: Infrastructure code (auth, migrations, test fixtures) can import `rawDb` explicitly.
   - **Enforcement**: The `db` export has a runtime guard that throws if accessed without context.
2. **Never import `rawDb` outside the explicit allowlist** (see below).
   - **Enforcement**: `pnpm rls:guard` checks all imports and fails CI if violations are found.
3. **Every service function takes `tx: DbClient` as its first parameter.**
4. **Every route handler wraps service calls** in `withTenantContext` or `withUserContext`.
5. **Use `withTenantContext`** when the operation involves budget-scoped data (transactions, budget items, transfers, accounts, budget years/groups).
6. **Use `withUserContext`** when the operation involves only user-scoped data (payment methods, settings, budget lookup/creation).

## rawDb Allowlist

`rawDb` bypasses the runtime guard and can access data without tenant context. It is **only** permitted in the following files:

| File | Reason |
|------|--------|
| `src/db/index.ts` | Defines the `rawDb` export |
| `src/db/context.ts` | Implements `withUserContext`/`withTenantContext` using `rawDb` |
| `src/services/auth.ts` | Pre-authentication operations (login, register) have no user context |
| `src/index.ts` | Startup checks (DB role verification) before app accepts requests |
| `tests/rls-enforcement.test.ts` | Test infrastructure needs `rawDb` for setup/teardown |

### Checking the Allowlist

```bash
# Run the guard (automatically runs in CI)
pnpm rls:guard

# Should output:
# ✅ rawDb guard: PASS
#    All rawDb imports are from allowed infrastructure files.
```

### Adding a New Allowed File

If you genuinely need to add a file to the allowlist (rare!):

1. **Ensure the operation lacks user/tenant context**
   - Pre-authentication flows (before userId exists)
   - Startup/shutdown infrastructure (before app is ready)
   - Test fixtures (setup/teardown)
   
2. **Add the file path to the allowlist**
   - Edit `backend/scripts/guard-rawdb-usage.sh`
   - Add the path to the `ALLOWED_FILES` array
   
3. **Document the reason in this file**
   - Update the table above with the file path and reason
   
4. **Get approval in code review**
   - `rawDb` usage is security-critical and requires careful review

**Example of a BAD reason**: "The service needs to query multiple budgets" → Use `withTenantContext` in a loop instead

**Example of a GOOD reason**: "System health check endpoint needs to count all users before any authentication" → Acceptable (but still requires review)

## Adding a New Service Function

```typescript
// src/services/myFeature.ts
import type { DbClient } from '../db/index.js';
import { myTable } from '../db/schema.js';

export async function getMyData(tx: DbClient, budgetId: number) {
  return tx.query.myTable.findMany({
    where: eq(myTable.budgetId, budgetId),
  });
}
```

## Adding a New Route

```typescript
// src/routes/myFeature.ts
import { withTenantContext } from '../db/context.js';
import * as myFeatureSvc from '../services/myFeature.js';

router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const budgetId = req.budget!.id;
  const data = await withTenantContext(userId, budgetId, (tx) =>
    myFeatureSvc.getMyData(tx, budgetId)
  );
  res.json(data);
}));
```

## Adding a New Table

1. Add the table to `src/db/schema.ts`.
2. Create a migration that:
   - Creates the table
   - Enables RLS: `ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;`
   - Adds appropriate policies with both `USING` and `WITH CHECK` clauses
3. Update `RLS_IMPLEMENTATION.md` coverage table.

## Common Mistakes

| Mistake | Why it breaks RLS | Fix |
|---------|-------------------|-----|
| Using `db` directly in a service | **Runtime error**: Proxy guard throws "Direct db.query() called without tenant context" | Accept `tx: DbClient` parameter, or use `rawDb` for infrastructure code |
| Calling a service without a context wrapper | Transaction has no `SET LOCAL` calls | Wrap in `withTenantContext`/`withUserContext` |
| Using `USING` without `WITH CHECK` | Reads are filtered but writes are unrestricted | Always add both clauses |
| Forgetting `SECURITY DEFINER` on helper functions | Cross-table policy checks fail due to RLS recursion | Add `SECURITY DEFINER` to helper functions |

## Verification

```bash
# Integration tests: runtime guard + cross-tenant isolation + fail-closed
npx tsx tests/rls-enforcement.test.ts

# rawDb allowlist guard (fails if unauthorized rawDb imports found)
pnpm rls:guard

# Linter check
npm run lint

# Build check
npm run build
```

### What the Tests Verify

- ✅ **Runtime Guard**: `db.query()`, `db.select()`, `db.insert()`, etc. throw without context
- ✅ **Same-tenant access**: Users can read/write their own data
- ⚠️ **Cross-tenant isolation**: Users cannot read/write other users' data (RLS policies)
- ⚠️ **Fail-closed**: Queries without context return empty results (RLS policies)
- ⚠️ **Budget sharing**: Shared users have correct permissions (RLS policies)

**Note**: Runtime guard tests should always pass. RLS policy tests may fail if policies are not yet implemented.

## Database Role Requirements

### Production
The application **will not start** if the database role has:
- `BYPASSRLS` privilege
- Superuser privilege

This is a hard requirement enforced at startup. The application exits with an error if an unsafe role is detected.

### Local Development
If you need to use a superuser role for local development (e.g., for running migrations), set:
```bash
ALLOW_UNSAFE_DB_ROLE=true
```

⚠️ **WARNING**: Never set this in production! It defeats the entire purpose of RLS.

### Creating a Safe Role
```sql
CREATE ROLE app_user WITH LOGIN PASSWORD 'secure_password';
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
```
