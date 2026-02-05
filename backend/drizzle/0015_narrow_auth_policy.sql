-- Migration 0015: Narrow users_auth_no_context policy
-- This migration restricts the no-context policy to only SELECT and INSERT operations.
-- UPDATE operations now require withUserContext, which was refactored in auth.ts.

-- Drop the old permissive policy that allowed ALL operations
DROP POLICY IF EXISTS users_auth_no_context ON users;

-- Create a narrower policy that only allows SELECT and INSERT when no context is set
-- This is needed for:
-- - SELECT: login (lookup user by email)
-- - INSERT: register (create new user when no userId exists yet)
CREATE POLICY users_auth_select_insert_no_context ON users
  FOR SELECT
  USING (get_current_user_id() IS NULL);

CREATE POLICY users_auth_insert_no_context ON users
  FOR INSERT
  WITH CHECK (get_current_user_id() IS NULL);

-- Note: UPDATE and DELETE operations on users table now require context
-- Auth service functions (updateUser, changePassword) now use withUserContext
-- This reduces the RLS bypass surface area and improves security
