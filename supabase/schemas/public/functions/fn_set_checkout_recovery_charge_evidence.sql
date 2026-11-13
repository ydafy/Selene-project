CREATE OR REPLACE FUNCTION public.fn_set_checkout_recovery_charge_evidence (
  p_stripe_payment_intent_id text,
  p_stripe_charge_id         text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_stripe_charge_id TEXT;
BEGIN
  IF NULLIF(p_stripe_charge_id, '') IS NULL THEN
    RAISE EXCEPTION 'STRIPE_CHARGE_ID_REQUIRED';
  END IF;

  UPDATE public.orders
  SET stripe_charge_id = COALESCE(stripe_charge_id, p_stripe_charge_id),
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded'
  RETURNING stripe_charge_id INTO v_stripe_charge_id;

  IF FOUND THEN
    RETURN v_stripe_charge_id;
  END IF;

  UPDATE internal.checkout_recovery_shells
  SET stripe_charge_id = COALESCE(stripe_charge_id, p_stripe_charge_id),
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded'
  RETURNING stripe_charge_id INTO v_stripe_charge_id;

  IF FOUND THEN
    RETURN v_stripe_charge_id;
  END IF;

  RAISE EXCEPTION 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"(text, text) FROM PUBLIC, "anon", "authenticated";
