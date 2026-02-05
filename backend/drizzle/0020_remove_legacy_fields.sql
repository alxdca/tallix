-- Migration: Remove legacy fields no longer used by the app

ALTER TABLE "payment_methods" DROP COLUMN IF EXISTS "is_account";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "payment_method";
