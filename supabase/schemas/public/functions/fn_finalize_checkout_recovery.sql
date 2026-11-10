CREATE OR REPLACE FUNCTION public.fn_finalize_checkout_recovery (
  p_stripe_payment_intent_id text,
  p_stripe_refund_id         text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_order_id UUID;
BEGIN
  IF NULLIF(p_stripe_refund_id, '') IS NULL THEN
    RAISE EXCEPTION 'STRIPE_REFUND_ID_REQUIRED';
  END IF;

  -- Lock the order first, then its reserved products by UUID. The caller may
  -- invoke this only after Stripe has confirmed the refund identifier.
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    UPDATE public.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = p_stripe_refund_id,
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    IF FOUND THEN
      RETURN jsonb_build_object('status', 'refunded', 'stripe_payment_intent_id', p_stripe_payment_intent_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.checkout_recovery_shells
      WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
        AND compensation_state = 'refunded'
    ) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'stripe_payment_intent_id', p_stripe_payment_intent_id);
    END IF;

    RAISE EXCEPTION 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = v_order_id
      AND compensation_state = 'refunded'
  ) THEN
    UPDATE public.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    RETURN jsonb_build_object('status', 'duplicate', 'order_id', v_order_id);
  END IF;

  PERFORM p.id
  FROM public.products p
  JOIN public.order_items oi ON oi.product_id = p.id
  WHERE oi.order_id = v_order_id
    AND p.status = 'RESERVED'
  ORDER BY p.id
  FOR UPDATE;

  PERFORM public.fn_release_listings(
    ARRAY(SELECT oi.product_id FROM public.order_items oi WHERE oi.order_id = v_order_id),
    true,
    false
  );

  UPDATE public.orders
  SET status = 'refunded',
      payment_processing = false,
      payment_processing_reason = NULL,
      compensation_state = 'refunded',
      stripe_refund_id = p_stripe_refund_id,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE id = v_order_id;

  RETURN jsonb_build_object('status', 'refunded', 'order_id', v_order_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_finalize_checkout_recovery"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_finalize_checkout_recovery"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_finalize_checkout_recovery"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_finalize_checkout_recovery"(text, text) FROM PUBLIC, "anon", "authenticated";
