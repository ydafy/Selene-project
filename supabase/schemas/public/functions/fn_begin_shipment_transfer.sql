CREATE OR REPLACE FUNCTION public.fn_begin_shipment_transfer (
  p_run_id                 uuid,
  p_shipment_id            uuid,
  p_expected_stage_version integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_row public.admin_connect_payout_release_view%ROWTYPE;
  v_token UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Match existing resume/terminal lock order: run, mapping, shipment. A
  -- cancellation owns only shipment/operation and reads transfer fences without
  -- locking mappings, so it cannot form a reverse-order lock cycle.
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF p_expected_stage_version IS NULL
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  -- Read after the shared shipment lock, with the live clock after lock waits.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED';
  END IF;
  IF v_shipment.status IS DISTINCT FROM 'completed' OR v_shipment.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_COMPLETED';
  END IF;

  -- Reuse the canonical allocation/read model, not caller amounts or a second
  -- financial formula. Only this run's own active marker may be tolerated.
  SELECT * INTO v_row FROM public.admin_connect_payout_release_view WHERE shipment_id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE'; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id
    OR v_row.stripe_account_id IS NULL OR v_row.stripe_onboarding_status IS DISTINCT FROM 'complete'
    OR v_row.stripe_payment_intent_id IS NULL
    OR v_row.release_amount_cents IS NULL OR v_row.release_amount_cents <= 0
    OR v_mapping.net_payout IS DISTINCT FROM v_row.release_amount_cents
    OR v_run.amount::bigint IS DISTINCT FROM
      (SELECT sum(net_payout) FROM public.connect_payout_run_shipments WHERE run_id = p_run_id)
    OR (v_row.is_eligible IS DISTINCT FROM true AND v_row.ineligible_reason IS DISTINCT FROM 'already_released')
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = p_shipment_id AND run_id <> p_run_id
        AND status IN ('pending_reconciliation','paid','reconciliation_needed')) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_get_connect_account_actionability(v_row.stripe_account_id)
    WHERE is_actionable = true) THEN
    RAISE EXCEPTION 'CONNECT_ACCOUNT_NOT_ACTIONABLE';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_shipment.order_id;
  IF NOT FOUND OR v_order.stripe_charge_id IS NULL OR btrim(v_order.stripe_charge_id) = ''
    OR v_order.stripe_transfer_group IS NULL OR btrim(v_order.stripe_transfer_group) = '' THEN
    RAISE EXCEPTION 'MISSING_SETTLEMENT_CONTEXT';
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.connect_payout_run_shipments
    SET transfer_started_at = clock_timestamp(), transfer_token = v_token
    WHERE id = v_mapping.id;
  -- No run stage/version mutation: preserve the existing resume intent epoch.
  RETURN jsonb_build_object('transfer_token', v_token,
    'amount', v_row.release_amount_cents, 'currency', 'mxn',
    'destination', v_row.stripe_account_id, 'source_transaction', v_order.stripe_charge_id,
    'transfer_group', v_order.stripe_transfer_group,
    'idempotency_key', v_run.idempotency_key || ':' || v_run.id::text || ':' || p_shipment_id::text,
    'metadata', jsonb_build_object('app_name','selene','run_id',v_run.id,
      'shipment_id',p_shipment_id,'seller_id',v_run.seller_id,'order_id',v_order.id));
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_begin_shipment_transfer"(uuid, uuid, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_begin_shipment_transfer"(uuid, uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_begin_shipment_transfer"(uuid, uuid, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_begin_shipment_transfer"(uuid, uuid, integer) FROM PUBLIC, "anon", "authenticated";
