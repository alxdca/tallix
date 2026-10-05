# Database and Migrations

## Schema

- Schema definitions live in `backend/src/db/schema.ts`.
- Drizzle is the ORM and uses SQL migrations stored in `backend/drizzle`.

## Migrations

- Generated migrations are stored as SQL files in `backend/drizzle/`.
- The migration journal is `backend/drizzle/meta/_journal.json`.
- The database stores applied migrations in `drizzle.__drizzle_migrations`.

### Generate a migration

```bash
pnpm -C backend db:generate
```

### Apply migrations

```bash
pnpm -C backend db:migrate
```

### Common pitfalls

- Ensure the migration journal `when` timestamps are monotonically increasing.
- If a migration is out of order, Drizzle may skip it or apply in the wrong order.
- Verify the applied migrations in `drizzle.__drizzle_migrations` if a column is missing.

## Row-level security

RLS policies are created in migration files and enforced at runtime. See:

- `docs/rls/README.md`
- `docs/rls/RLS_IMPLEMENTATION.md`
- `docs/rls/RLS_ENFORCEMENT_GUIDE.md`

## Budgets and years

Migration `0032_split_yearly_budgets.sql` separates legacy multi-year budgets before
the earlier yearly budget selector. It retains one existing budget ID and creates
budgets for the other years, preserving year and item IDs. Groups and asset
hierarchies are copied into each new budget, and existing collaborator access is
preserved. These existing budget IDs remain separate to avoid changing access or merging ambiguous data.

The current model uses multiple `budget_years` rows within each named budget, backed by the existing unique `(budget_id, year)` constraint. New years are added explicitly to the selected budget; budget-level shares cover all of its years. No merge migration is applied.

Apply migrations with the normal migration command before starting the updated app.
