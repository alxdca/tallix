-- Migration: Add foreign key for linked payment method

UPDATE "payment_methods" pm
SET "linked_payment_method_id" = NULL
WHERE "linked_payment_method_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "payment_methods" parent
    WHERE parent.id = pm.linked_payment_method_id
  );

ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_linked_payment_method_id_fkey"
  FOREIGN KEY ("linked_payment_method_id")
  REFERENCES "payment_methods"("id")
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "payment_methods_linked_payment_method_id_idx"
  ON "payment_methods"("linked_payment_method_id");
