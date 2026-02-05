-- Remove unused budget name column
ALTER TABLE "budgets" DROP COLUMN IF EXISTS "name";
