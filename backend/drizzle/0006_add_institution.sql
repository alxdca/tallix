-- Add institution field to payment_methods
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "institution" varchar(100);
