-- Add is_debt flag to assets
ALTER TABLE assets ADD COLUMN is_debt BOOLEAN NOT NULL DEFAULT false;
