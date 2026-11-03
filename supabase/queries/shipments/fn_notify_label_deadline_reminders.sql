-- =========================================================================
-- fn_notify_label_deadline_reminders — seller reminder before the paid timeout
-- Migration: supabase/migrations/*_shipment_label_deadline_notification.sql
-- Writes one shipment.label_deadline notice to the seller of every paid
-- shipment that auto-cancel-orders would cancel within the next 12 hours: no
-- tracking number, a label state the cron can claim, no cancellation with a
-- live claim or a started refund, and a deadline (created_at plus
-- system_settings.order_expiration_hours) that has not passed yet. Once per
-- shipment (source_event_key). auto-cancel-orders calls it on every hourly run,
-- inside its lease and before the cancellations. Returns the notices written.
-- The push outbox trigger fans it out (push_event_policy).
-- Grant review: SECURITY DEFINER because it writes notices for other users;
-- executable by service_role only.
-- =========================================================================

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
           || COALESCE('?shipment_id=' || d.id::text, '')
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
