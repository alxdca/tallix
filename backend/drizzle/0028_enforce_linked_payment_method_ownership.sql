-- Migration 0028: Enforce linked payment method ownership in RLS policy
--
-- Goal:
-- - Prevent cross-tenant self-references on payment_methods.linked_payment_method_id.
-- - Ensure a payment method can only link to another payment method owned by the same user.

UPDATE payment_methods child
SET linked_payment_method_id = NULL
FROM payment_methods parent
WHERE child.linked_payment_method_id = parent.id
  AND child.user_id <> parent.user_id;

CREATE OR REPLACE FUNCTION is_owned_linked_payment_method(
  p_user_id uuid,
  p_linked_payment_method_id integer
) RETURNS boolean AS $$
BEGIN
  IF p_linked_payment_method_id IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM payment_methods pm
    WHERE pm.id = p_linked_payment_method_id
      AND pm.user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS payment_methods_isolation ON payment_methods;

CREATE POLICY payment_methods_isolation ON payment_methods
  FOR ALL
  USING (
    user_id = get_current_user_id()
    AND is_owned_linked_payment_method(user_id, linked_payment_method_id)
  )
  WITH CHECK (
    user_id = get_current_user_id()
    AND is_owned_linked_payment_method(user_id, linked_payment_method_id)
  );
