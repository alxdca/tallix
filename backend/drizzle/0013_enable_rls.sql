-- Enable Row-Level Security (RLS) for tenant isolation
-- This migration adds database-level security policies to prevent cross-tenant data access

-- Enable RLS on all multi-tenant tables
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;

ALTER TABLE budget_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_shares FORCE ROW LEVEL SECURITY;

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY;

ALTER TABLE budget_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_years FORCE ROW LEVEL SECURITY;

ALTER TABLE budget_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_groups FORCE ROW LEVEL SECURITY;

ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items FORCE ROW LEVEL SECURITY;

ALTER TABLE monthly_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_values FORCE ROW LEVEL SECURITY;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers FORCE ROW LEVEL SECURITY;

ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_balances FORCE ROW LEVEL SECURITY;

-- Helper function to get current user_id from session context
CREATE OR REPLACE FUNCTION get_current_user_id() RETURNS uuid AS $$
BEGIN
  RETURN current_setting('app.user_id', true)::uuid;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to get current budget_id from session context
CREATE OR REPLACE FUNCTION get_current_budget_id() RETURNS integer AS $$
BEGIN
  RETURN current_setting('app.budget_id', true)::integer;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- RLS Policies for budgets table (owned by user_id)
CREATE POLICY budgets_isolation ON budgets
  FOR ALL
  USING (user_id = get_current_user_id());

-- RLS Policies for budget_shares table (owned by user_id or budget owner)
CREATE POLICY budget_shares_isolation ON budget_shares
  FOR ALL
  USING (
    user_id = get_current_user_id() OR
    budget_id IN (SELECT id FROM budgets WHERE user_id = get_current_user_id())
  );

-- RLS Policies for payment_methods table (owned by user_id)
CREATE POLICY payment_methods_isolation ON payment_methods
  FOR ALL
  USING (user_id = get_current_user_id());

-- RLS Policies for budget_years table (scoped by budget_id)
CREATE POLICY budget_years_isolation ON budget_years
  FOR ALL
  USING (budget_id = get_current_budget_id());

-- RLS Policies for budget_groups table (scoped by budget_id)
CREATE POLICY budget_groups_isolation ON budget_groups
  FOR ALL
  USING (budget_id = get_current_budget_id());

-- RLS Policies for budget_items table (scoped via budget_years)
CREATE POLICY budget_items_isolation ON budget_items
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()
    )
  );

-- RLS Policies for monthly_values table (scoped via budget_items -> budget_years)
CREATE POLICY monthly_values_isolation ON monthly_values
  FOR ALL
  USING (
    item_id IN (
      SELECT bi.id FROM budget_items bi
      INNER JOIN budget_years by ON bi.year_id = by.id
      WHERE by.budget_id = get_current_budget_id()
    )
  );

-- RLS Policies for transactions table (scoped via budget_years)
CREATE POLICY transactions_isolation ON transactions
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()
    )
  );

-- RLS Policies for transfers table (scoped via budget_years)
CREATE POLICY transfers_isolation ON transfers
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()
    )
  );

-- RLS Policies for account_balances table (scoped via budget_years)
CREATE POLICY account_balances_isolation ON account_balances
  FOR ALL
  USING (
    year_id IN (
      SELECT id FROM budget_years WHERE budget_id = get_current_budget_id()
    )
  );
