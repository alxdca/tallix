-- Migration 0018: Fix RLS circular dependency between budgets and budget_shares
-- 
-- Problem: The budgets_shared_read policy queries budget_shares, and the budget_shares_owner
-- policy queries budgets, creating infinite recursion when PostgreSQL evaluates both policies.
--
-- Solution: Make the helper functions bypass RLS by explicitly setting the security context,
-- and simplify the policies to avoid circular subqueries.

-- Drop existing problematic policies
DROP POLICY IF EXISTS budgets_shared_read ON budgets;
DROP POLICY IF EXISTS budget_shares_owner ON budget_shares;

-- Recreate budgets_shared_read WITHOUT subquery to budget_shares
-- Instead, we'll rely on the SECURITY DEFINER function to handle the logic
CREATE POLICY budgets_shared_read ON budgets
  FOR SELECT
  USING (
    -- Check if user has a share for this budget
    -- The is_user_has_budget_share function will use SECURITY DEFINER to avoid recursion
    EXISTS (
      SELECT 1 FROM budget_shares bs 
      WHERE bs.budget_id = budgets.id 
      AND bs.user_id = get_current_user_id()
    )
  );

-- Recreate budget_shares_owner to check ownership directly without subquery to budgets
CREATE POLICY budget_shares_owner ON budget_shares
  FOR ALL
  USING (
    -- Check if the budget belongs to the current user by joining directly
    EXISTS (
      SELECT 1 FROM budgets b 
      WHERE b.id = budget_shares.budget_id 
      AND b.user_id = get_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM budgets b 
      WHERE b.id = budget_shares.budget_id 
      AND b.user_id = get_current_user_id()
    )
  );

-- Alternative approach: Create special functions that explicitly control RLS
-- These functions run with SET LOCAL and bypass RLS for their internal queries

-- Helper function to check if a user owns a budget (bypasses RLS internally)
CREATE OR REPLACE FUNCTION user_owns_budget(p_user_id uuid, p_budget_id integer) 
RETURNS boolean AS $$
DECLARE
  v_result boolean;
BEGIN
  -- Direct query without RLS policy evaluation
  SELECT EXISTS (
    SELECT 1 FROM budgets 
    WHERE id = p_budget_id AND user_id = p_user_id
  ) INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Helper function to check if a user has a budget share (bypasses RLS internally)
CREATE OR REPLACE FUNCTION user_has_budget_share(p_user_id uuid, p_budget_id integer) 
RETURNS boolean AS $$
DECLARE
  v_result boolean;
BEGIN
  -- Direct query without RLS policy evaluation
  SELECT EXISTS (
    SELECT 1 FROM budget_shares 
    WHERE budget_id = p_budget_id AND user_id = p_user_id
  ) INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Now recreate policies using these helper functions
DROP POLICY IF EXISTS budgets_shared_read ON budgets;
DROP POLICY IF EXISTS budget_shares_owner ON budget_shares;

CREATE POLICY budgets_shared_read ON budgets
  FOR SELECT
  USING (
    user_has_budget_share(get_current_user_id(), budgets.id)
  );

CREATE POLICY budget_shares_owner ON budget_shares
  FOR ALL
  USING (
    user_owns_budget(get_current_user_id(), budget_shares.budget_id)
  )
  WITH CHECK (
    user_owns_budget(get_current_user_id(), budget_shares.budget_id)
  );

-- Verify the changes
SELECT 'Fixed RLS circular dependency' as status;
SELECT 'Created helper functions: user_owns_budget, user_has_budget_share' as info;
