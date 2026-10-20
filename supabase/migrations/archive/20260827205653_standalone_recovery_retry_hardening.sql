BEGIN;

ALTER TABLE public.checkout_recovery_shells
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;

DROP FUNCTION IF EXISTS public.fn_upsert_checkout_recovery_shell(TEXT, TEXT, JSONB, BIGINT);
DROP FUNCTION IF EXISTS public.fn_claim_checkout_recovery_shells(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.fn_upsert_checkout_recovery_shell(
  p_stripe_payment_intent_id TEXT,
  p_reason TEXT,
  p_source_metadata JSONB,
  p_charged_amount_cents BIGINT,
  p_stripe_charge_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    RETURN jsonb_build_object('order_id', v_order_id, 'target', 'order', 'runtime_version', 'paid_checkout_recovery_v1');
  END IF;

  SELECT id, stripe_refund_id
  INTO v_refunded_order_id, v_order_refund_id
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status = 'refunded'
  FOR UPDATE;

  IF v_refunded_order_id IS NOT NULL THEN
    UPDATE public.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = COALESCE(stripe_refund_id, v_order_refund_id),
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    RETURN jsonb_build_object('status', 'duplicate', 'order_id', v_refunded_order_id, 'runtime_version', 'paid_checkout_recovery_v1');
  END IF;

  INSERT INTO public.checkout_recovery_shells (
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
      charged_amount_cents = COALESCE(public.checkout_recovery_shells.charged_amount_cents, EXCLUDED.charged_amount_cents),
      -- First-known charge evidence is immutable across recovery retries.
      stripe_charge_id = COALESCE(public.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id),
      updated_at = now()
  WHERE public.checkout_recovery_shells.compensation_state <> 'refunded'
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
$$;

CREATE FUNCTION public.fn_set_checkout_recovery_charge_evidence(
  p_stripe_payment_intent_id TEXT,
  p_stripe_charge_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.checkout_recovery_shells
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
$$;

CREATE FUNCTION public.fn_mark_checkout_recovery_reconciliation_needed(
  p_stripe_payment_intent_id TEXT,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE FUNCTION public.fn_claim_checkout_recovery_shells(
  p_limit INTEGER DEFAULT 25,
  p_stripe_payment_intent_id TEXT DEFAULT NULL,
  p_claim_scope TEXT DEFAULT NULL
)
RETURNS TABLE(stripe_payment_intent_id TEXT, stripe_charge_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        (o.compensation_state = 'refund_pending' AND (
          p_stripe_payment_intent_id IS NOT NULL
          OR o.next_compensation_retry_at <= now()
          OR (o.next_compensation_retry_at IS NULL AND o.created_at <= now() - interval '5 minutes')
        ))
        OR (o.compensation_state = 'refund_failed_retry_queued' AND (o.next_compensation_retry_at IS NULL OR o.next_compensation_retry_at <= now()))
        OR (o.compensation_state = 'refunding' AND o.compensation_lease_expires_at <= now())
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
    FROM public.checkout_recovery_shells s
    WHERE (p_claim_scope IS NULL OR p_claim_scope = 'standalone')
      AND (p_stripe_payment_intent_id IS NULL OR s.stripe_payment_intent_id = p_stripe_payment_intent_id)
      AND s.compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')
      AND (
        (s.compensation_state = 'refund_pending' AND (
          p_stripe_payment_intent_id IS NOT NULL
          OR s.next_compensation_retry_at <= now()
          OR (s.next_compensation_retry_at IS NULL AND s.created_at <= now() - interval '5 minutes')
        ))
        OR (s.compensation_state = 'refund_failed_retry_queued' AND (s.next_compensation_retry_at IS NULL OR s.next_compensation_retry_at <= now()))
        OR (s.compensation_state = 'refunding' AND s.compensation_lease_expires_at <= now())
      )
    ORDER BY s.created_at, s.stripe_payment_intent_id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE public.checkout_recovery_shells s
  SET compensation_state = 'refunding',
      compensation_attempt_count = s.compensation_attempt_count + 1,
      compensation_lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM eligible
  WHERE s.stripe_payment_intent_id = eligible.stripe_payment_intent_id
  RETURNING s.stripe_payment_intent_id, s.stripe_charge_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_upsert_checkout_recovery_shell(TEXT, TEXT, JSONB, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_claim_checkout_recovery_shells(INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_checkout_recovery_charge_evidence(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_mark_checkout_recovery_reconciliation_needed(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_upsert_checkout_recovery_shell(TEXT, TEXT, JSONB, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_checkout_recovery_shells(INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_checkout_recovery_charge_evidence(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_checkout_recovery_reconciliation_needed(TEXT, TEXT) TO service_role;

-- Maintainer rollout: apply this migration, run `bun db:types`, then deploy
-- `stripe-webhooks` and `checkout-recovery-worker`. No agent remote actions.
COMMIT;
