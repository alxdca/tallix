-- Migration 0016: Create safe application role
-- 
-- Creates tallix_app role without BYPASSRLS or superuser privileges.
-- This role is used in production to ensure RLS policies are enforced.

-- Create role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tallix_app') THEN
    CREATE ROLE tallix_app WITH 
      LOGIN 
      PASSWORD 'tallix_app_secret'
      NOSUPERUSER 
      NOCREATEDB 
      NOCREATEROLE 
      NOBYPASSRLS;
    
    RAISE NOTICE 'Created role: tallix_app';
  ELSE
    RAISE NOTICE 'Role tallix_app already exists, skipping creation';
  END IF;
END
$$;

-- Grant database connection
GRANT CONNECT ON DATABASE tallix TO tallix_app;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO tallix_app;

-- Grant table permissions (SELECT, INSERT, UPDATE, DELETE)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tallix_app;

-- Grant sequence permissions (for serial/identity columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tallix_app;

-- Grant permissions on future tables (if any are created later)
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tallix_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT USAGE, SELECT ON SEQUENCES TO tallix_app;

-- Verify role was created correctly
SELECT 
  'tallix_app role verification:' as status,
  rolname, 
  rolsuper as is_superuser, 
  rolbypassrls as can_bypass_rls,
  rolcanlogin as can_login
FROM pg_roles 
WHERE rolname = 'tallix_app';
