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
