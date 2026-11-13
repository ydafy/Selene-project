CREATE OR REPLACE FUNCTION public.fn_upsert_checkout_recovery_shell (
  p_stripe_payment_intent_id text,
  p_reason                   text,
  p_source_metadata          jsonb,
  p_charged_amount_cents     bigint,
  p_stripe_charge_id         text   DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_order_id UUID;
  v_refunded_order_id UUID;
  v_order_refund_id TEXT;
  v_shell_payment_intent_id TEXT;
BEGIN
  UPDATE public.orders
  SET payment_processing = true,
      payment_processing_reason = p_reason,
      compensation_state = COALESCE(compensation_state, 'refund_pending'),
      next_compensation_retry_at = COALESCE(next_compensation_retry_at, now() + interval '5 minutes'),
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded'
  RETURNING id INTO v_order_id;

  IF v_order_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', v_order_id,
      'target', 'order',
      'runtime_version', 'paid_checkout_recovery_v1'
    );
  END IF;

  SELECT id, stripe_refund_id
  INTO v_refunded_order_id, v_order_refund_id
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status = 'refunded'
  FOR UPDATE;

  IF v_refunded_order_id IS NOT NULL THEN
    UPDATE internal.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = COALESCE(stripe_refund_id, v_order_refund_id),
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    RETURN jsonb_build_object(
      'status', 'duplicate',
      'order_id', v_refunded_order_id,
      'runtime_version', 'paid_checkout_recovery_v1'
    );
  END IF;

  INSERT INTO internal.checkout_recovery_shells (
    stripe_payment_intent_id,
    reason,
    source_metadata,
    charged_amount_cents,
    stripe_charge_id,
    next_compensation_retry_at
  ) VALUES (
    p_stripe_payment_intent_id,
    p_reason,
    COALESCE(p_source_metadata, '{}'::JSONB),
    p_charged_amount_cents,
    p_stripe_charge_id,
    now()
  )
  ON CONFLICT (stripe_payment_intent_id) DO UPDATE
  SET reason = EXCLUDED.reason,
      source_metadata = EXCLUDED.source_metadata,
      charged_amount_cents = COALESCE(
        internal.checkout_recovery_shells.charged_amount_cents,
        EXCLUDED.charged_amount_cents
      ),
      -- Charge evidence is immutable once observed; retries cannot replace it.
      stripe_charge_id = COALESCE(internal.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id),
      updated_at = now()
  WHERE internal.checkout_recovery_shells.compensation_state <> 'refunded'
  RETURNING stripe_payment_intent_id INTO v_shell_payment_intent_id;

  IF v_shell_payment_intent_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate', 'runtime_version', 'paid_checkout_recovery_v1');
  END IF;

  RETURN jsonb_build_object(
    'stripe_payment_intent_id', v_shell_payment_intent_id,
    'target', 'standalone_recovery_shell',
    'runtime_version', 'paid_checkout_recovery_v1'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_upsert_checkout_recovery_shell"(text, text, jsonb, bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_upsert_checkout_recovery_shell"(text, text, jsonb, bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_upsert_checkout_recovery_shell"(text, text, jsonb, bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_upsert_checkout_recovery_shell"(text, text, jsonb, bigint, text) FROM PUBLIC, "anon", "authenticated";
