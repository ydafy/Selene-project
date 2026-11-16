CREATE OR REPLACE FUNCTION public.fn_lease_overdue_refund_replay (
  p_shipment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_shipment_status TEXT;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- Same lock order as the record and escalate RPCs: shipment first, then the operation.
  SELECT status::text INTO v_shipment_status FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_operation.source IS DISTINCT FROM 'admin_overdue_payout'
     OR v_operation.external_started_at IS NULL OR v_operation.refund_request IS NULL THEN
    RAISE EXCEPTION 'OVERDUE_REFUND_NOT_STARTED';
  END IF;
  -- Inside Stripe's idempotency window the replay reuses the operation key, so
  -- only the escalated replay past that window needs this lease.
  IF v_operation.recovery_escalated_at IS NULL THEN RAISE EXCEPTION 'OVERDUE_REFUND_NOT_ESCALATED'; END IF;

  -- A refund recorded or repaid by hand meanwhile, or a live lease of another
  -- retry: this retry must not call Stripe. The next retry converges.
  IF v_operation.refund_id IS NOT NULL OR v_operation.refund_status IS NOT NULL
     OR v_operation.refund_resolved_at IS NOT NULL OR v_shipment_status = 'refunded'
     OR v_operation.claim_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;

  -- The started operation's claim lease is free to reuse: external_started_at
  -- already fences every claim, start and transfer. Ten minutes outlive any
  -- Edge Function run, so a lease holder's Stripe call has ended before the
  -- next retry lists the refunds again.
  v_expires_at := clock_timestamp() + interval '10 minutes';
  UPDATE public.shipment_cancellation_operations SET claim_expires_at = v_expires_at
    WHERE shipment_id = p_shipment_id;

  RETURN jsonb_build_object('status', 'leased', 'lease_expires_at', v_expires_at);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_lease_overdue_refund_replay"(uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_lease_overdue_refund_replay"(uuid) IS 'Service-only (SECURITY DEFINER; EXECUTE revoked from PUBLIC, anon and authenticated because it serializes a Stripe refund only an Edge Function makes): before an admin retry replays the frozen refund of an escalated overdue payout refund (#549) past Stripe''s idempotency window, takes an exclusive 10-minute lease on the operation (its claim_expires_at). Returns leased, or busy while another lease is live or once a refund was recorded, resolved or the shipment refunded. Raises OVERDUE_REFUND_NOT_STARTED or OVERDUE_REFUND_NOT_ESCALATED otherwise.';

REVOKE ALL ON FUNCTION "public"."fn_lease_overdue_refund_replay"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_lease_overdue_refund_replay"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_lease_overdue_refund_replay"(uuid) FROM PUBLIC, "anon", "authenticated";
