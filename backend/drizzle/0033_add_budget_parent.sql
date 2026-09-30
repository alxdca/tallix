ALTER TABLE "budgets"
  ADD COLUMN IF NOT EXISTS "parent_budget_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budgets" ADD CONSTRAINT "budgets_parent_budget_id_budgets_id_fk" FOREIGN KEY ("parent_budget_id") REFERENCES "budgets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
