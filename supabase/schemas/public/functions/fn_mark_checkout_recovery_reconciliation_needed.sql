CREATE OR REPLACE FUNCTION public.fn_mark_checkout_recovery_reconciliation_needed (
  p_stripe_payment_intent_id text,
  p_error                    text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  UPDATE public.orders
  SET compensation_state = 'reconciliation_needed',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded';

  IF FOUND THEN
    RETURN;
  END IF;

  UPDATE public.checkout_recovery_shells
  SET compensation_state = 'reconciliation_needed',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"(text, text) FROM PUBLIC, "anon", "authenticated";
