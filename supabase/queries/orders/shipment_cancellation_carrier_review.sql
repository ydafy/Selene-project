-- B4.4a: carrier review of a preparing-timeout cancellation. When the carrier refuses or gives no
-- usable answer, the operation is marked for admin review instead of refunding; an admin then
-- approves the refund (the next cron run executes it) or closes it with no refund.
-- Requires the B4.2 carrier outcome SQL first (shipment_cancellation_carrier_outcome.sql).
-- Apply the matching migration OR this identical canonical copy, not both.
BEGIN;

ALTER TABLE public.shipment_cancellation_operations
  ADD COLUMN review_reason TEXT
    CHECK (review_reason IN ('tracking_unknown', 'carrier_refused', 'carrier_ambiguous')),
  ADD COLUMN review_required_at TIMESTAMPTZ,
  ADD COLUMN review_resolution TEXT
    CHECK (review_resolution IN ('refund_approved', 'closed_no_refund')),
  ADD COLUMN review_resolved_at TIMESTAMPTZ,
  ADD COLUMN review_resolved_by UUID,
  ADD COLUMN review_resolution_note TEXT,
  ADD CONSTRAINT shipment_cancellation_operations_review_recorded CHECK (
    (review_reason IS NULL) = (review_required_at IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_review_resolution_recorded CHECK (
    (review_resolution IS NULL) = (review_resolved_at IS NULL)
    AND (review_resolution IS NULL) = (review_resolved_by IS NULL)
    AND (review_resolution IS NULL) = (review_resolution_note IS NULL)
  ),
  ADD CONSTRAINT shipment_cancellation_operations_review_resolution_after_required CHECK (
    review_resolution IS NULL OR review_required_at IS NOT NULL
  ),
  ADD CONSTRAINT shipment_cancellation_operations_review_note_format CHECK (
    review_resolution_note IS NULL
    OR (review_resolution_note = btrim(review_resolution_note)
        AND char_length(review_resolution_note) BETWEEN 1 AND 500)
  );

-- B4.2 allowed the label loss only with an accepted outcome. An approved refund needs it too:
-- the label was not cancelled, so its whole cost is lost while the outcome stays refused,
-- ambiguous or NULL. Every other part of the constraint is unchanged.
ALTER TABLE public.shipment_cancellation_operations
  DROP CONSTRAINT shipment_cancellation_operations_carrier_balance_consistent;
ALTER TABLE public.shipment_cancellation_operations
  ADD CONSTRAINT shipment_cancellation_operations_carrier_balance_consistent CHECK (
    (
      carrier_cancellation_outcome IS DISTINCT FROM 'accepted'
      AND carrier_balance_returned IS NULL
      AND carrier_balance_returned_at IS NULL
      AND (label_cost_loss_cents IS NULL OR review_resolution IS NOT DISTINCT FROM 'refund_approved')
    )
    OR (carrier_cancellation_outcome IS NOT DISTINCT FROM 'accepted' AND carrier_balance_returned IS NOT NULL)
  );

COMMENT ON COLUMN public.shipment_cancellation_operations.review_reason IS
  'Why the preparing-timeout cancellation needs an admin: tracking_unknown, carrier_refused or carrier_ambiguous. Set once by fn_mark_shipment_cancellation_review; NULL together with review_required_at.';
COMMENT ON COLUMN public.shipment_cancellation_operations.review_required_at IS
  'When the operation was marked for carrier review. While review_resolution is NULL the claim raises SHIPMENT_CANCELLATION_UNDER_REVIEW.';
COMMENT ON COLUMN public.shipment_cancellation_operations.review_resolution IS
  'Final admin decision: refund_approved (the next run may start the refund) or closed_no_refund (the claim raises SHIPMENT_CANCELLATION_REVIEW_CLOSED). Set once by fn_resolve_shipment_cancellation_review.';
COMMENT ON COLUMN public.shipment_cancellation_operations.review_resolved_at IS
  'When the admin resolved the review. Kept together with review_resolution.';
COMMENT ON COLUMN public.shipment_cancellation_operations.review_resolved_by IS
  'Admin profile that resolved the review. Kept together with review_resolution.';
COMMENT ON COLUMN public.shipment_cancellation_operations.review_resolution_note IS
  'Admin-provided reason for the decision, 1-500 characters, trimmed. Kept together with review_resolution.';

-- Read-only view of the carrier state of one operation, so the handler can skip the carrier call
-- when an accepted outcome is already stored.
CREATE OR REPLACE FUNCTION public.fn_get_shipment_carrier_cancellation(p_shipment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipments WHERE id = p_shipment_id) THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CANCELLATION_OPERATION_NOT_FOUND'; END IF;

  RETURN jsonb_build_object(
    'carrier_cancellation_outcome', v_operation.carrier_cancellation_outcome,
    'carrier_cancellation_recorded_at', v_operation.carrier_cancellation_recorded_at,
    'carrier_balance_returned', v_operation.carrier_balance_returned,
    'carrier_balance_returned_at', v_operation.carrier_balance_returned_at,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents,
    'review_reason', v_operation.review_reason,
    'review_required_at', v_operation.review_required_at,
    'review_resolution', v_operation.review_resolution,
    'review_resolved_at', v_operation.review_resolved_at,
    'review_resolved_by', v_operation.review_resolved_by,
    'review_resolution_note', v_operation.review_resolution_note);
END;
$$;

-- Marks the operation for admin review, once, while the preparing-timeout claim is live and no
-- external call has started. marked = true only for the first mark, so the alert fires once;
-- a repeat returns the stored reason with marked = false and changes nothing.
CREATE OR REPLACE FUNCTION public.fn_mark_shipment_cancellation_review(
  p_shipment_id UUID,
  p_claim_token UUID,
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('tracking_unknown', 'carrier_refused', 'carrier_ambiguous') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_REASON';
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

  IF v_operation.review_required_at IS NOT NULL THEN
    RETURN jsonb_build_object('marked', FALSE,
      'review_reason', v_operation.review_reason,
      'review_required_at', v_operation.review_required_at);
  END IF;

  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_shipment.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE'; END IF;

  UPDATE public.shipment_cancellation_operations
    SET review_reason = p_reason, review_required_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;

  RETURN jsonb_build_object('marked', TRUE,
    'review_reason', v_operation.review_reason,
    'review_required_at', v_operation.review_required_at);
END;
$$;

-- Admin decision on a pending review, final and made once. It never moves money:
--   refund_approved   the label was not cancelled, so label_cost_loss_cents becomes the shipment's
--                     provider cost (NULL = unknown); an accepted outcome keeps its recorded loss.
--                     The next cron run claims again and starts the refund through the standard path.
--   closed_no_refund  the loss stays as it was and the claim refuses the shipment from now on.
CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_cancellation_review(
  p_shipment_id UUID,
  p_admin_id UUID,
  p_resolution TEXT,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_note TEXT := btrim(p_note);
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_loss BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Defense in depth: the admin id is stored as the decision maker, so it must be an
  -- active admin by the same rule as is_admin(), not only what the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('refund_approved', 'closed_no_refund') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_RESOLUTION';
  END IF;
  IF v_note IS NULL OR v_note = '' OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'INVALID_REVIEW_NOTE';
  END IF;

  -- Same lock order as the other cancellation RPCs: shipment first, then the operation.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.review_required_at IS NULL THEN
    RAISE EXCEPTION 'CARRIER_REVIEW_NOT_PENDING';
  END IF;
  IF v_operation.review_resolution IS NOT NULL THEN RAISE EXCEPTION 'CARRIER_REVIEW_ALREADY_RESOLVED'; END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_shipment.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE'; END IF;

  v_loss := CASE
    WHEN p_resolution <> 'refund_approved' OR v_operation.carrier_cancellation_outcome = 'accepted'
      THEN v_operation.label_cost_loss_cents
    ELSE v_shipment.label_provider_cost_cents
  END;

  UPDATE public.shipment_cancellation_operations
    SET review_resolution = p_resolution,
        review_resolved_at = clock_timestamp(),
        review_resolved_by = p_admin_id,
        review_resolution_note = v_note,
        label_cost_loss_cents = v_loss
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;

  RETURN jsonb_build_object(
    'review_resolution', v_operation.review_resolution,
    'review_resolved_at', v_operation.review_resolved_at,
    'review_resolved_by', v_operation.review_resolved_by,
    'review_resolution_note', v_operation.review_resolution_note,
    'label_cost_loss_cents', v_operation.label_cost_loss_cents);
END;
$$;

-- Pending carrier reviews for the admin "Envios" bucket, oldest first, then shipment_id.
-- A TABLE (not jsonb) keeps the columns typed for the generated database types. No pagination:
-- every row waits for a manual admin action, so the set stays small.
CREATE OR REPLACE FUNCTION public.fn_list_shipment_cancellation_reviews()
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  seller_id UUID,
  tracking_number TEXT,
  carrier TEXT,
  label_provider_cost_cents BIGINT,
  review_reason TEXT,
  carrier_cancellation_outcome TEXT,
  review_required_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  RETURN QUERY
  SELECT p.shipment_id, p.order_id, p.seller_id, p.tracking_number, p.carrier,
         p.label_provider_cost_cents, p.review_reason, p.carrier_cancellation_outcome,
         p.review_required_at
  FROM (
    SELECT o.shipment_id,
           o.order_id,
           s.seller_id,
           s.tracking_number,
           s.carrier,
           s.label_provider_cost_cents,
           o.review_reason,
           o.carrier_cancellation_outcome,
           o.review_required_at
    FROM public.shipment_cancellation_operations o
    JOIN public.shipments s ON s.id = o.shipment_id
    WHERE o.review_required_at IS NOT NULL
      AND o.review_resolution IS NULL
  ) p
  ORDER BY p.review_required_at ASC, p.shipment_id ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_list_shipment_cancellation_reviews() IS
  'Service-only (SECURITY DEFINER): preparing-timeout cancellations waiting for an admin to approve the refund or close them, oldest first.';

-- Grant review: all four RPCs are service-only. The Edge Functions verify the caller is an admin
-- through profiles_private.role; the definers bypass RLS to read and write operations, shipments
-- and orders, and the resolution unlocks a Stripe refund, so anon/authenticated must never reach them.
REVOKE EXECUTE ON FUNCTION public.fn_get_shipment_carrier_cancellation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_shipment_carrier_cancellation(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_mark_shipment_cancellation_review(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_shipment_cancellation_review(UUID, UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_resolve_shipment_cancellation_review(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shipment_cancellation_review(UUID, UUID, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_list_shipment_cancellation_reviews() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_shipment_cancellation_reviews() TO service_role;

-- Same body as the B4.2 function plus one change: a preparing-timeout refund needs an accepted
-- carrier cancellation OR an admin-approved review. The raise rolls back the start fence.
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
     AND (
       (v_operation.carrier_cancellation_outcome IS DISTINCT FROM 'accepted'
        AND v_operation.review_resolution IS DISTINCT FROM 'refund_approved')
       -- Resolutions are final: an operation marked for review needs the approval even when
       -- the outcome is accepted, so a live token cannot refund while pending or after closing.
       OR (v_operation.review_required_at IS NOT NULL
           AND v_operation.review_resolution IS DISTINCT FROM 'refund_approved')
     ) THEN
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

-- Same body as the baseline function plus two guards, both before the claim token can rotate:
-- a pending review and a review closed without refund stop the shipment from being claimed
-- again, so no run calls the carrier or wastes a slot on it.
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
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND THEN
    -- B4.4a: an admin decides first. A pending review or a review closed without refund never
    -- rotates the token; an approved refund claims normally and then passes the start guard.
    IF v_operation.review_required_at IS NOT NULL AND v_operation.review_resolution IS NULL THEN
      RAISE EXCEPTION 'SHIPMENT_CANCELLATION_UNDER_REVIEW';
    END IF;
    IF v_operation.review_resolution = 'closed_no_refund' THEN
      RAISE EXCEPTION 'SHIPMENT_CANCELLATION_REVIEW_CLOSED';
    END IF;
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
    -- B4.4b: a preparing_timeout takeover of an expired pre-start operation that belongs to
    -- another source re-owns it. That operation never authorized an external call, and its
    -- source (buyer, seller, paid_timeout) can no longer act on a preparing shipment, so
    -- keeping that context would make the carrier outcome and review RPCs reject it forever.
    IF p_source = 'preparing_timeout' AND v_operation.source <> 'preparing_timeout' THEN
      UPDATE public.shipment_cancellation_operations
        SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes',
            source = 'preparing_timeout', actor_id = NULL, reason = p_reason
        WHERE shipment_id = p_shipment_id
        RETURNING * INTO v_operation;
    ELSE
      UPDATE public.shipment_cancellation_operations
        SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
        WHERE shipment_id = p_shipment_id
        RETURNING * INTO v_operation;
    END IF;
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

-- The baseline only revoked PUBLIC, so a local database also lets anon/authenticated reach the
-- grant. The body checks the service role either way; this keeps the grants service-only.
REVOKE EXECUTE ON FUNCTION public.fn_claim_shipment_cancellation(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_shipment_cancellation(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- The private start must stay unreachable or the carrier guard above could be skipped (B4.2).
REVOKE EXECUTE ON FUNCTION public.fn_start_shipment_cancellation(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
