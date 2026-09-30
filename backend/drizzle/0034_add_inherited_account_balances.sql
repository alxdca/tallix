ALTER TABLE "account_balances"
  ADD COLUMN IF NOT EXISTS "inherited_from_parent" boolean NOT NULL DEFAULT false;
