-- Migration: add unique constraint for account_balances (year_id, account_type, account_id)
-- This prevents race conditions when setting account balances and enables upsert

CREATE UNIQUE INDEX IF NOT EXISTS "account_balances_year_account_unique" 
ON "account_balances" ("year_id", "account_type", "account_id");
