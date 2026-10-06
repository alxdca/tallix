ALTER TABLE "transfers"
  ADD COLUMN IF NOT EXISTS "destination_accounting_month" integer,
  ADD COLUMN IF NOT EXISTS "destination_accounting_year" integer;
--> statement-breakpoint
UPDATE "transfers"
SET
  "destination_accounting_month" = "accounting_month",
  "destination_accounting_year" = "accounting_year"
WHERE "destination_accounting_month" IS NULL
  OR "destination_accounting_year" IS NULL;
