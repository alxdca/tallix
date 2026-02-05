CREATE TABLE IF NOT EXISTS "account_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"year_id" integer NOT NULL,
	"account_type" varchar(20) NOT NULL,
	"account_id" integer NOT NULL,
	"initial_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"year_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"type" varchar(20) DEFAULT 'expense' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"year_id" integer NOT NULL,
	"group_id" integer,
	"name" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"initial_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_years_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monthly_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"month" integer NOT NULL,
	"budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_account" boolean DEFAULT false NOT NULL,
	"settlement_day" integer,
	"linked_payment_method_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"year_id" integer NOT NULL,
	"item_id" integer,
	"date" date NOT NULL,
	"description" varchar(500),
	"comment" varchar(500),
	"third_party" varchar(200),
	"payment_method" varchar(100),
	"amount" numeric(12, 2) NOT NULL,
	"accounting_month" integer NOT NULL,
	"accounting_year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"year_id" integer NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" varchar(500),
	"source_account_type" varchar(20) NOT NULL,
	"source_account_id" integer NOT NULL,
	"destination_account_type" varchar(20) NOT NULL,
	"destination_account_id" integer NOT NULL,
	"savings_item_id" integer,
	"accounting_month" integer NOT NULL,
	"accounting_year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_year_id_budget_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "budget_years"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_groups" ADD CONSTRAINT "budget_groups_year_id_budget_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "budget_years"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_year_id_budget_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "budget_years"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_group_id_budget_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "budget_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monthly_values" ADD CONSTRAINT "monthly_values_item_id_budget_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "budget_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_year_id_budget_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "budget_years"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_item_id_budget_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "budget_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfers" ADD CONSTRAINT "transfers_year_id_budget_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "budget_years"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfers" ADD CONSTRAINT "transfers_savings_item_id_budget_items_id_fk" FOREIGN KEY ("savings_item_id") REFERENCES "budget_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
