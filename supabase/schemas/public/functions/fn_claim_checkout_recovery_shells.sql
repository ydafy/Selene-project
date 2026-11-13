CREATE OR REPLACE FUNCTION public.fn_claim_checkout_recovery_shells (
  p_limit                    integer DEFAULT 25,
  p_stripe_payment_intent_id text    DEFAULT NULL::text,
  p_claim_scope              text    DEFAULT NULL::text
)
  RETURNS TABLE (
    stripe_payment_intent_id text,
    stripe_charge_id         text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  -- NULL preserves named-PaymentIntent order-first fallback behavior.
  IF p_claim_scope IS NOT NULL AND p_claim_scope NOT IN ('order', 'standalone') THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_RECOVERY_CLAIM_SCOPE';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.payment_processing = true
      AND o.stripe_payment_intent_id IS NOT NULL
      AND (p_claim_scope IS NULL OR p_claim_scope = 'order')
      AND (p_stripe_payment_intent_id IS NULL OR o.stripe_payment_intent_id = p_stripe_payment_intent_id)
      AND o.compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')
      AND (
        (
          o.compensation_state = 'refund_pending'
          AND (
            p_stripe_payment_intent_id IS NOT NULL
            OR o.next_compensation_retry_at <= now()
            OR (
              o.next_compensation_retry_at IS NULL
              AND o.created_at <= now() - interval '5 minutes'
            )
          )
        )
        OR (
          o.compensation_state = 'refund_failed_retry_queued'
          AND (o.next_compensation_retry_at IS NULL OR o.next_compensation_retry_at <= now())
        )
        OR (
          o.compensation_state = 'refunding'
          AND o.compensation_lease_expires_at <= now()
        )
      )
    ORDER BY o.created_at, o.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE public.orders o
  SET compensation_state = 'refunding',
      compensation_attempt_count = o.compensation_attempt_count + 1,
      compensation_lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM eligible
  WHERE o.id = eligible.id
  RETURNING o.stripe_payment_intent_id, o.stripe_charge_id;

  IF FOUND OR p_claim_scope = 'order' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT s.stripe_payment_intent_id
    FROM internal.checkout_recovery_shells s
    WHERE (p_claim_scope IS NULL OR p_claim_scope = 'standalone')
      AND (p_stripe_payment_intent_id IS NULL OR s.stripe_payment_intent_id = p_stripe_payment_intent_id)
      AND s.compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')
      AND (
        (
          s.compensation_state = 'refund_pending'
          AND (
            p_stripe_payment_intent_id IS NOT NULL
            OR s.next_compensation_retry_at <= now()
            OR (s.next_compensation_retry_at IS NULL AND s.created_at <= now() - interval '5 minutes')
          )
        )
        OR (
          s.compensation_state = 'refund_failed_retry_queued'
          AND (s.next_compensation_retry_at IS NULL OR s.next_compensation_retry_at <= now())
        )
        OR (
          s.compensation_state = 'refunding'
          AND s.compensation_lease_expires_at <= now()
        )
      )
    ORDER BY s.created_at, s.stripe_payment_intent_id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE internal.checkout_recovery_shells s
  SET compensation_state = 'refunding',
      compensation_attempt_count = s.compensation_attempt_count + 1,
      compensation_lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM eligible
  WHERE s.stripe_payment_intent_id = eligible.stripe_payment_intent_id
  RETURNING s.stripe_payment_intent_id, s.stripe_charge_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_checkout_recovery_shells"(integer, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_claim_checkout_recovery_shells"(integer, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_checkout_recovery_shells"(integer, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_checkout_recovery_shells"(integer, text, text) FROM PUBLIC, "anon", "authenticated";
