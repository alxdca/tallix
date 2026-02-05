-- Migration: add unique constraint for budget_groups (year_id, slug)
-- This prevents race conditions when creating unclassified groups

-- Add unique constraint on budget_groups for (year_id, slug)
CREATE UNIQUE INDEX IF NOT EXISTS "budget_groups_year_slug_unique" ON "budget_groups" ("year_id", "slug");

-- Add unique constraint on budget_items for (year_id, group_id, slug)
-- Note: group_id can be NULL, so we need a partial index for non-null values
CREATE UNIQUE INDEX IF NOT EXISTS "budget_items_year_group_slug_unique" 
ON "budget_items" ("year_id", "group_id", "slug") 
WHERE "group_id" IS NOT NULL;
