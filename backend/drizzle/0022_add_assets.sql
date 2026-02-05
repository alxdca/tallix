-- Migration: Add assets and asset_values tables for net worth tracking

-- Create assets table
CREATE TABLE IF NOT EXISTS "assets" (
  "id" SERIAL PRIMARY KEY,
  "budget_id" INTEGER NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "parent_asset_id" INTEGER,
  "savings_type" VARCHAR(20),
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT "assets_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE,
  CONSTRAINT "assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "assets"("id") ON DELETE CASCADE
);

-- Create asset_values table
CREATE TABLE IF NOT EXISTS "asset_values" (
  "id" SERIAL PRIMARY KEY,
  "asset_id" INTEGER NOT NULL,
  "year_id" INTEGER NOT NULL,
  "value" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT "asset_values_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE,
  CONSTRAINT "asset_values_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "budget_years"("id") ON DELETE CASCADE
);

-- Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "assets_budget_name_unique" ON "assets"("budget_id", "name");
CREATE INDEX IF NOT EXISTS "assets_budget_id_idx" ON "assets"("budget_id");

CREATE UNIQUE INDEX IF NOT EXISTS "asset_values_asset_year_unique" ON "asset_values"("asset_id", "year_id");
CREATE INDEX IF NOT EXISTS "asset_values_asset_id_idx" ON "asset_values"("asset_id");
CREATE INDEX IF NOT EXISTS "asset_values_year_id_idx" ON "asset_values"("year_id");

-- Enable RLS on assets table
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;

-- RLS policies for assets: user can only access assets for their own budgets
CREATE POLICY "assets_select_policy" ON "assets"
  FOR SELECT
  USING (
    "budget_id" IN (
      SELECT id FROM budgets
      WHERE user_id = current_setting('app.user_id', true)::uuid
        OR id IN (
          SELECT budget_id FROM budget_shares
          WHERE user_id = current_setting('app.user_id', true)::uuid
        )
    )
  );

CREATE POLICY "assets_insert_policy" ON "assets"
  FOR INSERT
  WITH CHECK (
    "budget_id" = current_setting('app.budget_id', true)::integer
    AND "budget_id" IN (
      SELECT id FROM budgets
      WHERE user_id = current_setting('app.user_id', true)::uuid
    )
  );

CREATE POLICY "assets_update_policy" ON "assets"
  FOR UPDATE
  USING (
    "budget_id" = current_setting('app.budget_id', true)::integer
    AND "budget_id" IN (
      SELECT id FROM budgets
      WHERE user_id = current_setting('app.user_id', true)::uuid
        OR id IN (
          SELECT budget_id FROM budget_shares
          WHERE user_id = current_setting('app.user_id', true)::uuid
            AND role IN ('writer', 'admin')
        )
    )
  );

CREATE POLICY "assets_delete_policy" ON "assets"
  FOR DELETE
  USING (
    "budget_id" = current_setting('app.budget_id', true)::integer
    AND "budget_id" IN (
      SELECT id FROM budgets
      WHERE user_id = current_setting('app.user_id', true)::uuid
    )
  );

-- Enable RLS on asset_values table
ALTER TABLE "asset_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_values" FORCE ROW LEVEL SECURITY;

-- RLS policies for asset_values: user can only access values for assets they own
CREATE POLICY "asset_values_select_policy" ON "asset_values"
  FOR SELECT
  USING (
    "asset_id" IN (
      SELECT id FROM assets
      WHERE budget_id IN (
        SELECT id FROM budgets
        WHERE user_id = current_setting('app.user_id', true)::uuid
          OR id IN (
            SELECT budget_id FROM budget_shares
            WHERE user_id = current_setting('app.user_id', true)::uuid
          )
      )
    )
  );

CREATE POLICY "asset_values_insert_policy" ON "asset_values"
  FOR INSERT
  WITH CHECK (
    "asset_id" IN (
      SELECT id FROM assets
      WHERE budget_id = current_setting('app.budget_id', true)::integer
        AND budget_id IN (
          SELECT id FROM budgets
          WHERE user_id = current_setting('app.user_id', true)::uuid
        )
    )
  );

CREATE POLICY "asset_values_update_policy" ON "asset_values"
  FOR UPDATE
  USING (
    "asset_id" IN (
      SELECT id FROM assets
      WHERE budget_id = current_setting('app.budget_id', true)::integer
        AND budget_id IN (
          SELECT id FROM budgets
          WHERE user_id = current_setting('app.user_id', true)::uuid
            OR id IN (
              SELECT budget_id FROM budget_shares
              WHERE user_id = current_setting('app.user_id', true)::uuid
                AND role IN ('writer', 'admin')
            )
        )
    )
  );

CREATE POLICY "asset_values_delete_policy" ON "asset_values"
  FOR DELETE
  USING (
    "asset_id" IN (
      SELECT id FROM assets
      WHERE budget_id = current_setting('app.budget_id', true)::integer
        AND budget_id IN (
          SELECT id FROM budgets
          WHERE user_id = current_setting('app.user_id', true)::uuid
        )
    )
  );
