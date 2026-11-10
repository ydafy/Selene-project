CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer (
  p_run_id                 uuid,
  p_shipment_id            uuid,
  p_expected_stage_version integer,
  p_transfer_token         uuid,
  p_stripe_transfer_id     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_stripe_transfer_id IS NULL OR btrim(p_stripe_transfer_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_TRANSFER_ID';
  END IF;
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_expected_stage_version IS NULL OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL OR v_run.payout_claim_token IS NOT NULL
    OR v_run.payout_claim_expires_at IS NOT NULL OR v_run.payout_create_attempted_at IS NOT NULL
    OR v_run.paid_at IS NOT NULL OR v_run.failed_at IS NOT NULL
    OR v_run.failure_reason IS NOT NULL OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_transfer_token IS NULL OR v_mapping.transfer_token IS DISTINCT FROM p_transfer_token
    OR v_mapping.transfer_started_at IS NULL OR v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id THEN RETURN false; END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL THEN
    RETURN v_shipment.stripe_transfer_id = p_stripe_transfer_id;
  END IF;
  UPDATE public.shipments SET stripe_transfer_id = p_stripe_transfer_id WHERE id = p_shipment_id;
  -- The seller notice is best effort: a failing insert must never undo the
  -- recorded transfer, so it runs in its own subtransaction.
  BEGIN
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
    ) VALUES (
      v_shipment.seller_id,
      'shipment.funds_released',
      'shipment.funds_released:' || p_shipment_id::text,
      jsonb_build_object('order_id', v_shipment.order_id, 'shipment_id', p_shipment_id,
        'amount_cents', v_mapping.net_payout, 'currency', 'mxn', 'recipient_role', 'seller'),
      'success',
      'Liberamos el pago de tu venta',
      'Enviamos $' || to_char(v_mapping.net_payout / 100.0, 'FM999,999,990.00')
        || ' MXN a tu cuenta de vendedor. El depósito a tu banco puede tardar unos días hábiles.',
      '/profile/orders/' || v_shipment.order_id::text
        || COALESCE('?shipment_id=' || p_shipment_id::text, '')
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Funds released notice failed',
      jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
  END;
  -- Never clear the possible-effect fence, including on idempotent completion.
  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_complete_shipment_transfer"(uuid, uuid, integer, uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_complete_shipment_transfer"(uuid, uuid, integer, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_shipment_transfer"(uuid, uuid, integer, uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_complete_shipment_transfer"(uuid, uuid, integer, uuid, text) FROM PUBLIC, "anon", "authenticated";
