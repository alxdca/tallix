#!/bin/bash
set -e

# This script runs when the PostgreSQL container is first initialized
# It creates the application user with restricted privileges for runtime operations
# Migrations are run using the superuser account

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- ============================================================
    -- Create APP role (for runtime - restricted)
    -- ============================================================
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$APP_DB_USER') THEN
        CREATE ROLE $APP_DB_USER WITH 
          LOGIN 
          PASSWORD '$APP_DB_PASSWORD'
          NOSUPERUSER 
          NOCREATEDB 
          NOCREATEROLE 
          NOBYPASSRLS;
        
        RAISE NOTICE 'Created role: $APP_DB_USER';
      ELSE
        RAISE NOTICE 'Role $APP_DB_USER already exists, skipping creation';
      END IF;
    END
    \$\$;

    -- Grant database connection
    GRANT CONNECT ON DATABASE $POSTGRES_DB TO $APP_DB_USER;

    -- Grant schema usage (read-only schema access)
    GRANT USAGE ON SCHEMA public TO $APP_DB_USER;

    -- Grant table permissions (SELECT, INSERT, UPDATE, DELETE - NO DDL)
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $APP_DB_USER;

    -- Grant sequence permissions (for serial/identity columns)
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $APP_DB_USER;

    -- Grant permissions on future tables (created by migrations)
    ALTER DEFAULT PRIVILEGES FOR ROLE $POSTGRES_USER IN SCHEMA public 
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $APP_DB_USER;

    ALTER DEFAULT PRIVILEGES FOR ROLE $POSTGRES_USER IN SCHEMA public 
      GRANT USAGE, SELECT ON SEQUENCES TO $APP_DB_USER;

    -- ============================================================
    -- Verify role was created correctly
    -- ============================================================
    SELECT 
      'Database roles verification:' as status,
      rolname, 
      rolsuper as is_superuser, 
      rolbypassrls as can_bypass_rls,
      rolcanlogin as can_login
    FROM pg_roles 
    WHERE rolname IN ('$POSTGRES_USER', '$APP_DB_USER')
    ORDER BY rolname;
EOSQL

echo "✓ Superuser $POSTGRES_USER will be used for migrations"
echo "✓ App user $APP_DB_USER created successfully (for runtime)"
