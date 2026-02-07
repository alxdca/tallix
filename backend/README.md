# Tallix Backend

Backend API server for Tallix budget management application.

## Development Setup

### Option 1: Local Development (without Docker)

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up PostgreSQL:**
   
   You need a PostgreSQL 16+ instance running. You can either:
   - Install PostgreSQL locally
   - Run just the database in Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=tallix_secret postgres:16`

3. **Create the database and users:**
   ```bash
   # Connect to postgres
   psql -U postgres
   
   # Run these commands
   CREATE DATABASE tallix;
   CREATE USER tallix WITH PASSWORD 'tallix_secret' SUPERUSER;
   CREATE USER tallix_app WITH PASSWORD 'tallix_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   
   # Grant permissions to tallix_app
   \c tallix
   GRANT CONNECT ON DATABASE tallix TO tallix_app;
   GRANT USAGE ON SCHEMA public TO tallix_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tallix_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tallix_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE tallix IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tallix_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE tallix IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tallix_app;
   ```

4. **Configure environment:**
   
   The backend loads `.env` from either the root directory or the backend directory.
   
   ```bash
   # From project root
   cp .env.example .env
   # Edit .env with your local settings
   
   # OR create backend/.env if you prefer
   cd backend
   cp ../.env.example .env
   ```

5. **Run migrations:**
   ```bash
   pnpm db:migrate
   ```

6. **Start the development server:**
   ```bash
   pnpm dev  # Uses dotenv-cli to load environment variables
   ```
   
   All npm scripts automatically load environment variables from root or backend `.env` files.

### Option 2: Docker Development

From the project root:
```bash
docker-compose up -d
```

The init script will automatically create the database and users.

## Environment Variables

The backend loads environment variables from `.env` in either:
1. The backend directory (`backend/.env`)
2. The project root (`../.env`)

See the root `.env.example` for all available configuration options.

### Key Variables

- `DB_HOST`, `DB_PORT`, `DB_NAME` - Database connection details
- `POSTGRES_USER`, `POSTGRES_PASSWORD` - Superuser credentials (for migrations)
- `APP_DB_USER`, `APP_DB_PASSWORD` - Application user credentials (for runtime)
- `JWT_SECRET` - Secret key for JWT token generation (required; use at least 32 random characters outside local dev)
- `MODE` - Set to `demo` to enable demo user (demo@tallix.org / demo)
- `ALLOW_UNSAFE_DB_ROLE` - Set to `true` for local dev to allow superuser connections

## Scripts

- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm db:generate` - Generate new migration from schema changes
- `pnpm db:migrate` - Apply pending migrations
- `pnpm db:push` - Push schema changes directly (dev only)
- `pnpm db:studio` - Open Drizzle Studio (database GUI)
- `pnpm test:rls` - Run RLS security tests
- `pnpm check:rls` - Verify RLS imports are correct
- `pnpm rls:guard` - Check rawDb usage is allowed

## Security

This backend uses Row-Level Security (RLS) to ensure data isolation between users and budgets. See `/docs/DATABASE_SECURITY.md` for details.

### Important Security Notes

- Never use superuser credentials in production
- Always set `ALLOW_UNSAFE_DB_ROLE=false` in production
- The `tallix_app` user has restricted permissions (no DDL operations)
- Migrations run with superuser, but the app runs with restricted user
