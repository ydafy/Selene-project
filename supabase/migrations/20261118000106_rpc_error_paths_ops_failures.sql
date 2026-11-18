SET local check_function_bodies = off;

-- odd/tasks/table-cleanup.md T6b (S6d), closes #153. RPC and trigger error
-- handlers stop writing system_logs. A handler that answers a value records
-- the unexpected error in internal.ops_failures and answers its generic code,
-- never SQLERRM. A handler that logged and re-raised is removed: the RAISE
-- rolled its log row back, and the caller still gets the same error.
-- fn_release_shipment_funds loses its handler too: an unexpected error reaches
-- the caller, and fn_cron_dispute_shipping_timeout records it per dispute.

CREATE OR REPLACE FUNCTION public.fn_admin_toggle_verified_seller (
  p_target_user_id uuid,
  p_is_verified    boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- 1. SEGURIDAD: Obtener ID desde JWT autenticado
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    -- A refused caller gets false, as an unexpected error does, but it is not a failure to record.
    IF v_auth_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- 2. VALIDACIÓN DE ROL: Buscar en profiles_private vía is_admin()
    IF NOT is_admin() THEN
        RETURN false;
    END IF;

    -- 3. ACTUALIZAR SELLO EN PROFILES (is_verified_seller vive en profiles)
    UPDATE public.profiles
    SET is_verified_seller = p_is_verified,
        updated_at = now()
    WHERE id = p_target_user_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false;
    END IF;

    -- 4. AUDITORÍA: Registrar cambio en bitácora
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_VERIFICATION_TOGGLE', p_target_user_id,
           jsonb_build_object('is_verified', p_is_verified, 'timestamp', now()));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_admin_toggle_verified_seller', SQLSTATE,
            jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_update_user_status (
  p_target_user_id uuid,
  p_new_status     public.account_status,
  p_reason         text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$

DECLARE
    v_auth_user_id UUID;
    v_previous_status public.account_status;
BEGIN
    -- A. SECURITY: the actor is the authenticated JWT subject
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. ROLE CHECK: active admins only
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    IF p_target_user_id = v_auth_user_id THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS';
    END IF;

    -- A NULL status reads as active everywhere, so it would silently lift bans and holds
    IF p_new_status IS NULL THEN
        RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS';
    END IF;

    -- C. LOCK TARGET: serialize concurrent status changes for the same account
    SELECT COALESCE(status, 'active')
    INTO v_previous_status
    FROM public.profiles_private
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Banned is final; same-status updates only refresh reason and audit
    IF v_previous_status = 'banned' AND p_new_status <> 'banned' THEN
        RAISE EXCEPTION 'BANNED_IS_FINAL';
    END IF;

    UPDATE public.profiles_private
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text,
        status_updated_at = now()
    WHERE id = p_target_user_id;

    -- D. INVENTORY: hold listings and remember their prior status
    IF p_new_status IN ('suspended', 'banned') THEN
        UPDATE public.products
        SET status_before_account_hold = COALESCE(status_before_account_hold, status),
            status = 'hidden'::public.product_status,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND deleted_at IS NULL
        AND status = ANY(ARRAY['verified', 'pending_verification', 'in_review']::public.product_status[]);

    -- Lifting a suspension restores only listings this hold hid; other hidden listings stay hidden
    ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN
        UPDATE public.products
        SET status = status_before_account_hold,
            status_before_account_hold = NULL,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'hidden'::public.product_status
        AND status_before_account_hold IS NOT NULL
        AND deleted_at IS NULL;

        -- Listings an admin moved out of hidden during the suspension keep no stale hold
        UPDATE public.products
        SET status_before_account_hold = NULL
        WHERE seller_id = p_target_user_id
        AND status_before_account_hold IS NOT NULL
        AND status <> 'hidden'::public.product_status;
    END IF;

    -- E. ADMIN AUDIT LOG
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('previous_status', v_previous_status::text, 'new_status', p_new_status::text, 'reason', p_reason));

    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_buyer_submit_return_evidence (
  p_dispute_id uuid,
  p_images     text[]
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$

DECLARE
v_buyer_id UUID;
v_auth_user_id UUID;
v_status public.dispute_status;
v_order_id UUID;
BEGIN
-- 1. Identidad
v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
IF v_auth_user_id IS NULL THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;

    -- 2. Bloqueo y Validación
    SELECT buyer_id, status, order_id INTO v_buyer_id, v_status, v_order_id
    FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_buyer_id != v_auth_user_id THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;
    IF v_status != 'waiting_return' THEN RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN; END IF;

    -- 3. Validar input
    IF p_images IS NULL OR array_length(p_images, 1) < 1 THEN
        RETURN QUERY SELECT false, 'AT_LEAST_ONE_IMAGE_REQUIRED'::TEXT; RETURN;
    END IF;
    -- Evidence paths: each image is the caller's upload for this order in the evidence bucket.
    IF EXISTS (
        SELECT 1 FROM unnest(p_images) AS evidence(path)
        WHERE (evidence.path ~ ('^returns/' || v_order_id::text || '/' || v_auth_user_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$')
               AND strpos(evidence.path, '..') = 0) IS NOT TRUE
    ) THEN
        RETURN QUERY SELECT false, 'INVALID_EVIDENCE_PATH'::TEXT; RETURN;
    END IF;

    -- 4. Ejecutar
    UPDATE public.disputes
    SET buyer_evidence = buyer_evidence || jsonb_build_object('return_images', p_images),
        updated_at = now()
    WHERE id = p_dispute_id;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
INSERT INTO internal.ops_failures (source, code, context)
VALUES ('fn_buyer_submit_return_evidence', SQLSTATE, jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
RETURN QUERY SELECT false, 'INTERNAL_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancel_shipment (
  p_shipment_id             uuid,
  p_cancelled_by_role       text,
  p_reason                  text,
  p_cancellation_loss_cents bigint DEFAULT NULL::bigint
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status;
  v_buyer_id UUID;
  v_actual_stripe_fee_cents BIGINT;
  v_cancellation_loss_cents BIGINT;
  v_loss_update_cents BIGINT;
  v_next_cancellation_loss_cents BIGINT;
  v_refund_status TEXT;
  v_refund_resolved_at TIMESTAMPTZ;
BEGIN
  -- 1. Lock shipment and validate eligibility.
  SELECT order_id, seller_id, status
    INTO v_order_id, v_seller_id, v_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('paid', 'preparing') THEN
    RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
    RETURN;
  END IF;

  -- 2. Service-role-only mutation; Edge Functions/crons validate the actor.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  IF p_cancelled_by_role NOT IN ('buyer', 'seller', 'system') THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  -- The Stripe refund must be recorded as succeeded before the business
  -- cancellation: every caller records it first, so a missing operation or a
  -- NULL status means no confirmed refund. The one exception is a failed or
  -- canceled refund an admin resolved (fn_resolve_shipment_cancellation_refund).
  SELECT refund_status, refund_resolved_at INTO v_refund_status, v_refund_resolved_at
  FROM public.shipment_cancellation_operations
  WHERE shipment_id = p_shipment_id;

  IF v_refund_status IS DISTINCT FROM 'succeeded' AND v_refund_resolved_at IS NULL THEN
    RETURN QUERY SELECT false, 'REFUND_NOT_SUCCEEDED'::TEXT;
    RETURN;
  END IF;

  -- 3. Lock order for refund-loss reconciliation.
  SELECT buyer_id, actual_stripe_fee_cents, cancellation_loss_cents
    INTO v_buyer_id, v_actual_stripe_fee_cents, v_cancellation_loss_cents
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- 4. Release products before publishing the shipment transition.
  PERFORM public.fn_release_listings(
    ARRAY(
      SELECT oi.product_id
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.shipment_id = p_shipment_id
    ),
    false,
    false
  );

  -- 5. Mark the shipment cancelled and persist any reconciled loss.
  UPDATE public.shipments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_shipment_id;

  IF p_cancellation_loss_cents IS NOT NULL AND v_actual_stripe_fee_cents IS NOT NULL THEN
    v_loss_update_cents := p_cancellation_loss_cents;
    v_next_cancellation_loss_cents := LEAST(
      COALESCE(v_actual_stripe_fee_cents, 0),
      COALESCE(v_cancellation_loss_cents, 0) + v_loss_update_cents
    );

    UPDATE public.orders
    SET cancellation_loss_cents = v_next_cancellation_loss_cents,
        updated_at = now()
    WHERE id = v_order_id;
  END IF;

  -- One notice per distinct recipient for this committed shipment transition.
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  )
  SELECT recipients.user_id,
         'shipment.cancelled',
         'shipment.cancelled:' || p_shipment_id::text,
         jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                            'recipient_role', recipients.recipient_role),
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'info' ELSE 'warning' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Pedido cancelado'
              ELSE 'Venta cancelada' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Se canceló un envío de tu pedido.'
              ELSE 'Se canceló tu envío; los productos regresaron a tu inventario.' END,
         '/profile/orders/' || v_order_id::text
           || COALESCE('?shipment_id=' || p_shipment_id::text, '')
  -- WHERE true disambiguates INSERT ... SELECT from JOIN ON before ON CONFLICT.
  FROM (
    SELECT v_buyer_id AS user_id, 'buyer' AS recipient_role
    UNION ALL
    SELECT v_seller_id, 'seller' WHERE v_seller_id IS DISTINCT FROM v_buyer_id
  ) recipients
  WHERE true
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO internal.ops_failures (source, code, context)
  VALUES ('fn_cancel_shipment', SQLSTATE,
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_confirm_shipment_delivery (
  p_shipment_id     uuid,
  p_source          text,
  p_actor_id        uuid,
  p_idempotency_key text
)
  RETURNS TABLE (
    success           boolean,
    error             text,
    completion_source text,
    idempotent        boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_buyer_confirmed_at timestamptz;
  v_is_connect BOOLEAN;
  v_completion_source text;
  v_completed_at timestamptz := now();
BEGIN
  IF coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) <> 'service_role' THEN
    RETURN QUERY SELECT false, 'SERVICE_ROLE_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('buyer', 'auto') THEN
    RETURN QUERY SELECT false, 'INVALID_COMPLETION_SOURCE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN QUERY SELECT false, 'IDEMPOTENCY_KEY_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer'
    AND p_idempotency_key <> 'confirm_shipment_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'auto'
    AND p_idempotency_key <> 'auto_completion_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  SELECT
    s.order_id,
    s.status,
    s.delivered_at,
    s.buyer_confirmed_at,
    s.stripe_payment_intent_id IS NOT NULL
  INTO
    v_order_id,
    v_status,
    v_delivered_at,
    v_buyer_confirmed_at,
    v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text, NULL::text, false;
    RETURN;
  END IF;

  IF v_status = 'completed' THEN
    SELECT event.source
    INTO v_completion_source
    FROM public.shipment_completion_events AS event
    WHERE event.shipment_id = p_shipment_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'COMPLETION_AUDIT_MISSING'::text, NULL::text, false;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::text, v_completion_source, true;
    RETURN;
  END IF;

  -- Read after the shipment lock, like fn_begin_shipment_transfer: a started cancellation
  -- operation means a refund was requested, so the shipment must end cancelled, never completed.
  IF EXISTS (
    SELECT 1
    FROM public.shipment_cancellation_operations AS operation
    WHERE operation.shipment_id = p_shipment_id
      AND operation.external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF NOT v_status = 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer' THEN
    SELECT buyer_id INTO v_buyer_id
    FROM public.orders
    WHERE id = v_order_id;

    IF p_actor_id IS NULL OR v_buyer_id IS DISTINCT FROM p_actor_id THEN
      RETURN QUERY SELECT false, 'BUYER_REQUIRED'::text, NULL::text, false;
      RETURN;
    END IF;
  ELSIF p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  ELSIF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse them before any state changes.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text, NULL::text, false;
    RETURN;
  END IF;

  INSERT INTO public.shipment_completion_events (
    shipment_id,
    order_id,
    source,
    actor_id,
    idempotency_key,
    completed_at,
    is_connect
  ) VALUES (
    p_shipment_id,
    v_order_id,
    p_source,
    p_actor_id,
    p_idempotency_key,
    v_completed_at,
    v_is_connect
  );

  UPDATE public.shipments
  SET status = 'completed',
      completed_at = v_completed_at,
      buyer_confirmed_at = CASE
        WHEN p_source = 'buyer' THEN v_completed_at
        ELSE buyer_confirmed_at
      END,
      updated_at = v_completed_at
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::text, p_source, false;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO internal.ops_failures (source, code, context)
  VALUES ('fn_confirm_shipment_delivery', SQLSTATE,
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::text, NULL::text, false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_lock_dispute (
  p_dispute_id uuid
)
  RETURNS TABLE (
    success     boolean,
    locker_name text,
    locked_at   timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_current_locker_id UUID;
    v_current_locker_name TEXT;
    v_current_locked_at TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    SELECT d.locked_by, p.username, d.locked_at
    INTO v_current_locker_id, v_current_locker_name, v_current_locked_at
    FROM public.disputes d
    LEFT JOIN public.profiles p ON p.id = d.locked_by
    WHERE d.id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'DISPUTE_NOT_FOUND'; END IF;

    -- Caso 1: Libre o expirado
    IF v_current_locker_id IS NULL OR v_current_locked_at < (now() - interval '10 minutes') THEN
        UPDATE public.disputes SET locked_by = v_auth_user_id, locked_at = now() WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_LOCK_ACQUIRED', p_dispute_id, jsonb_build_object('prev_locker', v_current_locker_id));

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 2: Ya es mío (Renovación - FIX APLICADO)
    ELSIF v_current_locker_id = v_auth_user_id THEN
        UPDATE public.disputes SET locked_at = now() WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_LOCK_RENEWED', p_dispute_id, jsonb_build_object('timestamp', now()));

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 3: Ocupado
    ELSE
        RETURN QUERY SELECT false, v_current_locker_name, v_current_locked_at;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_mark_return_delivered (
  p_dispute_id uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
  INSERT INTO internal.ops_failures (source, code, context)
  VALUES ('fn_mark_return_delivered', SQLSTATE,
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_mark_shipment_delivered (
  p_shipment_id uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_current_status TEXT;
BEGIN
  -- 1. Validar shipment y aplicar Bloqueo Pesimista (FOR UPDATE)
  -- Esto evita condiciones de carrera si el comprador confirma manualmente al mismo milisegundo que corre el cron.
  SELECT status::TEXT INTO v_current_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE; -- ← FIX CRÍTICO: Previene la sobreescritura destructiva de estados

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 1b. Un reembolso de cancelación ya iniciado: la cancelación debe terminar, el envío no avanza.
  -- Mismo predicado que fn_begin_shipment_transfer, leído tras el bloqueo del envío.
  IF EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id AND external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en tránsito (o empaque si se saltó el scan de tránsito)
  IF v_current_status NOT IN ('shipped', 'preparing') THEN
    RETURN QUERY SELECT false, format('INVALID_SHIPMENT_STATUS: %s', v_current_status); RETURN;
  END IF;

  -- 3. Marcar como entregado — SOLO inicia el reloj de 48h, NO libera fondos
  UPDATE public.shipments
  SET status = 'delivered',
      delivered_at = now(),
      updated_at = now()
  WHERE id = p_shipment_id;

  -- 4. Buyer notice, once per shipment (the carrier delivered scan writes the same key).
  PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.delivered');

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO internal.ops_failures (source, code, context)
  VALUES ('fn_mark_shipment_delivered', SQLSTATE,
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_release_shipment_funds (
  p_shipment_id uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_is_connect boolean;
BEGIN
  SELECT s.status, s.delivered_at, s.stripe_payment_intent_id IS NOT NULL
  INTO v_status, v_delivered_at, v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text; RETURN;
  END IF;

  -- Shipments without a Stripe payment intent have no payout path since the
  -- internal balance was removed: refuse instead of completing without a payout.
  IF NOT v_is_connect THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text; RETURN;
  END IF;

  -- A completed shipment becomes payable from the admin payout queue, so it
  -- completes only after delivery, with no open dispute, past the grace period.
  IF v_status IS DISTINCT FROM 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_DELIVERED'::text; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_IN_ACTIVE_DISPUTE'::text; RETURN;
  END IF;

  IF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'GRACE_PERIOD_ACTIVE'::text; RETURN;
  END IF;

  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_buyer (
  p_dispute_id uuid,
  p_admin_note text
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_resolve_dispute_to_buyer', SQLSTATE, jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_buyer_as_admin (
  p_dispute_id uuid,
  p_admin_note text,
  p_admin_id   uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_resolve_dispute_to_buyer_as_admin', SQLSTATE, jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_seller (
  p_dispute_id uuid,
  p_admin_note text
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_resolve_dispute_to_seller', SQLSTATE, jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_seller_as_admin (
  p_dispute_id uuid,
  p_admin_note text,
  p_admin_id   uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_resolve_dispute_to_seller_as_admin', SQLSTATE, jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_seller_initiate_return_label (
  p_dispute_id uuid,
  p_caller_id  uuid
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_seller_id   UUID;
  v_status      TEXT;
  v_shipment_id UUID;
BEGIN
  -- 1. Validar dispute existe
  SELECT d.seller_id, d.status::TEXT, d.shipment_id
  INTO v_seller_id, v_status, v_shipment_id
  FROM public.disputes d WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Validar caller es el seller legítimo de la disputa
  IF v_seller_id IS DISTINCT FROM p_caller_id THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Validar dispute en estado correcto (Esperando guía de retorno)
  IF v_status IS DISTINCT FROM 'waiting_return' THEN
    RETURN QUERY SELECT false,
      format('INVALID_DISPUTE_STATUS: %s', v_status)::TEXT;
    RETURN;
  END IF;

  -- 4. Authorized. create-return-intent creates the payment and
  -- fn_log_return_payment records it on the dispute; no log row.
  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  -- The raw error stays server-side (cron-watchdog reports it); the caller gets a code.
  INSERT INTO internal.ops_failures (source, code, context)
  VALUES ('fn_seller_initiate_return_label', SQLSTATE,
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_seller_submit_return_evidence (
  p_dispute_id uuid,
  p_images     text[],
  p_video_url  text   DEFAULT NULL::text
)
  RETURNS TABLE (
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
    -- Evidence paths: each image and the video are the caller's uploads for this order in the evidence bucket.
    IF EXISTS (
        SELECT 1 FROM unnest(p_images || p_video_url) AS evidence(path)
        WHERE (evidence.path ~ ('^disputes/' || v_order_id::text || '/' || v_auth_user_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$')
               AND strpos(evidence.path, '..') = 0) IS NOT TRUE
    ) THEN
        RETURN QUERY SELECT false, 'INVALID_EVIDENCE_PATH'::TEXT; RETURN;
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
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_seller_submit_return_evidence', SQLSTATE,
            jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, 'EVIDENCE_SUBMISSION_FAILED'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_trigger_review_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    -- Llamamos al trabajador que actualizamos en el Paso 1
    PERFORM internal.fn_refresh_seller_stats(COALESCE(NEW.seller_id, OLD.seller_id));
    
    RETURN NULL; -- Correcto para triggers AFTER
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_unlock_dispute (
  p_dispute_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- FIX APLICADO: Manejo explícito de NULL en el tiempo de bloqueo
    UPDATE public.disputes
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = p_dispute_id
    AND (
        locked_by = v_auth_user_id
        OR locked_at IS NULL
        OR locked_at < (now() - interval '10 minutes')
    );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_UNLOCK', p_dispute_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;
END;
$function$;

COMMENT ON TABLE "internal"."ops_failures" IS 'Failures that a cron or trigger catches and continues past, or that an RPC catches and answers with a generic code, with no other record: source is the function, code a SQLSTATE or a named reason, context the ids involved (never personal data or secrets). cron-watchdog reports each row to Sentry and deletes it.';
