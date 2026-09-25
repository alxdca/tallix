-- Add first-class budget collaboration and transaction attribution.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE transactions t
SET created_by_user_id = b.user_id
FROM budget_years by2
INNER JOIN budgets b ON b.id = by2.budget_id
WHERE t.year_id = by2.id
  AND t.created_by_user_id IS NULL;

UPDATE budget_shares SET role = 'read' WHERE role = 'reader';
UPDATE budget_shares SET role = 'write' WHERE role IN ('writer', 'admin');

ALTER TABLE budget_shares DROP CONSTRAINT IF EXISTS budget_shares_role_check;
ALTER TABLE budget_shares
  ADD CONSTRAINT budget_shares_role_check CHECK (role IN ('read', 'write'));

CREATE OR REPLACE FUNCTION is_budget_writer(p_budget_id integer) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM budgets
    WHERE id = p_budget_id AND user_id = get_current_user_id()
  ) OR EXISTS (
    SELECT 1 FROM budget_shares
    WHERE budget_id = p_budget_id
      AND user_id = get_current_user_id()
      AND role = 'write'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION users_share_budget(p_first_user_id uuid, p_second_user_id uuid) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM budgets b
    WHERE
      (b.user_id = p_first_user_id OR EXISTS (
        SELECT 1 FROM budget_shares s1 WHERE s1.budget_id = b.id AND s1.user_id = p_first_user_id
      ))
      AND
      (b.user_id = p_second_user_id OR EXISTS (
        SELECT 1 FROM budget_shares s2 WHERE s2.budget_id = b.id AND s2.user_id = p_second_user_id
      ))
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION is_asset_in_budget(p_asset_id integer, p_budget_id integer) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM assets WHERE id = p_asset_id AND budget_id = p_budget_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION find_user_id_by_email(p_budget_id integer, p_email text) RETURNS uuid AS $$
BEGIN
  IF NOT is_budget_owner(p_budget_id) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT id FROM users WHERE lower(email) = lower(trim(p_email)) LIMIT 1);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION preserve_transaction_creator() RETURNS trigger AS $$
BEGIN
  IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'Transaction creator cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_preserve_creator ON transactions;
CREATE TRIGGER transactions_preserve_creator
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION preserve_transaction_creator();

DROP POLICY IF EXISTS users_collaborators_read ON users;
CREATE POLICY users_collaborators_read ON users
  FOR SELECT
  USING (users_share_budget(get_current_user_id(), id));

-- Collaborators use the budget owner's payment methods for transactions and balances.
DROP POLICY IF EXISTS payment_methods_isolation ON payment_methods;
CREATE POLICY payment_methods_shared_read ON payment_methods
  FOR SELECT
  USING (
    user_id = get_current_user_id()
    OR (
      get_current_budget_id() IS NOT NULL
      AND is_budget_authorized(get_current_budget_id())
      AND EXISTS (
        SELECT 1 FROM budgets b
        WHERE b.id = get_current_budget_id() AND b.user_id = payment_methods.user_id
      )
    )
  );
CREATE POLICY payment_methods_owner_write ON payment_methods
  FOR ALL
  USING (user_id = get_current_user_id())
  WITH CHECK (
    user_id = get_current_user_id()
    AND is_owned_linked_payment_method(user_id, linked_payment_method_id)
  );

-- Reader policies are SELECT-only. Writer policies cover every mutation.
DROP POLICY IF EXISTS budget_years_isolation ON budget_years;
CREATE POLICY budget_years_read ON budget_years FOR SELECT
  USING (budget_id = get_current_budget_id() AND is_budget_authorized(budget_id));
CREATE POLICY budget_years_write ON budget_years FOR ALL
  USING (budget_id = get_current_budget_id() AND is_budget_writer(budget_id))
  WITH CHECK (budget_id = get_current_budget_id() AND is_budget_writer(budget_id));

DROP POLICY IF EXISTS budget_groups_isolation ON budget_groups;
CREATE POLICY budget_groups_read ON budget_groups FOR SELECT
  USING (budget_id = get_current_budget_id() AND is_budget_authorized(budget_id));
CREATE POLICY budget_groups_write ON budget_groups FOR ALL
  USING (budget_id = get_current_budget_id() AND is_budget_writer(budget_id))
  WITH CHECK (budget_id = get_current_budget_id() AND is_budget_writer(budget_id));

DROP POLICY IF EXISTS budget_items_isolation ON budget_items;
CREATE POLICY budget_items_read ON budget_items FOR SELECT
  USING (year_id IN (
    SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()
  ));
CREATE POLICY budget_items_write ON budget_items FOR ALL
  USING (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
    AND (group_id IS NULL OR group_id IN (
      SELECT id FROM budget_groups WHERE budget_id = get_current_budget_id()
    ))
    AND (savings_account_id IS NULL OR is_budget_payment_method(get_current_budget_id(), savings_account_id))
  );

DROP POLICY IF EXISTS monthly_values_isolation ON monthly_values;
CREATE POLICY monthly_values_read ON monthly_values FOR SELECT
  USING (item_id IN (
    SELECT bi.id FROM budget_items bi
    INNER JOIN budget_years by2 ON by2.id = bi.year_id
    WHERE by2.budget_id = get_current_budget_id()
  ));
CREATE POLICY monthly_values_write ON monthly_values FOR ALL
  USING (
    is_budget_writer(get_current_budget_id())
    AND item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON by2.id = bi.year_id
      WHERE by2.budget_id = get_current_budget_id()
    )
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON by2.id = bi.year_id
      WHERE by2.budget_id = get_current_budget_id()
    )
  );

DROP POLICY IF EXISTS transactions_isolation ON transactions;
CREATE POLICY transactions_read ON transactions FOR SELECT
  USING (
    year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
    AND is_budget_payment_method(get_current_budget_id(), payment_method_id)
  );
CREATE POLICY transactions_insert ON transactions FOR INSERT
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND created_by_user_id = get_current_user_id()
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
    AND (item_id IS NULL OR item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON by2.id = bi.year_id
      WHERE by2.budget_id = get_current_budget_id()
    ))
    AND is_budget_payment_method(get_current_budget_id(), payment_method_id)
  );
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
    AND (item_id IS NULL OR item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by2 ON by2.id = bi.year_id
      WHERE by2.budget_id = get_current_budget_id()
    ))
    AND is_budget_payment_method(get_current_budget_id(), payment_method_id)
  );
CREATE POLICY transactions_delete ON transactions FOR DELETE
  USING (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  );

DROP POLICY IF EXISTS transfers_isolation ON transfers;
CREATE POLICY transfers_read ON transfers FOR SELECT
  USING (year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()));
CREATE POLICY transfers_write ON transfers FOR ALL
  USING (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
    AND is_budget_payment_method(get_current_budget_id(), source_account_id)
    AND is_budget_payment_method(get_current_budget_id(), destination_account_id)
  );

DROP POLICY IF EXISTS account_balances_isolation ON account_balances;
CREATE POLICY account_balances_read ON account_balances FOR SELECT
  USING (year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()));
CREATE POLICY account_balances_write ON account_balances FOR ALL
  USING (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
    AND is_budget_payment_method(get_current_budget_id(), payment_method_id)
  );

ALTER TABLE entry_order_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_order_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY entry_order_overrides_read ON entry_order_overrides FOR SELECT
  USING (year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()));
CREATE POLICY entry_order_overrides_write ON entry_order_overrides FOR ALL
  USING (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  );

DROP POLICY IF EXISTS assets_select_policy ON assets;
DROP POLICY IF EXISTS assets_insert_policy ON assets;
DROP POLICY IF EXISTS assets_update_policy ON assets;
DROP POLICY IF EXISTS assets_delete_policy ON assets;
CREATE POLICY assets_read ON assets FOR SELECT
  USING (budget_id = get_current_budget_id() AND is_budget_authorized(budget_id));
CREATE POLICY assets_write ON assets FOR ALL
  USING (budget_id = get_current_budget_id() AND is_budget_writer(budget_id))
  WITH CHECK (
    budget_id = get_current_budget_id()
    AND is_budget_writer(budget_id)
    AND (parent_asset_id IS NULL OR is_asset_in_budget(parent_asset_id, get_current_budget_id()))
  );

DROP POLICY IF EXISTS asset_values_select_policy ON asset_values;
DROP POLICY IF EXISTS asset_values_insert_policy ON asset_values;
DROP POLICY IF EXISTS asset_values_update_policy ON asset_values;
DROP POLICY IF EXISTS asset_values_delete_policy ON asset_values;
CREATE POLICY asset_values_read ON asset_values FOR SELECT
  USING (asset_id IN (SELECT id FROM assets WHERE budget_id = get_current_budget_id()));
CREATE POLICY asset_values_write ON asset_values FOR ALL
  USING (
    is_budget_writer(get_current_budget_id())
    AND asset_id IN (SELECT id FROM assets WHERE budget_id = get_current_budget_id())
  )
  WITH CHECK (
    is_budget_writer(get_current_budget_id())
    AND asset_id IN (SELECT id FROM assets WHERE budget_id = get_current_budget_id())
    AND year_id IN (SELECT id FROM budget_years WHERE budget_id = get_current_budget_id())
  );
