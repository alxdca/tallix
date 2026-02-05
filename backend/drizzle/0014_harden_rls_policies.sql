-- Migration 0014: Harden RLS policies
-- Adds budget sharing authorization, foreign key validation, WITH CHECK clauses,
-- settings table coverage, and users table policy.

-- ============================================================
-- 1. Helper: is_budget_authorized(budget_id)
--    Returns TRUE if the current user owns the budget OR has a share row.
-- ============================================================
CREATE OR REPLACE FUNCTION is_budget_authorized(p_budget_id integer) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM budgets WHERE id = p_budget_id AND user_id = get_current_user_id()
  ) OR EXISTS (
    SELECT 1 FROM budget_shares WHERE budget_id = p_budget_id AND user_id = get_current_user_id()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 2. Drop all existing isolation policies (created in 0013)
-- ============================================================
DROP POLICY IF EXISTS budgets_isolation ON budgets;
DROP POLICY IF EXISTS budget_shares_isolation ON budget_shares;
DROP POLICY IF EXISTS payment_methods_isolation ON payment_methods;
DROP POLICY IF EXISTS budget_years_isolation ON budget_years;
DROP POLICY IF EXISTS budget_groups_isolation ON budget_groups;
DROP POLICY IF EXISTS budget_items_isolation ON budget_items;
DROP POLICY IF EXISTS monthly_values_isolation ON monthly_values;
DROP POLICY IF EXISTS transactions_isolation ON transactions;
DROP POLICY IF EXISTS transfers_isolation ON transfers;
DROP POLICY IF EXISTS account_balances_isolation ON account_balances;

-- ============================================================
-- 3. Budgets: owner has full access; shared users can SELECT
-- ============================================================
CREATE POLICY budgets_owner ON budgets
  FOR ALL
  USING (user_id = get_current_user_id())
  WITH CHECK (user_id = get_current_user_id());

CREATE POLICY budgets_shared_read ON budgets
  FOR SELECT
  USING (
    id IN (SELECT budget_id FROM budget_shares WHERE user_id = get_current_user_id())
  );

-- ============================================================
-- 4. Budget shares: owners manage shares; shared users read own rows
-- ============================================================
CREATE POLICY budget_shares_owner ON budget_shares
  FOR ALL
  USING (
    budget_id IN (SELECT id FROM budgets WHERE user_id = get_current_user_id())
  )
  WITH CHECK (
    budget_id IN (SELECT id FROM budgets WHERE user_id = get_current_user_id())
  );

CREATE POLICY budget_shares_self_read ON budget_shares
  FOR SELECT
  USING (user_id = get_current_user_id());

-- ============================================================
-- 5. Payment methods: user_id = current user (USING + WITH CHECK)
-- ============================================================
CREATE POLICY payment_methods_isolation ON payment_methods
  FOR ALL
  USING (user_id = get_current_user_id())
  WITH CHECK (user_id = get_current_user_id());

-- ============================================================
-- 6. Budget years: budget must match context AND be authorized
-- ============================================================
CREATE POLICY budget_years_isolation ON budget_years
  FOR ALL
  USING (
    budget_id = get_current_budget_id()
    AND is_budget_authorized(get_current_budget_id())
  )
  WITH CHECK (
    budget_id = get_current_budget_id()
    AND is_budget_authorized(get_current_budget_id())
  );

-- ============================================================
-- 7. Budget groups: budget must match context AND be authorized
-- ============================================================
CREATE POLICY budget_groups_isolation ON budget_groups
  FOR ALL
  USING (
    budget_id = get_current_budget_id()
    AND is_budget_authorized(get_current_budget_id())
  )
  WITH CHECK (
    budget_id = get_current_budget_id()
    AND is_budget_authorized(get_current_budget_id())
  );

-- ============================================================
-- 8. Budget items: year must belong to current budget;
--    group_id (if not null) must belong to current budget;
--    savings_account_id (if not null) must belong to current user.
-- ============================================================
CREATE POLICY budget_items_isolation ON budget_items
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND (group_id IS NULL OR group_id IN (
      SELECT id FROM budget_groups WHERE budget_id = get_current_budget_id()
    ))
    AND (savings_account_id IS NULL OR savings_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    ))
  )
  WITH CHECK (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND (group_id IS NULL OR group_id IN (
      SELECT id FROM budget_groups WHERE budget_id = get_current_budget_id()
    ))
    AND (savings_account_id IS NULL OR savings_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    ))
  );

-- ============================================================
-- 9. Monthly values: item must belong to current budget
-- ============================================================
CREATE POLICY monthly_values_isolation ON monthly_values
  FOR ALL
  USING (
    item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON bi.year_id = by2.id
      WHERE by2.budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
  )
  WITH CHECK (
    item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON bi.year_id = by2.id
      WHERE by2.budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
  );

-- ============================================================
-- 10. Transactions: year must belong to current budget;
--     item_id (if not null) must belong to current budget.
-- ============================================================
CREATE POLICY transactions_isolation ON transactions
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND (item_id IS NULL OR item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON bi.year_id = by2.id
      WHERE by2.budget_id = get_current_budget_id()
    ))
  )
  WITH CHECK (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND (item_id IS NULL OR item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON bi.year_id = by2.id
      WHERE by2.budget_id = get_current_budget_id()
    ))
  );

-- ============================================================
-- 11. Transfers: year must belong to current budget;
--     source and destination accounts must belong to current user.
-- ============================================================
CREATE POLICY transfers_isolation ON transfers
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND source_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    )
    AND destination_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    )
  )
  WITH CHECK (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND source_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    )
    AND destination_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    )
  );

-- ============================================================
-- 12. Account balances: year must belong to current budget;
--     payment_method_id must belong to current user.
-- ============================================================
CREATE POLICY account_balances_isolation ON account_balances
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND payment_method_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    )
  )
  WITH CHECK (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND payment_method_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    )
  );

-- ============================================================
-- 13. Settings table: enable RLS, user_id = current user
-- ============================================================
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;

CREATE POLICY settings_isolation ON settings
  FOR ALL
  USING (user_id = get_current_user_id())
  WITH CHECK (user_id = get_current_user_id());

-- ============================================================
-- 14. Users table: enable RLS, user can only see/modify own row.
--     Exception: auth service queries (login, register, setup)
--     run outside RLS context (no app.user_id set), so
--     get_current_user_id() returns NULL and no rows match.
--     Auth queries use the global db (not tx), which is acceptable
--     since auth is not tenant-scoped.
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_isolation ON users
  FOR ALL
  USING (id = get_current_user_id())
  WITH CHECK (id = get_current_user_id());

-- Auth operations (login, register, setup) need to query users
-- without RLS context. They use the global db connection which
-- runs as the table owner (bypasses RLS by default for table owners).
-- If the app role is NOT the table owner, we need a permissive policy
-- that allows SELECT when no context is set (for auth lookups).
-- INSERT is needed for registration.
CREATE POLICY users_auth_no_context ON users
  FOR ALL
  USING (get_current_user_id() IS NULL)
  WITH CHECK (get_current_user_id() IS NULL);
