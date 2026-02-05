-- Add yearly_budget column to budget_items for irregular/variable spending
ALTER TABLE "budget_items" ADD COLUMN "yearly_budget" numeric(12, 2) NOT NULL DEFAULT '0';
