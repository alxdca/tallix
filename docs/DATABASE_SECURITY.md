# Database Security Model

This document describes the two-user PostgreSQL security setup for Tallix.

## Overview

Tallix uses a **two-tier user model** for PostgreSQL access:

1. **Superuser** (`tallix`) - Container initialization and schema migrations
2. **App User** (`tallix_app`) - Runtime operations

This separation ensures the principle of least privilege: the running application cannot modify the database schema, reducing the attack surface.

## User Roles

### 1. Superuser (`tallix`)

- **Purpose**: PostgreSQL container initialization, user creation, and migrations
- **Privileges**: Full superuser access
- **Usage**: 
  - Creates the database
  - Runs the init script to create the app user
  - Runs database migrations via Drizzle
  - **Not used by the application at runtime**
- **Credentials**: `POSTGRES_USER` / `POSTGRES_PASSWORD`
- **Connection String**: `MIGRATION_DATABASE_URL`

### 2. App User (`tallix_app`)

- **Purpose**: Runtime database operations
- **Privileges**:
  - `NOSUPERUSER`, `NOBYPASSRLS` (RLS policies are enforced)
  - **Cannot** modify schema (no CREATE, ALTER, DROP)
  - Can `SELECT`, `INSERT`, `UPDATE`, `DELETE` data
  - Can use sequences (for auto-incrementing IDs)
- **Usage**: 
  - All application queries at runtime
  - Row-Level Security (RLS) policies restrict data access per user
- **Credentials**: `APP_DB_USER` / `APP_DB_PASSWORD`
- **Connection String**: `DATABASE_URL`

## User Creation Flow

1. PostgreSQL container starts for the first time
2. Container creates the superuser (`tallix`) and database
3. Container runs `/docker-entrypoint-initdb.d/init-db.sh`
4. Init script creates `tallix_app` with data-only privileges
5. Backend starts and runs migrations using `tallix` (superuser)
6. Backend switches to `tallix_app` for runtime operations

## Configuration

### Environment Variables

In `.env` or environment:

```bash
# Database connection details
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tallix

# Superuser (for container init and migrations)
POSTGRES_USER=tallix
POSTGRES_PASSWORD=secure_password_here
POSTGRES_DB=tallix

# App user (for runtime)
APP_DB_USER=tallix_app
APP_DB_PASSWORD=secure_app_password_here
```

### Connection Strings

Database URLs are constructed dynamically from the credentials above:

```bash
# Used by the application at runtime (restricted user)
DATABASE_URL=postgresql://${APP_DB_USER}:${APP_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}

# Used by Drizzle migrations (superuser) - constructed in Dockerfile CMD
# postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
```

## Deployment

### Docker Compose

The `init-db.sh` script is automatically mounted and executed:

```yaml
postgres:
  volumes:
    - ./backend/init-db.sh:/docker-entrypoint-initdb.d/init-db.sh
  environment:
    POSTGRES_USER: tallix
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    APP_DB_USER: tallix_app
    APP_DB_PASSWORD: ${APP_DB_PASSWORD}
```

### Application Startup

The Dockerfile CMD runs:

```bash
DATABASE_URL=$MIGRATION_DATABASE_URL pnpm db:migrate && node dist/index.js
```

This:
1. Sets `DATABASE_URL` to admin credentials for migration
2. Runs `pnpm db:migrate` (Drizzle migrations)
3. Starts the app with runtime `DATABASE_URL` (app user)

## Local Development

For local development, you can still use the superuser if needed:

```bash
# Local development (less secure, but convenient)
DATABASE_URL=postgresql://tallix:tallix_secret@localhost:5432/tallix
MIGRATION_DATABASE_URL=postgresql://tallix:tallix_secret@localhost:5432/tallix
```

However, it's recommended to use the proper user separation even in development to catch permission issues early.

## Security Benefits

1. **Least Privilege**: Application cannot accidentally drop tables or modify schema at runtime
2. **Defense in Depth**: Even if SQL injection occurs, attacker cannot modify schema
3. **RLS Enforcement**: App user has `NOBYPASSRLS`, ensuring Row-Level Security policies apply
4. **Audit Trail**: Separate users make it easier to track migration vs. runtime operations in logs
5. **Simplified Setup**: Uses PostgreSQL's built-in superuser for migrations (no extra user needed)

## Testing

To verify the user permissions:

```sql
-- Connect as tallix_app
\c tallix tallix_app

-- This should work (data operations)
SELECT * FROM users;
INSERT INTO users (email, password_hash) VALUES ('test@example.com', 'hash');

-- This should FAIL (schema operations)
CREATE TABLE test (id INT);  -- ERROR: permission denied
ALTER TABLE users ADD COLUMN test TEXT;  -- ERROR: must be owner of table
```

## Troubleshooting

### "permission denied for schema public"

The app user doesn't have `USAGE` on schema. Run:

```sql
GRANT USAGE ON SCHEMA public TO tallix_app;
```

### "must be owner of table" during migrations

Migrations are running with app user instead of superuser. Check:
- Dockerfile CMD constructs URL with `POSTGRES_USER` and `POSTGRES_PASSWORD`
- Environment variables are properly passed to the container

### Init script didn't run

The init script only runs when the database is **first created**. To re-run:

```bash
docker-compose down -v  # Remove volumes
docker-compose up -d    # Recreate with init script
```
