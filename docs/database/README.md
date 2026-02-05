# Database Migrations

This guide covers how the database schema is managed and migrated.

## Schema source

- `backend/src/db/schema.ts`
- SQL migrations in `backend/drizzle/`

## Generate a migration

```bash
pnpm -C backend db:generate
```

## Apply migrations

```bash
pnpm -C backend db:migrate
```

## Migration ordering

Drizzle relies on the journal timestamps in `backend/drizzle/meta/_journal.json` to apply migrations in order.

- Ensure `when` values are monotonically increasing.
- If a migration appears out of order, update the journal or regenerate it before applying.

## Verify applied migrations

The database stores applied migrations in:

- `drizzle.__drizzle_migrations`

You can query it to confirm whether a migration ran.

## Common issues

- Missing columns usually indicate a migration was not applied.
- Check that the migration file exists and the journal entry is in order.
