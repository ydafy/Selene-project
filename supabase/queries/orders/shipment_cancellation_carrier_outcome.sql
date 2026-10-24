-- B4.2: carrier cancellation outcome and label-cost loss on the cancellation operation,
-- plus the money guard that a preparing-timeout refund needs an accepted carrier cancellation.
-- Requires the B1.2 refund request and B2.2.1 escalation SQL first.
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN carrier_cancellation_outcome TEXT
    CHECK (carrier_cancellation_outcome IN ('accepted', 'refused', 'ambiguous')),
  ADD COLUMN carrier_cancellation_recorded_at TIMESTAMPTZ,
  ADD COLUMN carrier_balance_returned BOOLEAN,
  ADD COLUMN carrier_balance_returned_at TIMESTAMPTZ,
  ADD COLUMN label_cost_loss_cents BIGINT CHECK (label_cost_loss_cents >= 0),
  ADD CONSTRAINT shipment_cancellation_operations_carrier_outcome_recorded CHECK (
    (carrier_cancellation_outcome IS NULL) = (carrier_cancellation_recorded_at IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_carrier_balance_consistent CHECK (
    (
      carrier_cancellation_outcome IS DISTINCT FROM 'accepted'
      AND carrier_balance_returned IS NULL
      AND carrier_balance_returned_at IS NULL
      AND label_cost_loss_cents IS NULL
    )
    OR (carrier_cancellation_outcome = 'accepted' AND carrier_balance_returned IS NOT NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_carrier_balance_date CHECK (
    carrier_balance_returned_at IS NULL OR carrier_balance_returned IS TRUE
  ),
  ADD CONSTRAINT shipment_cancellation_operations_carrier_balance_no_loss CHECK (
    carrier_balance_returned IS NOT TRUE OR label_cost_loss_cents = 0
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.carrier_cancellation_outcome IS
  'What the carrier answered to the label cancellation: accepted, refused or ambiguous. NULL means no carrier cancellation was recorded. Set once by fn_record_shipment_carrier_cancellation; only accepted lets a preparing-timeout refund start.';
COMMENT ON COLUMN public.shipment_cancellation_operations.carrier_cancellation_recorded_at IS
  'When the carrier outcome was recorded. NULL together with carrier_cancellation_outcome.';
COMMENT ON COLUMN public.shipment_cancellation_operations.carrier_balance_returned IS
  'Whether the carrier returned the label cost (Envia balanceReturned). Only set with an accepted outcome; label cancellation and label money returned are separate facts.';
COMMENT ON COLUMN public.shipment_cancellation_operations.carrier_balance_returned_at IS
  'When the carrier returned the label cost (Envia balanceReturnDate). Only with carrier_balance_returned true; may stay NULL if the carrier gave no date.';
COMMENT ON COLUMN public.shipment_cancellation_operations.label_cost_loss_cents IS
  'Label cost Selene lost on this cancellation, in cents, computed by SQL: 0 when the balance was returned, shipments.label_provider_cost_cents when it was not. NULL means unknown or label not cancelled, not zero. Separate from cancellation_loss_cents (Stripe fee loss) and from the buyer refund.';

-- Records the carrier answer once. Replaying the same values returns the stored row
-- with changed = false; different values raise CARRIER_CANCELLATION_ALREADY_RECORDED.
-- The label loss is never an input: it is derived here from the shipment's provider cost.
CREATE OR REPLACE FUNCTION public.fn_record_shipment_carrier_cancellation(
  p_shipment_id UUID,
  p_claim_token UUID,
  p_outcome TEXT,
  p_balance_returned BOOLEAN DEFAULT NULL,
  p_balance_returned_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_loss BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'refused', 'ambiguous')
     OR (p_outcome = 'accepted' AND p_balance_returned IS NULL)
     OR (p_outcome <> 'accepted' AND (p_balance_returned IS NOT NULL OR p_balance_returned_at IS NOT NULL))
     OR (p_balance_returned IS NOT TRUE AND p_balance_returned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CARRIER_CANCELLATION_OUTCOME';
  END IF;

  -- Same lock order as the other cancellation RPCs: shipment first, then the operation.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.source IS DISTINCT FROM 'preparing_timeout' THEN
    RAISE EXCEPTION 'INVALID_CARRIER_CANCELLATION_SOURCE';
  END IF;

  IF v_operation.carrier_cancellation_outcome IS NOT NULL THEN
    IF v_operation.carrier_cancellation_outcome = p_outcome
       AND v_operation.carrier_balance_returned IS NOT DISTINCT FROM p_balance_returned
       AND v_operation.carrier_balance_returned_at IS NOT DISTINCT FROM p_balance_returned_at THEN
      RETURN jsonb_build_object(
        'carrier_cancellation_outcome', v_operation.carrier_cancellation_outcome,
        'carrier_cancellation_recorded_at', v_operation.carrier_cancellation_recorded_at,
        'carrier_balance_returned', v_operation.carrier_balance_returned,
        'carrier_balance_returned_at', v_operation.carrier_balance_returned_at,
        'label_cost_loss_cents', v_operation.label_cost_loss_cents,
        'changed', FALSE);
    END IF;
    RAISE EXCEPTION 'CARRIER_CANCELLATION_ALREADY_RECORDED';
  END IF;

  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_shipment.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE'; END IF;

  v_loss := CASE
    WHEN p_outcome <> 'accepted' THEN NULL
    WHEN p_balance_returned THEN 0
    ELSE v_shipment.label_provider_cost_cents
  END;

  UPDATE public.shipment_cancellation_operations
    SET carrier_cancellation_outcome = p_outcome,
        carrier_cancellation_recorded_at = clock_timestamp(),
        carrier_balance_returned = p_balance_returned,
        carrier_balance_returned_at = p_balance_returned_at,
        label_cost_loss_cents = v_loss
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;

  RETURN jsonb_build_object(
    'carrier_cancellation_outcome', v_operation.carrier_cancellation_outcome,
    'carrier_cancellation_recorded_at', v_operation.carrier_cancellation_recorded_at,
    'carrier_balance_returned', v_operation.carrier_balance_returned,
    'carrier_balance_returned_at', v_operation.carrier_balance_returned_at,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents,
    'changed', TRUE);
END;
$$;

-- Grant review: service-only. The outcome gates a Stripe refund, so clients must never write it.
REVOKE EXECUTE ON FUNCTION public.fn_record_shipment_carrier_cancellation(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_shipment_carrier_cancellation(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

-- Same body as the deployed function plus one guard: a preparing-timeout refund cannot start
-- unless the carrier accepted the label cancellation. The raise rolls back the start fence.
CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation_refund(
  p_shipment_id UUID,
  p_claim_token UUID,
  p_refund_request JSONB,
  p_cancellation_loss_cents BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_payment_intent_id TEXT;
  v_metadata JSONB;
  v_amount NUMERIC;
  v_share NUMERIC;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- The definer can call the private original entry point. Any later rejection
  -- rolls this mark back, including malformed payloads or failed persistence.
  PERFORM public.fn_start_shipment_cancellation(p_shipment_id, p_claim_token);
  SELECT * INTO STRICT v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF v_operation.source = 'preparing_timeout'
     AND v_operation.carrier_cancellation_outcome IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'CARRIER_CANCELLATION_NOT_CONFIRMED';
  END IF;
  SELECT COALESCE(s.stripe_payment_intent_id, o.stripe_payment_intent_id)
    INTO v_payment_intent_id
    FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = p_shipment_id;

  IF jsonb_typeof(p_refund_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_refund_request)) <> 4
     OR jsonb_typeof(p_refund_request->'payment_intent') IS DISTINCT FROM 'string'
     OR v_payment_intent_id IS NULL OR btrim(v_payment_intent_id) = ''
     OR p_refund_request->>'payment_intent' IS DISTINCT FROM v_payment_intent_id
     OR p_refund_request->>'reason' IS DISTINCT FROM 'requested_by_customer'
     OR jsonb_typeof(p_refund_request->'amount') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_refund_request->'metadata') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_amount := (p_refund_request->>'amount')::numeric;
  IF v_amount <= 0 OR v_amount > 9007199254740991 OR trunc(v_amount) <> v_amount THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;

  v_metadata := p_refund_request->'metadata';
  IF (SELECT count(*) FROM jsonb_object_keys(v_metadata)) <> 5
     OR v_metadata->>'shipment_id' IS DISTINCT FROM p_shipment_id::text
     OR v_metadata->>'order_id' IS DISTINCT FROM v_operation.order_id::text
     OR v_metadata->>'caller_role' IS DISTINCT FROM
       (CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END)
     OR jsonb_typeof(v_metadata->'reason') IS DISTINCT FROM 'string'
     OR v_metadata->>'reason' IS DISTINCT FROM v_operation.reason
     OR jsonb_typeof(v_metadata->'seguro_share_cents') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_share := (v_metadata->>'seguro_share_cents')::numeric;
  IF v_share < 0 OR v_share > v_amount OR trunc(v_share) <> v_share THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF p_cancellation_loss_cents < 0 OR p_cancellation_loss_cents > 9007199254740991 THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_LOSS';
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_request = p_refund_request, cancellation_loss_cents = p_cancellation_loss_cents
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;
  RETURN jsonb_build_object('operation_key', v_operation.operation_key,
    'refund_request', v_operation.refund_request,
    'cancellation_loss_cents', v_operation.cancellation_loss_cents);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_start_shipment_cancellation_refund(UUID, UUID, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_start_shipment_cancellation_refund(UUID, UUID, JSONB, BIGINT) TO service_role;

-- The private start must stay unreachable or the carrier guard above could be skipped.
-- The remote project already has this revoke (B1.2); the local baseline dump lost it.
REVOKE EXECUTE ON FUNCTION public.fn_start_shipment_cancellation(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
