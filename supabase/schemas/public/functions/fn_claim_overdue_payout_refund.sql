CREATE OR REPLACE FUNCTION public.fn_claim_overdue_payout_refund (
  p_admin_id    uuid,
  p_shipment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_reason CONSTANT TEXT := 'overdue_payout_seller_rejected';
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_held RECORD;
  v_onboarding_status TEXT;
  v_payment_intent_id TEXT;
  v_context JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- Shipment first: the lock order of the cancellation, transfer and hold note paths.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  -- Defense in depth: the admin id is written to the operation and the audit
  -- log, so it must be an active admin by the same rule as is_admin().
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT COALESCE(s.stripe_payment_intent_id, o.stripe_payment_intent_id)
    INTO v_payment_intent_id
    FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = p_shipment_id;
  v_context := jsonb_build_object('shipment_id', p_shipment_id, 'order_id', v_shipment.order_id,
    'payment_intent_id', v_payment_intent_id);

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND AND v_operation.source = 'admin_overdue_payout' THEN
    IF v_shipment.status = 'refunded' THEN RAISE EXCEPTION 'SHIPMENT_ALREADY_REFUNDED'; END IF;
    -- A started refund may already exist at Stripe: recovery never depends on
    -- the eligibility checks below, which only guard a new external call.
    IF v_operation.external_started_at IS NOT NULL THEN
      RETURN v_context || jsonb_build_object('status', 'recovery_required',
        'operation_key', v_operation.operation_key, 'source', v_operation.source,
        'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
    END IF;
  END IF;
  IF v_shipment.status IS DISTINCT FROM 'completed' OR v_shipment.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_COMPLETED';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  -- transfer_started_at is never cleared: a transfer that was ever started,
  -- whatever its run became, rules the refund out.
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  SELECT v.is_payout_overdue, v.seller_payout_block_reason, v.days_since_completed
    INTO v_held
    FROM public.admin_connect_payout_release_view v
    WHERE v.shipment_id = p_shipment_id;
  IF v_held.is_payout_overdue IS NOT TRUE THEN RAISE EXCEPTION 'PAYOUT_NOT_OVERDUE'; END IF;

  -- The stored status is broader than Stripe's rejected.* reasons; the Edge
  -- Function also confirms requirements.disabled_reason live before it claims.
  SELECT stripe_onboarding_status::text INTO v_onboarding_status
    FROM public.profiles_private WHERE id = v_shipment.seller_id;
  IF v_onboarding_status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'SELLER_ACCOUNT_NOT_REJECTED';
  END IF;

  -- A run the executor has not parked may still be working on the shipment.
  -- A parked run moves no money; the operation below fences any later transfer.
  IF EXISTS (
    SELECT 1 FROM public.connect_payout_run_shipments m
    JOIN public.connect_payout_runs r ON r.id = m.run_id
    WHERE m.shipment_id = p_shipment_id
      AND m.status IN ('pending_reconciliation', 'reconciliation_needed')
      AND (r.release_stage IS DISTINCT FROM 'action_required' OR r.stripe_payout_id IS NOT NULL
        OR r.payout_claim_token IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_PARKED';
  END IF;

  IF v_operation.shipment_id IS NOT NULL THEN
    IF v_operation.source = 'admin_overdue_payout' THEN
      IF v_operation.claim_expires_at > clock_timestamp() THEN
        RETURN v_context || jsonb_build_object('status', 'busy',
          'operation_key', v_operation.operation_key, 'source', v_operation.source,
          'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
      END IF;
    -- Another source's operation is active while it holds a lease or ever
    -- started (the fence fn_begin_shipment_transfer reads). One that carries a
    -- carrier outcome or a review belongs to that flow and is never re-owned.
    ELSIF v_operation.external_started_at IS NOT NULL OR v_operation.claim_expires_at > clock_timestamp()
       OR v_operation.carrier_cancellation_outcome IS NOT NULL OR v_operation.review_required_at IS NOT NULL THEN
      RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
    END IF;
    -- An expired claim that never started authorized no external call: the
    -- admin re-owns it with a new token, so a stale worker cannot start.
    UPDATE public.shipment_cancellation_operations
      SET source = 'admin_overdue_payout', actor_id = p_admin_id, reason = v_reason,
          claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  ELSE
    INSERT INTO public.shipment_cancellation_operations
      (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
      VALUES (p_shipment_id, v_shipment.order_id, 'admin_overdue_payout', p_admin_id, v_reason,
        gen_random_uuid(), clock_timestamp() + interval '15 minutes')
      RETURNING * INTO v_operation;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'OVERDUE_PAYOUT_REFUND_CLAIMED', p_shipment_id,
    jsonb_build_object(
      'operation_key', v_operation.operation_key,
      'order_id', v_shipment.order_id,
      'payment_intent_id', v_payment_intent_id,
      'seller_payout_block_reason', v_held.seller_payout_block_reason,
      'days_since_completed', v_held.days_since_completed));

  RETURN v_context || jsonb_build_object('status', 'claimed', 'operation_key', v_operation.operation_key,
    'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason,
    'claim_token', v_operation.claim_token, 'claim_expires_at', v_operation.claim_expires_at);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) IS 'Service-only (SECURITY DEFINER; EXECUTE revoked from PUBLIC, anon and authenticated because the admin id is trusted only from an Edge Function that verified the admin session, and the function writes the cancellation operation clients cannot touch): an active admin claims the refund of an overdue held payout (#549). Locks the shipment, requires it completed, never released or transferred, overdue, its seller rejected and any run holding it parked, then claims the shipment''s cancellation operation with source admin_overdue_payout (the fence fn_begin_shipment_transfer checks) and audits the claim. Returns claimed, busy or recovery_required like fn_claim_shipment_cancellation, plus the shipment, order and payment intent ids.';

REVOKE ALL ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_overdue_payout_refund"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";
