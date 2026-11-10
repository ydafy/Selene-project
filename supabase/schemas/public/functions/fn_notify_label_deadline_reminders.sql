CREATE OR REPLACE FUNCTION public.fn_notify_label_deadline_reminders()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_notify_label_deadline_reminders"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_notify_label_deadline_reminders"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_notify_label_deadline_reminders"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_notify_label_deadline_reminders"() FROM PUBLIC, "anon", "authenticated";
