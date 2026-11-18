SET local check_function_bodies = off;

-- odd/tasks/table-cleanup.md T6a (S6a, S6c). internal.ops_failures records a
-- failure that a cron or trigger catches and continues past, which nothing
-- else records; the dispute crons, fn_notify_held_payouts, the notice failures
-- of fn_complete_shipment_transfer and fn_record_dispute_refund,
-- fn_refresh_seller_stats and fn_update_product_fts write it instead of
-- system_logs. Writers whose fact is stored elsewhere stop writing:
-- the hourly return-delivery summary (cron.job_run_details), dispute opened
-- (the dispute row), return label initiated, dispute refund recorded (the
-- dispute notes and the Stripe refund) and the deprecated wallet skip (the
-- completion event).
-- Growth (docs/conventions.md, "Design target"): one row per swallowed
-- failure, normally none; a failure that repeats adds one row per cron run,
-- hourly at most. cron-watchdog reports each row to Sentry and deletes it
-- (T6c, S6b), so the table stays small and needs no index beyond its key.
-- Grants: RLS on with no policy; anon and authenticated get nothing (default
-- privileges); service_role gets SELECT and DELETE to drain it and never
-- writes. Only SECURITY DEFINER functions owned by postgres insert.
CREATE TABLE "internal"."ops_failures" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source"      text                     NOT NULL,
  "code"        text                     NOT NULL,
  "context"     jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_failures_code_check" CHECK ((btrim(code) <> ''::text)),
  CONSTRAINT "ops_failures_context_check" CHECK ((jsonb_typeof(context) = 'object'::text)),
  CONSTRAINT "ops_failures_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_failures_source_check" CHECK ((btrim(source) <> ''::text))
);

ALTER TABLE "internal"."ops_failures"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION internal.fn_notify_held_payouts()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_row record;
  v_key text;
  v_is_reminder boolean;
  v_inserted integer;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT v.shipment_id,
           v.seller_id,
           v.order_id,
           v.release_amount_cents,
           v.seller_payout_block_reason AS block_reason,
           CASE
             WHEN v.days_since_completed >= 14 THEN 14
             WHEN v.days_since_completed >= 7 THEN 7
             WHEN v.days_since_completed >= 3 THEN 3
             ELSE 0
           END AS stage
    FROM public.admin_connect_payout_release_view AS v
    WHERE v.status = 'completed'
      AND v.completed_at IS NOT NULL
      AND v.days_since_completed >= 0
      AND v.stripe_payment_intent_id IS NOT NULL
      AND v.stripe_transfer_id IS NULL
      AND v.release_amount_cents > 0
      AND v.ineligible_reason IS DISTINCT FROM 'active_dispute'
      AND v.payout_run_status IS DISTINCT FROM 'paid'
      AND v.seller_payout_block_reason IN (
        'onboarding_rejected',
        'onboarding_pending',
        'payouts_disabled',
        'errored',
        'verification_failed',
        'tokenized_account_number_deactivated'
      )
    ORDER BY v.completed_at, v.shipment_id
  LOOP
    BEGIN
      v_key := 'shipment.payout_blocked:' || v_row.shipment_id::text || ':' || v_row.stage::text;

      SELECT EXISTS (
        SELECT 1
        FROM public.notifications AS n
        WHERE n.user_id = v_row.seller_id
          AND n.source_event_key = ANY (ARRAY(
            SELECT 'shipment.payout_blocked:' || v_row.shipment_id::text || ':' || s.stage::text
            FROM unnest(ARRAY[0, 3, 7, 14]) AS s(stage)
            WHERE s.stage <> v_row.stage
          ))
      ) INTO v_is_reminder;

      INSERT INTO public.notifications (
        user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
      ) VALUES (
        v_row.seller_id,
        'shipment.payout_blocked',
        v_key,
        jsonb_build_object(
          'order_id', v_row.order_id,
          'shipment_id', v_row.shipment_id,
          'amount_cents', v_row.release_amount_cents,
          'currency', 'mxn',
          'recipient_role', 'seller',
          'block_reason', v_row.block_reason,
          'reminder_stage', v_row.stage,
          'is_reminder', v_is_reminder
        ),
        'warning',
        CASE WHEN v_is_reminder THEN 'Tu pago sigue retenido' ELSE 'No podemos enviarte el pago de una venta' END,
        CASE v_row.block_reason
          WHEN 'onboarding_rejected' THEN 'Stripe rechazó tu cuenta de cobro.'
          WHEN 'onboarding_pending' THEN 'Stripe necesita más datos de tu cuenta de cobro.'
          WHEN 'payouts_disabled' THEN 'Stripe pausó los pagos a tu cuenta.'
          ELSE 'Tu cuenta bancaria tiene un problema.'
        END
          || ' Revisa tu configuración de pagos para recibir $'
          || to_char(v_row.release_amount_cents / 100.0, 'FM999,999,990.00') || ' MXN.',
        '/sell/onboarding'
      )
      ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_count := v_count + v_inserted;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO internal.ops_failures (source, code, context) VALUES ('fn_notify_held_payouts', SQLSTATE,
        jsonb_build_object('shipment_id', v_row.shipment_id, 'stage', v_row.stage, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.fn_refresh_seller_stats (
  p_seller_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_avg_rating NUMERIC;
    v_rev_count INTEGER;
    v_sales_count INTEGER;
BEGIN
    -- 1. Cálculo de reseñas en un solo escaneo
    SELECT 
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0.0),
        COUNT(*)
    INTO v_avg_rating, v_rev_count
    FROM public.reviews
    WHERE seller_id = p_seller_id;

    -- 2. Cálculo de ventas completadas
    SELECT COUNT(DISTINCT o.id)
    INTO v_sales_count
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE oi.seller_id = p_seller_id
    AND o.status = 'completed';

    -- 3. Actualización atómica en el perfil
    UPDATE public.profiles
    SET
        average_rating = v_avg_rating,
        total_reviews = v_rev_count,
        total_sales = v_sales_count
    WHERE id = p_seller_id;

EXCEPTION WHEN OTHERS THEN
    -- The review write goes on; the failure is recorded for cron-watchdog.
    INSERT INTO internal.ops_failures (source, code, context)
    VALUES ('fn_refresh_seller_stats', SQLSTATE,
            jsonb_build_object('seller_id', p_seller_id, 'error', SQLERRM));
END;
$function$;

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
        'amount_cents', v_mapping.net_payout_cents, 'currency', 'mxn', 'recipient_role', 'seller'),
      'success',
      'Liberamos el pago de tu venta',
      'Enviamos $' || to_char(v_mapping.net_payout_cents / 100.0, 'FM999,999,990.00')
        || ' MXN a tu cuenta de vendedor. El depósito a tu banco puede tardar unos días hábiles.',
      '/profile/orders/' || v_shipment.order_id::text
        || COALESCE('?shipment_id=' || p_shipment_id::text, '')
    )
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO internal.ops_failures (source, code, context) VALUES ('fn_complete_shipment_transfer', SQLSTATE,
      jsonb_build_object('run_id', p_run_id, 'shipment_id', p_shipment_id, 'error', SQLERRM));
  END;
  -- Never clear the possible-effect fence, including on idempotent completion.
  RETURN true;
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
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'ERROR',
    'Shipment completion RPC failed',
    jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE)
  );
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::text, NULL::text, false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cron_dispute_payout_timeout()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
    v_dispute RECORD;
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
                ELSE
                    -- No Stripe payment intent: needs manual intervention.
                    INSERT INTO internal.ops_failures (source, code, context)
                    VALUES ('fn_cron_dispute_payout_timeout', 'SHIPMENT_NOT_CONNECT',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
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
            INSERT INTO internal.ops_failures (source, code, context)
            VALUES ('fn_cron_dispute_payout_timeout', SQLSTATE,
                    jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', SQLERRM));
        END;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cron_dispute_shipping_timeout()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
                INSERT INTO internal.ops_failures (source, code, context)
                VALUES ('fn_cron_dispute_shipping_timeout', 'DISPUTE_WITHOUT_SHIPMENT',
                        jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id));
            END IF;
        EXCEPTION
            WHEN SQLSTATE 'SR001' THEN
                -- La resolución ya se revirtió con el bloque
                INSERT INTO internal.ops_failures (source, code, context)
                VALUES ('fn_cron_dispute_shipping_timeout', 'RELEASE_REFUSED',
                        jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
            WHEN OTHERS THEN
                -- Atrapar excepciones DB sin abortar el resto del lote
                INSERT INTO internal.ops_failures (source, code, context)
                VALUES ('fn_cron_dispute_shipping_timeout', SQLSTATE,
                        jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', SQLERRM));
        END;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cron_return_delivery_timeout()
  RETURNS TABLE (
    total_processed integer,
    total_errors    integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
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
        -- No Stripe payment intent: needs manual intervention.
        INSERT INTO internal.ops_failures (source, code, context)
        VALUES ('fn_cron_return_delivery_timeout', 'SHIPMENT_NOT_CONNECT',
                jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO internal.ops_failures (source, code, context)
      VALUES ('fn_cron_return_delivery_timeout', SQLSTATE,
              jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  -- cron.job_run_details records the run; the counts are returned, not logged.
  RETURN QUERY SELECT v_processed, v_errors;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_on_dispute_opened()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    -- Cambiar estado de la orden
    UPDATE public.orders
    SET status = 'dispute',
        updated_at = now()
    WHERE id = NEW.order_id;
    -- The dispute row records the opening; no log row.

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_record_dispute_refund (
  p_dispute_id       uuid,
  p_stripe_refund_id text
)
  RETURNS TABLE (
    success    boolean,
    error_code text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
  -- The dispute notes above and the Stripe refund are the record; no log row.

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
      INSERT INTO internal.ops_failures (source, code, context)
      VALUES ('fn_record_dispute_refund', SQLSTATE,
              jsonb_build_object('dispute_id', p_dispute_id, 'shipment_id', v_shipment_id, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Refund notice failed and could not be recorded: %', SQLERRM;
    END;
  END;

  RETURN QUERY SELECT true, NULL::TEXT;
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
  -- FIX: Inyectamos el insert de telemetría para mantener consistencia absoluta
  -- con todo el sistema de diagnóstico de errores del proyecto.
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_seller_initiate_return_label',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_update_product_fts()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_specs_text TEXT := '';
BEGIN
  -- A. NULL SAFETY: Extraemos valores del JSONB solo si no es nulo
  -- Esto permite buscar por "8GB" o "NVIDIA" aunque estén dentro del JSONB
  IF NEW.specifications IS NOT NULL AND NEW.specifications != '{}'::jsonb THEN
    SELECT string_agg(value, ' ') INTO v_specs_text
    FROM jsonb_each_text(NEW.specifications);
  END IF;

  -- B. CONSTRUCCIÓN DEL ÍNDICE (Diccionario 'simple')
  -- Combinamos Nombre, Categoría, Descripción y Especificaciones
  NEW.fts :=
    to_tsvector('simple', coalesce(NEW.name, '')) ||
    to_tsvector('simple', coalesce(NEW.category, '')) ||
    to_tsvector('simple', coalesce(NEW.description, '')) ||
    to_tsvector('simple', coalesce(v_specs_text, ''));

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Si el buscador falla, registramos el error pero no bloqueamos la venta
  INSERT INTO internal.ops_failures (source, code, context)
  VALUES ('fn_update_product_fts', SQLSTATE,
          jsonb_build_object('product_id', NEW.id, 'error', SQLERRM));

  RETURN NEW;
END;
$function$;

COMMENT ON TABLE "internal"."ops_failures" IS 'Failures that a cron or trigger catches and continues past, with no other record: source is the function, code a SQLSTATE or a named reason, context the ids involved (never personal data or secrets). cron-watchdog reports each row to Sentry and deletes it.';

GRANT DELETE, SELECT ON TABLE "internal"."ops_failures" TO "service_role";
