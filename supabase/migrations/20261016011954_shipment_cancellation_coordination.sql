-- B1.1 foundation only: no existing handler invokes these RPCs yet.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

CREATE TABLE public.shipment_cancellation_operations (
  shipment_id UUID PRIMARY KEY REFERENCES public.shipments(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  operation_key TEXT GENERATED ALWAYS AS ('cancel_shipment_' || shipment_id::text) STORED,
  source TEXT NOT NULL CHECK (source IN ('buyer', 'seller', 'paid_timeout', 'preparing_timeout')),
  actor_id UUID,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  claim_token UUID NOT NULL,
  claim_expires_at TIMESTAMPTZ NOT NULL,
  external_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source IN ('buyer', 'seller') AND actor_id IS NOT NULL)
      OR (source IN ('paid_timeout', 'preparing_timeout') AND actor_id IS NULL))
);

COMMENT ON TABLE public.shipment_cancellation_operations IS
  'One durable cancellation identity per shipment. Only claim/start RPCs write it. B2 will extend this same operation with refund identity/status/recovery; TTL never clears external_started_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.external_started_at IS
  'Write-ahead fence set before a possible external call. Not proof of Stripe success. Once set, no claim or repeated start authorizes another call, regardless of lease expiry.';

ALTER TABLE public.shipment_cancellation_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipment_cancellation_operations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_claim_shipment_cancellation(
  p_shipment_id UUID,
  p_order_id UUID,
  p_actor_id UUID,
  p_source TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_buyer_id UUID;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('buyer', 'seller', 'paid_timeout', 'preparing_timeout')
     OR p_reason IS NULL OR btrim(p_reason) = ''
     OR (p_source IN ('buyer', 'seller') AND p_actor_id IS NULL)
     OR (p_source IN ('paid_timeout', 'preparing_timeout') AND p_actor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_CONTEXT';
  END IF;

  -- Every future participating writer must lock this same shipment first.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  IF v_shipment.order_id IS DISTINCT FROM p_order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_shipment.order_id;
  IF p_source = 'buyer' AND p_actor_id IS DISTINCT FROM v_buyer_id THEN RAISE EXCEPTION 'ORDER_BUYER_MISMATCH'; END IF;
  IF p_source = 'seller' AND p_actor_id IS DISTINCT FROM v_shipment.seller_id THEN RAISE EXCEPTION 'SHIPMENT_SELLER_MISMATCH'; END IF;

  IF (p_source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (p_source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  -- Do not weaken the label system's orphan fence. A generated preparing label
  -- is not an in-flight generation; carrier cancellation policy remains B4.
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND THEN
    -- Later callers cannot change the winning source, actor, reason or key.
    v_result := jsonb_build_object('operation_key', v_operation.operation_key,
      'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
    IF v_operation.external_started_at IS NOT NULL THEN
      RETURN v_result || jsonb_build_object('status', 'recovery_required');
    END IF;
    IF v_operation.claim_expires_at > clock_timestamp() THEN
      RETURN v_result || jsonb_build_object('status', 'busy');
    END IF;
    -- A stale pre-call worker can no longer pass start after token rotation.
    UPDATE public.shipment_cancellation_operations
      SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  ELSE
    INSERT INTO public.shipment_cancellation_operations
      (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
      VALUES (p_shipment_id, p_order_id, p_source, p_actor_id, p_reason,
        gen_random_uuid(), clock_timestamp() + interval '15 minutes')
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object('status', 'claimed', 'operation_key', v_operation.operation_key,
    'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason,
    'claim_token', v_operation.claim_token, 'claim_expires_at', v_operation.claim_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation(
  p_shipment_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_operation.order_id IS DISTINCT FROM v_shipment.order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  IF (v_operation.source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (v_operation.source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;

  UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id AND claim_token = p_claim_token;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_claim_shipment_cancellation(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_start_shipment_cancellation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_shipment_cancellation(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_start_shipment_cancellation(UUID, UUID) TO service_role;

COMMIT;
