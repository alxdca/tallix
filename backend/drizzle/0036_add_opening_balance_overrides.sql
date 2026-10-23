ALTER TABLE account_balances
  ADD COLUMN opening_balance_overridden boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Preserve explicit child start-year overrides. Later-year snapshots intentionally
-- remain false so their opening balances now follow the previous available year.
UPDATE account_balances AS balances
SET opening_balance_overridden = true
FROM budget_years AS years
JOIN budgets AS budget ON budget.id = years.budget_id
WHERE balances.year_id = years.id
  AND budget.parent_budget_id IS NOT NULL
  AND years.year = budget.start_year
  AND balances.inherited_from_parent = false;
