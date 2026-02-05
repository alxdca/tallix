-- Migration 0017: Restrict shared budget writes to owners only
-- 
-- Issue: Current WITH CHECK clauses use is_budget_authorized() which allows
-- both owners AND shared readers to write. Shared readers should be read-only.
--
-- Solution: WITH CHECK should verify budget ownership, not just authorization.

-- Helper function: Check if current user OWNS the budget (not just has a share)
CREATE OR REPLACE FUNCTION is_budget_owner(p_budget_id integer) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM budgets 
    WHERE id = p_budget_id 
    AND user_id = get_current_user_id()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Update transactions policy: READ uses is_budget_authorized, WRITE uses is_budget_owner
DROP POLICY IF EXISTS transactions_isolation ON transactions;

CREATE POLICY transactions_isolation ON transactions
  FOR ALL
  USING (
    -- USING (read): Allow if user is authorized (owner OR shared reader)
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
    -- WITH CHECK (write): Allow ONLY if user is the OWNER
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_owner(get_current_budget_id())
    )
    AND (item_id IS NULL OR item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON bi.year_id = by2.id
      WHERE by2.budget_id = get_current_budget_id()
    ))
  );

-- Update other budget-scoped tables similarly
DROP POLICY IF EXISTS budget_years_isolation ON budget_years;

CREATE POLICY budget_years_isolation ON budget_years
  FOR ALL
  USING (
    budget_id = get_current_budget_id()
    AND is_budget_authorized(get_current_budget_id())
  )
  WITH CHECK (
    budget_id = get_current_budget_id()
    AND is_budget_owner(get_current_budget_id())
  );

DROP POLICY IF EXISTS budget_groups_isolation ON budget_groups;

CREATE POLICY budget_groups_isolation ON budget_groups
  FOR ALL
  USING (
    budget_id = get_current_budget_id()
    AND is_budget_authorized(get_current_budget_id())
  )
  WITH CHECK (
    budget_id = get_current_budget_id()
    AND is_budget_owner(get_current_budget_id())
  );

DROP POLICY IF EXISTS budget_items_isolation ON budget_items;

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
        AND is_budget_owner(get_current_budget_id())
    )
    AND (group_id IS NULL OR group_id IN (
      SELECT id FROM budget_groups WHERE budget_id = get_current_budget_id()
    ))
    AND (savings_account_id IS NULL OR savings_account_id IN (
      SELECT id FROM payment_methods WHERE user_id = get_current_user_id()
    ))
  );

DROP POLICY IF EXISTS transfers_isolation ON transfers;

CREATE POLICY transfers_isolation ON transfers
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_authorized(get_current_budget_id())
    )
    AND source_account_id IN (SELECT id FROM payment_methods WHERE user_id = get_current_user_id())
    AND destination_account_id IN (SELECT id FROM payment_methods WHERE user_id = get_current_user_id())
  )
  WITH CHECK (
    year_id IN (
      SELECT id FROM budget_years
      WHERE budget_id = get_current_budget_id()
        AND is_budget_owner(get_current_budget_id())
    )
    AND source_account_id IN (SELECT id FROM payment_methods WHERE user_id = get_current_user_id())
    AND destination_account_id IN (SELECT id FROM payment_methods WHERE user_id = get_current_user_id())
  );

-- Verify the new function
SELECT 'is_budget_owner function created:' as status;
SELECT proname, prosecdef, pg_get_userbyid(proowner) as owner 
FROM pg_proc 
WHERE proname = 'is_budget_owner';
