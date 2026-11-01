-- ============================================================================
-- shipment.funds_released: seller notice when the Stripe transfer of a shipment
-- is recorded (expo-push-notifications T5, S4).
--
-- Why: the seller learned that the money of a sale left Selene only by opening
-- the order. fn_complete_shipment_transfer now writes a typed notice to the
-- seller, in the same transaction that first records shipments.stripe_transfer_id.
--
-- Branch rule: only the branch that runs the UPDATE of stripe_transfer_id (the
-- first completion) writes the notice. The replay that finds the same transfer
-- id and every RETURN false path write nothing. Guards, lock order, return
-- values and the possible-effect fence are unchanged.
--
-- Idempotency: source_event_key is 'shipment.funds_released:<shipment_id>', so
-- the unique (source_event_key, user_id) index keeps one notice per shipment.
--
-- Subtransaction: the notice is secondary to the money record. The insert runs
-- inside BEGIN ... EXCEPTION, so a failure rolls back only the notice and writes
-- a WARNING to system_logs; the recorded transfer is never undone.
--
-- Catalogue: keeps the 14 kinds of 20261030214855_shipment_milestone_notifications.sql
-- (equal to the remote project, read through the Supabase MCP on 2026-10-30)
-- and adds shipment.funds_released. Never drop a kind when adding one. The kind
-- is pushed to the seller on the orders channel.
--
-- Grant review (AGENTS.md): fn_complete_shipment_transfer stays SECURITY DEFINER
-- with search_path '' because it writes a notice for another user. It restates
-- REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE ... TO
-- service_role exactly as the canonical file does; nothing is granted to a client.
--
-- Canonical definition: supabase/queries/payments/shipment_transfer_coordination.sql
-- ============================================================================
BEGIN;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_event_kind_catalogue_chk,
  ADD CONSTRAINT notifications_event_kind_catalogue_chk
    CHECK (event_kind IS NULL OR event_kind IN (
      'order.payment_confirmed',
      'shipment.cancelled',
      'shipment.refund_failed',
      'dispute.opened',
      'dispute.verdict',
      'product.approved',
      'product.approved_with_note',
      'product.rejected',
      'return.seller_evidence_submitted',
      'return.delivered',
      'product.available',
      'product.interest',
      'shipment.in_transit',
      'shipment.delivered',
      'shipment.funds_released'
    ));

CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer(
  p_run_id UUID, p_shipment_id UUID, p_expected_stage_version INTEGER,
  p_transfer_token UUID, p_stripe_transfer_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Funds released notice failed',
      jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
  END;
  -- Never clear the possible-effect fence, including on idempotent completion.
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_complete_shipment_transfer(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_complete_shipment_transfer(UUID, UUID, INTEGER, UUID, TEXT) TO service_role;

INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES
  ('shipment.funds_released', 'seller', 'orders');

COMMIT;
