-- T13 (expo-push-notifications): a dispute or return-refund notice links to its shipment.
-- A shipment holds one product, so one order can have several shipments for the
-- buyer and for one seller; without the shipment the app opens the order summary.
-- Every dispute notice producer below now writes
--   /profile/orders/<order_id>?shipment_id=<disputes.shipment_id>
-- and falls back to /profile/orders/<order_id> when the dispute has no shipment
-- (the column is nullable), so a NULL never empties the link.
-- fn_resolve_dispute_to_buyer and fn_resolve_dispute_to_buyer_as_admin also read
-- shipment_id in the SELECT ... FOR UPDATE they already run on the dispute.
-- No verdict, refund, payout or status step changes. CREATE OR REPLACE keeps each
-- function's owner, grants and the notify_dispute_opened trigger.

BEGIN;

-- fn_notify_dispute_opened: from 20261020100000_remote_schema_baseline.sql, body from supabase/queries/disputes/fn_notify_dispute_opened.sql.
CREATE OR REPLACE FUNCTION "public"."fn_notify_dispute_opened"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_buyer_id uuid;
  v_seller_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.status IS DISTINCT FROM 'open'
     OR NEW.shipment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid dispute opened notification authority or state';
  END IF;

  SELECT o.buyer_id, s.seller_id INTO v_buyer_id, v_seller_id
  FROM public.orders o
  JOIN public.shipments s ON s.order_id = o.id
  WHERE o.id = NEW.order_id AND s.id = NEW.shipment_id;

  IF NOT FOUND OR v_buyer_id IS NULL OR v_seller_id IS NULL
     OR NEW.buyer_id IS DISTINCT FROM v_buyer_id
     OR NEW.seller_id IS DISTINCT FROM v_seller_id THEN
    RAISE EXCEPTION 'Dispute order, shipment, buyer or seller relationship invalid';
  END IF;

  IF v_seller_id IS DISTINCT FROM v_buyer_id THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, action_path,
      event_kind, source_event_key, event_payload
    ) VALUES (
      v_seller_id, 'warning', 'Disputa abierta',
      'Se abrió una disputa sobre una de tus ventas. Consulta los detalles del caso.',
      '/profile/orders/' || NEW.order_id::text
        || COALESCE('?shipment_id=' || NEW.shipment_id::text, ''),
      'dispute.opened', 'dispute.opened:' || NEW.id::text,
      jsonb_build_object('dispute_id', NEW.id, 'order_id', NEW.order_id, 'recipient_role', 'seller')
    ) ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- fn_cron_dispute_payout_timeout: from 20261101025000_remove_non_connect_order_refund_path.sql, body from supabase/queries/disputes/fn_cron_dispute_payout_timeout.sql.
CREATE OR REPLACE FUNCTION public.fn_cron_dispute_payout_timeout()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
    v_is_connect BOOLEAN;
BEGIN
    -- Buscar disputas donde el vendedor no ha pagado la guía tras 48h de ser aprobada
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id, d.shipment_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'pending'
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_dispute.shipment_id IS NOT NULL THEN
                -- Connect guard: check if the shipment was paid via Stripe Connect.
                -- If so, skip fn_complete_shipment_refund and just
                -- resolve the dispute directly. Connect handles funds via Stripe.
                SELECT EXISTS(
                    SELECT 1 FROM public.shipments
                    WHERE id = v_dispute.shipment_id
                      AND stripe_payment_intent_id IS NOT NULL
                ) INTO v_is_connect;

                IF v_is_connect THEN
                    -- Connect path: resolve the dispute directly
                    UPDATE public.disputes
                    SET status = 'resolved',
                        resolution_type = 'buyer_wins_timeout',
                        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador (Connect).',
                        updated_at = now()
                    WHERE id = v_dispute.id;

                    INSERT INTO public.notifications (user_id, type, title, message, action_path)
                    VALUES
                        (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Se procesará tu reembolso.', '/profile/orders/' || v_dispute.order_id || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, '')),
                        (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, ''));

                    v_success := true;
                ELSE
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('ERROR', 'Cron payout timeout: shipment has no Stripe payment intent, manual intervention required',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
                END IF;

                IF NOT v_success THEN
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('WARNING', 'Cron payout timeout: refund failed',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
                END IF;
            ELSE
                -- Pre-migration fallback: disputa sin shipment_id
                -- Marcar resuelta y notificar manualmente (no hay fn para esto)
                UPDATE public.disputes
                SET status = 'resolved',
                    resolution_type = 'buyer_wins_timeout',
                    admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
                    updated_at = now()
                WHERE id = v_dispute.id;

                INSERT INTO public.notifications (user_id, type, title, message, action_path)
                VALUES
                    (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Tu reembolso será procesado.', '/profile/orders/' || v_dispute.order_id || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, '')),
                    (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, ''));
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Atrapar excepciones DB sin abortar el resto del lote
            INSERT INTO public.system_logs (level, message, metadata)
            VALUES ('ERROR', 'Cron payout timeout: DB exception',
                    jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;
$$;

-- fn_cron_dispute_shipping_timeout: from 20261101031000_dispute_shipping_timeout_verdict_notice.sql, body from supabase/queries/disputes/fn_cron_dispute_shipping_timeout.sql.
CREATE OR REPLACE FUNCTION public.fn_cron_dispute_shipping_timeout()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
BEGIN
    -- Buscar disputas donde el vendedor YA pagó, pero el comprador no ha enviado tras 48h
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id, d.shipment_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'paid'
          AND d.return_tracking_number IS NULL
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_dispute.shipment_id IS NOT NULL THEN
                -- Marcar disputa resuelta a favor del vendedor. Va primero:
                -- fn_release_shipment_funds rechaza un shipment con disputa activa.
                UPDATE public.disputes
                SET status = 'resolved',
                    resolution_type = 'seller_wins_timeout',
                    admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Comprador no envió el retorno en 48h. Caso cerrado a favor del vendedor.',
                    updated_at = now()
                WHERE id = v_dispute.id;

                -- shipment→completed (trigger→order) si está entregado y pasó la gracia.
                SELECT success, error_message INTO v_success, v_err
                FROM public.fn_release_shipment_funds(v_dispute.shipment_id);

                -- Fallo lógico: deshacer la resolución, no notificar. Reintentar en próximo run.
                IF v_success IS NOT TRUE THEN
                    RAISE EXCEPTION USING ERRCODE = 'SR001', MESSAGE = 'RELEASE_REFUSED';
                END IF;

                -- Notificar
                -- One typed notice per distinct participant, bound to this dispute.
                INSERT INTO public.notifications (
                    user_id, type, title, message, action_path,
                    event_kind, source_event_key, event_payload
                )
                SELECT recipients.user_id, recipients.type, recipients.title,
                       recipients.message, '/profile/orders/' || v_dispute.order_id::text
                         || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, ''),
                       'dispute.verdict',
                       'dispute.verdict:' || v_dispute.id::text || ':shipping_timeout',
                       jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id, 'recipient_role', recipients.recipient_role)
                FROM (VALUES
                    (v_dispute.seller_id, 'seller', 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. El caso se cerró a tu favor.'),
                    (v_dispute.buyer_id, 'buyer', 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.')
                ) AS recipients(user_id, recipient_role, type, title, message)
                WHERE recipients.recipient_role = 'buyer' OR v_dispute.seller_id IS DISTINCT FROM v_dispute.buyer_id
                ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
            ELSE
                -- Data integrity issue: disputa activa sin shipment_id — requiere intervención manual
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('ERROR', 'Cron shipping timeout: dispute without shipment_id — requires manual intervention',
                        jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id));
            END IF;
        EXCEPTION
            WHEN SQLSTATE 'SR001' THEN
                -- La resolución ya se revirtió con el bloque
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('WARNING', 'Cron shipping timeout: release failed',
                        jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
            WHEN OTHERS THEN
                -- Atrapar excepciones DB sin abortar el resto del lote
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('ERROR', 'Cron shipping timeout: DB exception',
                        jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;
$$;

-- fn_cron_return_delivery_timeout: from 20261101025000_remove_non_connect_order_refund_path.sql, body from supabase/queries/disputes/fn_cron_return_delivery_timeout.sql.
CREATE OR REPLACE FUNCTION public.fn_cron_return_delivery_timeout()
 RETURNS TABLE(total_processed integer, total_errors integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dispute    RECORD;
  v_processed  INT := 0;
  v_errors     INT := 0;
  v_success    BOOLEAN;
  v_err_msg    TEXT;
  v_is_connect BOOLEAN;
BEGIN
  FOR v_dispute IN
    SELECT d.id, d.shipment_id, d.buyer_id, d.seller_id, d.order_id
    FROM public.disputes d
    WHERE d.status = 'return_delivered'
      AND d.return_delivered_at < now() - interval '48 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Connect guard: if the shipment was paid via Stripe Connect,
      -- skip fn_complete_shipment_refund. Connect refunds
      -- are handled by resolve-dispute-refund with reverse_transfer.
      SELECT EXISTS(
        SELECT 1 FROM public.shipments
        WHERE id = v_dispute.shipment_id
          AND stripe_payment_intent_id IS NOT NULL
      ) INTO v_is_connect;

      IF v_is_connect THEN
        -- Connect path: just mark dispute resolved.
        -- The actual refund should be triggered by resolve-dispute-refund.
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'buyer_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Retorno entregado + 48h timeout. Refund pendiente de ejecución manual (Connect).',
            updated_at = now()
        WHERE id = v_dispute.id;

        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
          (v_dispute.buyer_id, 'success', 'Devolución Recibida', 'El vendedor recibió el producto. Tu reembolso está pendiente de procesamiento.', '/profile/orders/' || v_dispute.order_id || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, ''));

        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.system_logs (level, message, metadata)
        VALUES ('ERROR', 'Cron return-delivery-timeout: shipment has no Stripe payment intent, manual intervention required',
                jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron return-delivery-timeout: excepción física',
              jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron return-delivery-timeout completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;
$$;

-- fn_record_dispute_refund: from 20261101030000_shipment_refunded_notification.sql, body from supabase/queries/disputes/fn_record_dispute_refund.sql.
CREATE OR REPLACE FUNCTION public.fn_record_dispute_refund(
  p_dispute_id uuid,
  p_stripe_refund_id text
)
 RETURNS TABLE(success boolean, error_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_shipment_id UUID;
  v_dispute_status TEXT;
  v_shipment_status TEXT;
  v_payment_intent TEXT;
  v_resolution TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_record_dispute_refund is service-role only' USING ERRCODE = '42501';
  END IF;

  SELECT d.shipment_id INTO v_shipment_id
  FROM public.disputes AS d
  WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- The shipment lock serializes this with the completion and release paths.
  SELECT s.status::TEXT, s.stripe_payment_intent_id
  INTO v_shipment_status, v_payment_intent
  FROM public.shipments AS s
  WHERE s.id = v_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_payment_intent IS NULL THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::TEXT;
    RETURN;
  END IF;

  SELECT d.status::TEXT, d.resolution_type
  INTO v_dispute_status, v_resolution
  FROM public.disputes AS d
  WHERE d.id = p_dispute_id
  FOR UPDATE;

  -- A repeated call after the refund was recorded changes nothing.
  IF v_shipment_status = 'refunded'
     AND v_dispute_status = 'resolved'
     AND v_resolution = 'buyer' THEN
    RETURN QUERY SELECT true, 'ALREADY_RECORDED'::TEXT;
    RETURN;
  END IF;

  IF v_dispute_status NOT IN ('waiting_return', 'return_delivered') THEN
    RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT;
    RETURN;
  END IF;

  IF v_shipment_status NOT IN ('shipped', 'delivered') THEN
    RETURN QUERY SELECT false, ('SHIPMENT_NOT_REFUNDABLE:' || v_shipment_status)::TEXT;
    RETURN;
  END IF;

  UPDATE public.shipments
  SET status = 'refunded',
      updated_at = now()
  WHERE id = v_shipment_id;

  UPDATE public.disputes
  SET status = 'resolved',
      resolution_type = 'buyer',
      admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Reembolso Stripe ' || COALESCE(p_stripe_refund_id, 'unknown') || ' registrado.',
      updated_at = now()
  WHERE id = p_dispute_id;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Dispute refund recorded',
          jsonb_build_object(
            'dispute_id', p_dispute_id,
            'shipment_id', v_shipment_id,
            'stripe_refund_id', p_stripe_refund_id));

  -- The buyer notice is best effort: a failing insert must never undo the
  -- recorded refund, so it runs in its own subtransaction.
  BEGIN
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
    )
    SELECT o.buyer_id,
           'shipment.refunded',
           'shipment.refunded:' || v_shipment_id::text,
           jsonb_build_object('shipment_id', v_shipment_id, 'order_id', s.order_id,
             'dispute_id', p_dispute_id, 'recipient_role', 'buyer'),
           'success',
           'Te devolvimos tu dinero',
           'Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.',
           '/profile/orders/' || s.order_id::text
             || COALESCE('?shipment_id=' || v_shipment_id::text, '')
    FROM public.shipments AS s
    JOIN public.orders AS o ON o.id = s.order_id
    WHERE s.id = v_shipment_id
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('WARNING', 'Refund notice failed',
              jsonb_build_object('dispute_id', p_dispute_id, 'shipment_id', v_shipment_id,
                'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Refund notice failed and could not be logged: %', SQLERRM;
    END;
  END;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

-- fn_resolve_dispute_to_buyer: from 20261020100000_remote_schema_baseline.sql, body from supabase/queries/disputes/fn_resolve_dispute_to_buyer.sql.
CREATE OR REPLACE FUNCTION "public"."fn_resolve_dispute_to_buyer"("p_dispute_id" "uuid", "p_admin_note" "text") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_status public.dispute_status;
    v_buyer_id UUID;
    v_seller_id UUID;
    v_shipment_id UUID;
    v_audit_id UUID;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT y validar sesión
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila para evitar doble resolución
    SELECT order_id, status, buyer_id, seller_id, shipment_id
    INTO v_order_id, v_status, v_buyer_id, v_seller_id, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    IF v_status NOT IN ('open', 'under_review') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. EJECUCIÓN: Mover a fase de retorno
    UPDATE public.disputes
    SET status = 'waiting_return',
        resolution_type = 'buyer',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- E. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_APPROVE_RETURN', p_dispute_id, jsonb_build_object('note', p_admin_note, 'order_id', v_order_id))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text
             || COALESCE('?shipment_id=' || v_shipment_id::text, ''),
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_buyer_id, 'buyer', 'success', 'Devolución aprobada', 'Tu devolución fue aprobada. Consulta el pedido para conocer los próximos pasos y la guía de retorno.'),
        (v_seller_id, 'seller', 'warning', 'Veredicto: Generar Guía', 'Se aprobó la devolución. Consulta el pedido para generar la guía de retorno y continuar el proceso.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'buyer' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_buyer', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

-- fn_resolve_dispute_to_buyer_as_admin: from 20261020100000_remote_schema_baseline.sql, body from supabase/queries/disputes/fn_resolve_dispute_to_buyer_as_admin.sql.
CREATE OR REPLACE FUNCTION "public"."fn_resolve_dispute_to_buyer_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_status public.dispute_status;
    v_buyer_id UUID;
    v_seller_id UUID;
    v_shipment_id UUID;
    v_audit_id UUID;
BEGIN
    -- A. SECURITY: Actor supplied only by the verified-admin service boundary
    v_auth_user_id := p_admin_id;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_ACTOR';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila para evitar doble resolución
    SELECT order_id, status, buyer_id, seller_id, shipment_id
    INTO v_order_id, v_status, v_buyer_id, v_seller_id, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    IF v_status NOT IN ('open', 'under_review') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. EJECUCIÓN: Mover a fase de retorno
    UPDATE public.disputes
    SET status = 'waiting_return',
        resolution_type = 'buyer',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- E. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_APPROVE_RETURN', p_dispute_id, jsonb_build_object('note', p_admin_note, 'order_id', v_order_id))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text
             || COALESCE('?shipment_id=' || v_shipment_id::text, ''),
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_buyer_id, 'buyer', 'success', 'Devolución aprobada', 'Tu devolución fue aprobada. Consulta el pedido para conocer los próximos pasos y la guía de retorno.'),
        (v_seller_id, 'seller', 'warning', 'Disputa resuelta a favor del comprador', 'El equipo de Selene resolvió la disputa a favor del comprador. Sigue las instrucciones del pedido en la app para coordinar la devolución de tu producto.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'buyer' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_buyer', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

-- fn_resolve_dispute_to_seller: from 20261027001250_remove_wallet_writes_disputes.sql, body from supabase/queries/disputes/fn_resolve_dispute_to_seller.sql.
CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_seller(p_dispute_id uuid, p_admin_note text)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_status public.dispute_status;
    v_audit_id UUID;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT y validar sesión
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila
    SELECT order_id, seller_id, buyer_id, status, shipment_id
    INTO v_order_id, v_seller_id, v_buyer_id, v_status, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    -- Permitimos resolver a favor del vendedor si está en investigación o si ya recibió el retorno (pero impugnó)
    IF v_status NOT IN ('open', 'under_review', 'return_delivered', 'waiting_return') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. PAGO: Stripe Connect releases the seller's funds from the admin payout
    -- queue once the shipment is completed (F.1). Nothing moves in this function.

    -- F. ACTUALIZAR ESTADOS: Cerrar caso
    UPDATE public.disputes
    SET status = 'resolved',
        resolution_type = 'seller',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- F.1 Actualizar a nivel shipment (post-migration) u order (pre-migration)
    IF v_shipment_id IS NOT NULL THEN
        UPDATE public.shipments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_shipment_id;
    ELSE
        UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id;
    END IF;

    -- G. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_RESOLVE_SELLER', p_dispute_id, jsonb_build_object('order_id', v_order_id, 'note', p_admin_note))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text
             || COALESCE('?shipment_id=' || v_shipment_id::text, ''),
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_seller_id, 'seller', 'success', 'Disputa resuelta a tu favor', 'La disputa se resolvió a tu favor. Consulta el pedido para conocer el estado del pago.'),
        (v_buyer_id, 'buyer', 'warning', 'Disputa resuelta', 'La disputa se resolvió a favor del vendedor. Consulta el pedido para conocer los detalles.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'seller' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_seller', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

-- fn_resolve_dispute_to_seller_as_admin: from 20261027001250_remove_wallet_writes_disputes.sql, body from supabase/queries/disputes/fn_resolve_dispute_to_seller_as_admin.sql.
CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_seller_as_admin(p_dispute_id uuid, p_admin_note text, p_admin_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_status public.dispute_status;
    v_audit_id UUID;
BEGIN
    -- A. SECURITY: Actor supplied only by the verified-admin service boundary
    v_auth_user_id := p_admin_id;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_ACTOR';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila
    SELECT order_id, seller_id, buyer_id, status, shipment_id
    INTO v_order_id, v_seller_id, v_buyer_id, v_status, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    -- Permitimos resolver a favor del vendedor si está en investigación o si ya recibió el retorno (pero impugnó)
    IF v_status NOT IN ('open', 'under_review', 'return_delivered', 'waiting_return') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. PAGO: Stripe Connect releases the seller's funds from the admin payout
    -- queue once the shipment is completed (F.1). Nothing moves in this function.

    -- F. ACTUALIZAR ESTADOS: Cerrar caso
    UPDATE public.disputes
    SET status = 'resolved',
        resolution_type = 'seller',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- F.1 Actualizar a nivel shipment (post-migration) u order (pre-migration)
    IF v_shipment_id IS NOT NULL THEN
        UPDATE public.shipments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_shipment_id;
    ELSE
        UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id;
    END IF;

    -- G. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_RESOLVE_SELLER', p_dispute_id, jsonb_build_object('order_id', v_order_id, 'note', p_admin_note))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text
             || COALESCE('?shipment_id=' || v_shipment_id::text, ''),
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_seller_id, 'seller', 'success', 'Disputa resuelta a tu favor', 'El equipo de Selene resolvió la disputa a tu favor. Una vez liberado el pago, el depósito puede tardar 1–4 días hábiles, dependiendo de tu banco. Consulta el estado del pago en tu pedido.'),
        (v_buyer_id, 'buyer', 'warning', 'Disputa resuelta a favor del vendedor', 'El equipo de Selene resolvió la disputa a favor del vendedor. No se aprobó un reembolso para esta disputa. Consulta los detalles en tu pedido.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'seller' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_seller', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

COMMIT;
