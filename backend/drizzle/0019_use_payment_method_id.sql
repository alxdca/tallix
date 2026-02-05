-- Migration: Use payment_method_id instead of payment_method string
-- This fixes the issue where account balances don't match because of name mismatches

-- Step 1: Add payment_method_id column (nullable initially)
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "payment_method_id" integer;

-- Step 2: Create a temporary function to find payment method ID by matching the string name
-- This handles cases where the string might be "Name (Institution)" or just "Name"
CREATE OR REPLACE FUNCTION find_payment_method_id(pm_string text, txn_user_id uuid) 
RETURNS integer AS $$
DECLARE
  pm_id integer;
BEGIN
  -- First try exact match on name
  SELECT id INTO pm_id
  FROM payment_methods
  WHERE user_id = txn_user_id AND name = pm_string
  LIMIT 1;
  
  IF pm_id IS NOT NULL THEN
    RETURN pm_id;
  END IF;
  
  -- Try matching "Name (Institution)" format
  SELECT id INTO pm_id
  FROM payment_methods
  WHERE user_id = txn_user_id 
    AND CONCAT(name, ' (', institution, ')') = pm_string
  LIMIT 1;
  
  IF pm_id IS NOT NULL THEN
    RETURN pm_id;
  END IF;
  
  -- Try matching just by name if institution in string
  SELECT id INTO pm_id
  FROM payment_methods pm
  WHERE user_id = txn_user_id 
    AND pm_string LIKE name || '%'
  ORDER BY LENGTH(name) DESC
  LIMIT 1;
  
  RETURN pm_id;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Migrate existing data
-- Get user_id from budget_years table for each transaction
UPDATE transactions t
SET payment_method_id = find_payment_method_id(
  t.payment_method,
  (SELECT b.user_id FROM budget_years by 
   JOIN budgets b ON by.budget_id = b.id 
   WHERE by.id = t.year_id)
)
WHERE t.payment_method IS NOT NULL;

-- Step 4: Drop the temporary function
DROP FUNCTION find_payment_method_id(text, uuid);

-- Step 5: Make payment_method_id NOT NULL (transactions must have a payment method)
ALTER TABLE "transactions" ALTER COLUMN "payment_method_id" SET NOT NULL;

-- Step 6: Add foreign key constraint
ALTER TABLE "transactions" 
ADD CONSTRAINT "transactions_payment_method_id_fkey" 
FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Step 7: Create index for performance
CREATE INDEX IF NOT EXISTS "transactions_payment_method_id_idx" ON "transactions"("payment_method_id");

-- Step 8: Keep old payment_method column for now (will be removed in future migration)
-- Mark it as deprecated by making it nullable
ALTER TABLE "transactions" ALTER COLUMN "payment_method" DROP NOT NULL;

-- Note: The old payment_method column is kept for backwards compatibility
-- but should no longer be used. It will be removed in a future migration.
