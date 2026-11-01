-- ============================================================================
-- shipment.label_deadline: seller reminder before auto-cancel-orders cancels a
-- paid shipment without a label (expo-push-notifications T7, S4).
--
-- Why: a seller who did not generate the label learned about the deadline only
-- when the sale was already cancelled and refunded. auto-cancel-orders now calls
-- fn_notify_label_deadline_reminders on every hourly run, inside its lease and
-- before the cancellations, and a failing call never blocks them.
--
-- Selection: the shipments the paid timeout would cancel (status paid, no
-- tracking number, label state unclaimed or retryable_rejected, no cancellation
-- with a live claim or a started refund) whose deadline, created_at plus
-- system_settings.order_expiration_hours, falls within the next 12 hours and has
-- not passed. After the deadline the cancellation, not the reminder, applies.
--
-- Idempotency: source_event_key is 'shipment.label_deadline:<shipment_id>', so
-- the unique (source_event_key, user_id) index keeps one notice per shipment
-- across hourly runs.
--
-- Catalogue: keeps the 16 kinds of 20261101030000_shipment_refunded_notification.sql
-- and adds shipment.label_deadline. Never drop a kind when adding one. The kind
-- is pushed to the seller on the orders channel.
--
-- Grant review (AGENTS.md): SECURITY DEFINER with search_path '' because it
-- writes notices for other users. REVOKE ALL ... FROM PUBLIC, anon,
-- authenticated and GRANT EXECUTE ... TO service_role; the function also
-- raises 42501 for any other role. Nothing is granted to a client.
--
-- Canonical definition: supabase/queries/shipments/fn_notify_label_deadline_reminders.sql
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
      'shipment.funds_released',
      'shipment.refunded',
      'shipment.label_deadline'
    ));

CREATE OR REPLACE FUNCTION public.fn_notify_label_deadline_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_hours integer;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_notify_label_deadline_reminders is service-role only' USING ERRCODE = '42501';
  END IF;

  SELECT ss.order_expiration_hours INTO v_hours
  FROM public.system_settings AS ss
  WHERE ss.id = 1;

  IF v_hours IS NULL OR v_hours <= 0 THEN
    RAISE EXCEPTION 'AUTO_CANCEL_SETTINGS_INVALID';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
  )
  SELECT d.seller_id,
         'shipment.label_deadline',
         'shipment.label_deadline:' || d.id::text,
         jsonb_build_object('shipment_id', d.id, 'order_id', d.order_id,
           'deadline_at', d.deadline_at, 'recipient_role', 'seller'),
         'warning',
         'Genera la guía de tu venta',
         'Si no generas la guía en '
           || CASE WHEN d.hours_left = 1 THEN '1 hora' ELSE d.hours_left::text || ' horas' END
           || ', cancelaremos la venta y reembolsaremos al comprador.',
         '/profile/orders/' || d.order_id::text
  FROM (
    SELECT c.id, c.order_id, c.seller_id, c.deadline_at,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM c.deadline_at - v_now) / 3600))::integer AS hours_left
    FROM (
      SELECT s.id, s.order_id, s.seller_id,
             s.created_at + pg_catalog.make_interval(hours => v_hours) AS deadline_at
      FROM public.shipments AS s
      WHERE s.status = 'paid'
        AND s.tracking_number IS NULL
        AND s.label_generation_state IN ('unclaimed', 'retryable_rejected')
        AND NOT EXISTS (
          SELECT 1
          FROM public.shipment_cancellation_operations AS op
          WHERE op.shipment_id = s.id
            AND (op.external_started_at IS NOT NULL OR op.claim_expires_at > v_now)
        )
    ) AS c
  ) AS d
  WHERE d.deadline_at > v_now AND d.deadline_at <= v_now + interval '12 hours'
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_label_deadline_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_label_deadline_reminders() TO service_role;

INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES
  ('shipment.label_deadline', 'seller', 'orders');

COMMIT;
