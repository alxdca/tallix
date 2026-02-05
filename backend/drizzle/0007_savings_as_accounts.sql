-- Migration: Remove savings as a category type, add savings account support to payment methods
-- This is a breaking change that removes existing savings-related transfer data

-- Add is_savings_account column to payment_methods
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "is_savings_account" boolean NOT NULL DEFAULT false;

-- Drop the old unique constraint on account_balances (if exists)
DROP INDEX IF EXISTS "account_balances_year_account_unique";

-- Drop old columns and add new payment_method_id column to account_balances
-- First, drop any existing data since we're changing the structure
DELETE FROM "account_balances" WHERE "account_type" = 'savings_item';

-- Add the new column (nullable first)
ALTER TABLE "account_balances" ADD COLUMN IF NOT EXISTS "payment_method_id" integer;

-- Migrate existing payment_method account balances to use the new column
UPDATE "account_balances" 
SET "payment_method_id" = "account_id" 
WHERE "account_type" = 'payment_method' AND "payment_method_id" IS NULL;

-- Make the column NOT NULL and add foreign key
ALTER TABLE "account_balances" ALTER COLUMN "payment_method_id" SET NOT NULL;
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_payment_method_id_fkey" 
  FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE CASCADE;

-- Drop old columns
ALTER TABLE "account_balances" DROP COLUMN IF EXISTS "account_type";
ALTER TABLE "account_balances" DROP COLUMN IF EXISTS "account_id";

-- Add new unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "account_balances_year_payment_method_unique" 
  ON "account_balances" ("year_id", "payment_method_id");

-- Drop old transfer columns and simplify to direct payment_method references
-- First, delete any transfers that involve savings_items (they can't be migrated)
DELETE FROM "transfers" WHERE "source_account_type" = 'savings_item' OR "destination_account_type" = 'savings_item';

-- Drop the savingsItemId column
ALTER TABLE "transfers" DROP COLUMN IF EXISTS "savings_item_id";

-- Rename and convert account columns
-- Add new columns (nullable first)
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "source_account_id_new" integer;
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "destination_account_id_new" integer;

-- Migrate existing payment_method transfers
UPDATE "transfers" 
SET "source_account_id_new" = "source_account_id",
    "destination_account_id_new" = "destination_account_id"
WHERE "source_account_type" = 'payment_method' AND "destination_account_type" = 'payment_method';

-- Drop old columns
ALTER TABLE "transfers" DROP COLUMN IF EXISTS "source_account_type";
ALTER TABLE "transfers" DROP COLUMN IF EXISTS "destination_account_type";
ALTER TABLE "transfers" DROP COLUMN IF EXISTS "source_account_id";
ALTER TABLE "transfers" DROP COLUMN IF EXISTS "destination_account_id";

-- Rename new columns
ALTER TABLE "transfers" RENAME COLUMN "source_account_id_new" TO "source_account_id";
ALTER TABLE "transfers" RENAME COLUMN "destination_account_id_new" TO "destination_account_id";

-- Make columns NOT NULL and add foreign keys
ALTER TABLE "transfers" ALTER COLUMN "source_account_id" SET NOT NULL;
ALTER TABLE "transfers" ALTER COLUMN "destination_account_id" SET NOT NULL;
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_account_id_fkey" 
  FOREIGN KEY ("source_account_id") REFERENCES "payment_methods"("id") ON DELETE CASCADE;
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_account_id_fkey" 
  FOREIGN KEY ("destination_account_id") REFERENCES "payment_methods"("id") ON DELETE CASCADE;
