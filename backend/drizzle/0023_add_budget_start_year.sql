-- Migration: Add start_year to budgets table

-- Add start_year column with a temporary default (current year)
-- This allows existing rows to be updated without constraint violations
ALTER TABLE "budgets"
ADD COLUMN "start_year" INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER NOT NULL;

-- Backfill start_year for each budget:
-- - If budget has years in budget_years: use the minimum year
-- - Otherwise, keep the default (current year)
UPDATE "budgets" b
SET "start_year" = COALESCE(
  (
    SELECT MIN(year)
    FROM "budget_years" by
    WHERE by.budget_id = b.id
  ),
  EXTRACT(YEAR FROM NOW())::INTEGER
);

-- Remove the default constraint so new budgets must explicitly set start_year
ALTER TABLE "budgets"
ALTER COLUMN "start_year" DROP DEFAULT;
