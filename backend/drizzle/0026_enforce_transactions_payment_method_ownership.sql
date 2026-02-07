-- Migration 0026: Enforce transaction payment method ownership in RLS policy
--
-- Goal:
-- - Prevent cross-tenant FK integrity violations on transactions.payment_method_id.
-- - Ensure transaction rows only reference payment methods owned by the budget owner.
--
-- This helper runs as SECURITY DEFINER so policy checks are evaluated against
-- canonical ownership data, not the caller's RLS-visible subset.
CREATE OR REPLACE FUNCTION is_budget_payment_method(p_budget_id integer, p_payment_method_id integer) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM budgets b
    INNER JOIN payment_methods pm ON pm.user_id = b.user_id
    WHERE b.id = p_budget_id
      AND pm.id = p_payment_method_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS transactions_isolation ON transactions;

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
    AND is_budget_payment_method(get_current_budget_id(), payment_method_id)
  )
  WITH CHECK (
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
    AND is_budget_payment_method(get_current_budget_id(), payment_method_id)
  );
