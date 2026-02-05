-- Add savingsAccountId to budget_items to link savings accounts to their budget items
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS savings_account_id INTEGER REFERENCES payment_methods(id) ON DELETE CASCADE;

-- Create index for efficient lookup
CREATE INDEX IF NOT EXISTS budget_items_savings_account_id_idx ON budget_items(savings_account_id) WHERE savings_account_id IS NOT NULL;
