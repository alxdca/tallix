-- Migration: add unique constraint for monthly_values (item_id, month)
-- This prevents race conditions when updating monthly values and enables upsert

CREATE UNIQUE INDEX IF NOT EXISTS "monthly_values_item_month_unique" 
ON "monthly_values" ("item_id", "month");
