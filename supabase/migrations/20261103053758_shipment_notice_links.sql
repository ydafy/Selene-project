-- T13 (expo-push-notifications): a notice about one shipment links to that shipment.
-- A shipment holds one product, so one order can have several shipments for the
-- buyer and for one seller; without the shipment the app opens the order summary.
-- Each producer below (shipment milestones, label deadline, returns) now writes
--   /profile/orders/<order_id>?shipment_id=<shipment_id>
-- and falls back to /profile/orders/<order_id> if the shipment id is NULL, so a
-- NULL never empties the link. The app accepts only that query (NotificationLinking).
-- Only the action_path expression changes; existing rows are test data and stay as is.
-- CREATE OR REPLACE keeps each function's owner and grants.

BEGIN;

-- fn_notify_shipment_milestone: from 20261030214855_shipment_milestone_notifications.sql, body from supabase/queries/shipments/fn_notify_shipment_milestone.sql.
CREATE OR REPLACE FUNCTION public.fn_notify_shipment_milestone(p_shipment_id uuid, p_event_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
BEGIN
  IF p_event_kind IS NULL OR p_event_kind NOT IN ('shipment.in_transit', 'shipment.delivered') THEN
    RAISE EXCEPTION 'INVALID_SHIPMENT_MILESTONE';
  END IF;

  SELECT s.order_id, o.buyer_id INTO v_order_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  ) VALUES (
    v_buyer_id,
    p_event_kind,
    p_event_kind || ':' || p_shipment_id::text,
    jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                       'recipient_role', 'buyer'),
    CASE WHEN p_event_kind = 'shipment.in_transit' THEN 'info' ELSE 'success' END,
    CASE WHEN p_event_kind = 'shipment.in_transit' THEN 'Tu envío va en camino'
         ELSE 'Tu envío fue entregado' END,
    CASE WHEN p_event_kind = 'shipment.in_transit'
         THEN 'La paquetería ya lleva un envío de tu pedido. Puedes seguirlo desde tu pedido.'
         ELSE 'Revisa tus productos. Tienes 48 horas desde la entrega para reportar un problema.' END,
    '/profile/orders/' || v_order_id::text
      || COALESCE('?shipment_id=' || p_shipment_id::text, '')
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$$;

-- fn_notify_label_deadline_reminders: from 20261101040000_shipment_label_deadline_notification.sql, body from supabase/queries/shipments/fn_notify_label_deadline_reminders.sql.
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

-- fn_mark_return_delivered: from 20261020100000_remote_schema_baseline.sql, body from supabase/queries/return/fn_mark_return_delivered.sql.
CREATE OR REPLACE FUNCTION "public"."fn_mark_return_delivered"("p_dispute_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_status      TEXT;
  v_buyer_id    UUID;
  v_seller_id   UUID;
  v_order_id    UUID;
  v_shipment_id UUID;
  v_return_delivered_at timestamptz;
BEGIN
  -- 1. Validar dispute y aplicar Bloqueo Pesimista (FOR UPDATE) para evitar race conditions
  -- Esto evita que el cron sobreescriba un estado 'resolved' manual si el vendedor confirma al mismo milisegundo.
  SELECT d.status::TEXT, d.buyer_id, d.seller_id, d.order_id, d.shipment_id
  INTO v_status, v_buyer_id, v_seller_id, v_order_id, v_shipment_id
  FROM public.disputes d
  WHERE d.id = p_dispute_id
  FOR UPDATE; -- ← FIX CRÍTICO: Previene doble reembolso fraudulento por sobreescritura de estado

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en flujo de retorno activo (en camino o esperando envío)
  IF v_status NOT IN ('waiting_return', 'return_shipped') THEN
    RETURN QUERY SELECT false, format('INVALID_DISPUTE_STATUS: %s', v_status); RETURN;
  END IF;

  -- Verify the stored participants before publishing a trusted seller-scoped event.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shipments s ON s.order_id = o.id
    WHERE o.id = v_order_id AND s.id = v_shipment_id
      AND o.buyer_id = v_buyer_id AND s.seller_id = v_seller_id
  ) THEN
    RAISE EXCEPTION 'Invalid return delivery relationship';
  END IF;

  -- 3. Marcar como entregado (Inicia el reloj de 48 horas de gracia para unboxing del vendedor)
  UPDATE public.disputes
  SET status = 'return_delivered',
      return_delivered_at = clock_timestamp(),
      updated_at = now()
  WHERE id = p_dispute_id
  RETURNING return_delivered_at INTO v_return_delivered_at;

  IF v_return_delivered_at IS NULL OR v_order_id IS NULL
     OR v_buyer_id IS NULL OR v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Invalid return delivery identity or recipients';
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, message, action_path,
    event_kind, source_event_key, event_payload
  )
  SELECT recipients.user_id, recipients.notice_type, recipients.title,
    recipients.message,
    '/profile/orders/' || v_order_id::text
      || COALESCE('?shipment_id=' || v_shipment_id::text, ''),
    'return.delivered',
    'return.delivered:' || p_dispute_id::text || ':' || extract(epoch FROM v_return_delivered_at)::text,
    jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id,
                       'recipient_role', recipients.recipient_role)
  FROM (VALUES
    (v_seller_id, 'seller', 'warning', 'Retorno entregado',
     'El retorno fue entregado. Revisa el producto y reporta cualquier anomalía dentro de 48 horas.'),
    (v_buyer_id, 'buyer', 'info', 'Retorno entregado',
     'Se registró la entrega del retorno. Consulta el estado de tu caso.')
  ) AS recipients(user_id, recipient_role, notice_type, title, message)
  WHERE true AND (recipients.recipient_role = 'seller' OR v_buyer_id IS DISTINCT FROM v_seller_id)
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_return_delivered',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

-- fn_seller_submit_return_evidence: from 20261020100000_remote_schema_baseline.sql, body from supabase/queries/return/fn_seller_submit_return_evidence.sql.
CREATE OR REPLACE FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text" DEFAULT NULL::"text") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_auth_user_id UUID;
    v_status public.dispute_status;
    v_order_id UUID;
    v_occurrence_id TEXT;
BEGIN
    v_auth_user_id := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    SELECT d.seller_id, d.buyer_id, d.shipment_id, d.status, d.order_id
    INTO v_seller_id, v_buyer_id, v_shipment_id, v_status, v_order_id
    FROM public.disputes d WHERE d.id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_seller_id IS DISTINCT FROM v_auth_user_id THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;
    IF v_status IS DISTINCT FROM 'return_delivered' THEN
        RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(p_images) AS evidence_url(url) WHERE NULLIF(btrim(evidence_url.url), '') IS NOT NULL)
       OR NULLIF(btrim(p_video_url), '') IS NULL THEN
        RETURN QUERY SELECT false, 'EVIDENCE_REQUIRED'::TEXT; RETURN;
    END IF;
    IF v_buyer_id IS NULL OR v_order_id IS NULL OR v_shipment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.shipments s ON s.order_id = o.id
        WHERE o.id = v_order_id AND s.id = v_shipment_id
          AND o.buyer_id = v_buyer_id AND s.seller_id = v_seller_id
    ) THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_RELATIONSHIP'::TEXT; RETURN;
    END IF;

    UPDATE public.disputes
    SET seller_evidence = jsonb_build_object(
            'images', p_images,
            'video_url', p_video_url,
            'submitted_at', now(),
            'notification_event_id', gen_random_uuid()
        ),
        status = 'open',
        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor ha impugnado el retorno y subido evidencia de video.',
        updated_at = now()
    WHERE id = p_dispute_id
    RETURNING seller_evidence->>'notification_event_id' INTO v_occurrence_id;

    IF v_occurrence_id IS NULL THEN
        RAISE EXCEPTION 'Missing seller evidence occurrence';
    END IF;

    IF v_buyer_id IS DISTINCT FROM v_auth_user_id THEN
        INSERT INTO public.notifications (
            user_id, type, title, message, action_path,
            event_kind, source_event_key, event_payload
        ) VALUES (
            v_buyer_id, 'info', 'Tu disputa se reabrió para revisión',
            'El vendedor reportó un problema con el producto devuelto y presentó evidencia. La misma disputa se reabrió para revisar esa evidencia. Consulta los detalles del caso en tu pedido.',
            '/profile/orders/' || v_order_id::text
              || COALESCE('?shipment_id=' || v_shipment_id::text, ''),
            'return.seller_evidence_submitted',
            'return.seller_evidence_submitted:' || p_dispute_id::text || ':' || v_occurrence_id,
            jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id,
                               'recipient_role', 'buyer')
        )
        ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_seller_submit_return_evidence',
            jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, 'EVIDENCE_SUBMISSION_FAILED'::TEXT;
END;
$$;

COMMIT;
