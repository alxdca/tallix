-- Allow asset and debt sections/items to share the same name
DROP INDEX IF EXISTS "assets_budget_name_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "assets_budget_name_debt_unique" ON "assets"("budget_id", "name", "is_debt");
