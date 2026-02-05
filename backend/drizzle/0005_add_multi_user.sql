-- Create users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL UNIQUE,
  "password_hash" varchar(255) NOT NULL,
  "name" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create a default user for existing data migration
-- Password is 'changeme' hashed with bcrypt (cost 10)
INSERT INTO "users" ("id", "email", "password_hash", "name")
VALUES ('00000000-0000-0000-0000-000000000001', 'default@tallix.local', '$2b$10$defaulthashplacaborchangethis000000000000000000000000', 'Default User')
ON CONFLICT DO NOTHING;

-- Create budgets table (main container for multi-year accounting)
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "description" varchar(500),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create a default budget for existing data
INSERT INTO "budgets" ("id", "user_id", "name", "description")
VALUES (1, '00000000-0000-0000-0000-000000000001', 'Mon Budget', 'Budget par défaut')
ON CONFLICT DO NOTHING;

-- Create budget_shares table for sharing budgets with other users
CREATE TABLE IF NOT EXISTS "budget_shares" (
  "id" serial PRIMARY KEY NOT NULL,
  "budget_id" integer NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "budget_shares_budget_user_unique" ON "budget_shares" ("budget_id", "user_id");

-- Migrate budget_years: add budget_id, remove user_id constraint
ALTER TABLE "budget_years" ADD COLUMN IF NOT EXISTS "budget_id" integer;
UPDATE "budget_years" SET "budget_id" = 1 WHERE "budget_id" IS NULL;
ALTER TABLE "budget_years" ALTER COLUMN "budget_id" SET NOT NULL;
ALTER TABLE "budget_years" ADD CONSTRAINT "budget_years_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Drop old constraints and add new one on (budget_id, year)
ALTER TABLE "budget_years" DROP CONSTRAINT IF EXISTS "budget_years_year_unique";
DROP INDEX IF EXISTS "budget_years_user_year_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "budget_years_budget_year_unique" ON "budget_years" ("budget_id", "year");

-- Remove user_id from budget_years if it exists (it's now on budgets table)
ALTER TABLE "budget_years" DROP COLUMN IF EXISTS "user_id";

-- Migrate budget_groups: change from user_id to budget_id
ALTER TABLE "budget_groups" ADD COLUMN IF NOT EXISTS "budget_id" integer;
UPDATE "budget_groups" SET "budget_id" = 1 WHERE "budget_id" IS NULL;
ALTER TABLE "budget_groups" ALTER COLUMN "budget_id" SET NOT NULL;
ALTER TABLE "budget_groups" ADD CONSTRAINT "budget_groups_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Drop old constraints and add new one on (budget_id, slug)
DROP INDEX IF EXISTS "budget_groups_year_slug_unique";
DROP INDEX IF EXISTS "budget_groups_user_slug_unique";
ALTER TABLE "budget_groups" DROP COLUMN IF EXISTS "year_id";
ALTER TABLE "budget_groups" DROP COLUMN IF EXISTS "user_id";
CREATE UNIQUE INDEX IF NOT EXISTS "budget_groups_budget_slug_unique" ON "budget_groups" ("budget_id", "slug");

-- Add user_id to payment_methods (payment methods are per-user, usable across all their budgets)
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "user_id" uuid;
UPDATE "payment_methods" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
ALTER TABLE "payment_methods" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Add user_id to settings (settings are per-user)
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "user_id" uuid;
UPDATE "settings" SET "user_id" = '00000000-0000-0000-0000-000000000001' WHERE "user_id" IS NULL;
ALTER TABLE "settings" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Drop old unique constraint on key and add new one on (user_id, key)
ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_key_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "settings_user_key_unique" ON "settings" ("user_id", "key");

-- Reset sequence for budgets table to continue after our manual insert
SELECT setval('budgets_id_seq', (SELECT MAX(id) FROM budgets));
