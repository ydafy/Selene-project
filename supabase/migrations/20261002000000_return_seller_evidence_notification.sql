-- N5h: after N5g, N4b, N4a. Before Dashboard execution compare deployed
-- pg_get_functiondef and proconfig with the observed deployed legacy signature/body/settings.
-- Deployed legacy function has service-only EXECUTE and search_path=public.
-- Submit this entire transaction; preflight must fail closed on configuration drift.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_seller_submit_return_evidence'
      AND p.oid = 'public.fn_seller_submit_return_evidence(uuid,text[],text)'::regprocedure
      AND p.prosecdef
      AND p.pronargdefaults = 1
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proconfig = ARRAY['search_path=public']::text[]
  ) THEN
    RAISE EXCEPTION 'Seller return evidence RPC signature, authority or security settings differ';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM (VALUES ('anon'), ('authenticated')) AS roles(name)
       CROSS JOIN (VALUES ('event_kind'), ('source_event_key'), ('event_payload')) AS columns(name)
       WHERE has_column_privilege(roles.name, 'public.notifications', columns.name, 'INSERT')
          OR has_column_privilege(roles.name, 'public.notifications', columns.name, 'UPDATE')
     ) THEN
    RAISE EXCEPTION 'N4b restrictive notification grants required before N5h';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_attribute key_column ON key_column.attrelid = i.indrelid AND key_column.attnum = i.indkey[0]
    JOIN pg_catalog.pg_attribute recipient_column ON recipient_column.attrelid = i.indrelid AND recipient_column.attnum = i.indkey[1]
    WHERE i.indrelid = 'public.notifications'::regclass
      AND c.relname = 'notifications_source_event_key_user_id_uidx'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts = 2 AND i.indnatts = 2
      AND key_column.attname = 'source_event_key' AND recipient_column.attname = 'user_id'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'Expected N4a partial unique notification arbiter absent or incompatible';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.fn_seller_submit_return_evidence(p_dispute_id UUID, p_images TEXT[], p_video_url TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
            v_buyer_id, 'info', 'Evidencia del retorno recibida',
            'El vendedor presentó evidencia del retorno. Consulta el estado de tu caso.',
            '/profile/orders/' || v_order_id::text,
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
$function$;

GRANT EXECUTE ON FUNCTION public.fn_seller_submit_return_evidence(uuid,text[],text) TO authenticated;

DO $postcondition$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.fn_seller_submit_return_evidence(uuid,text[],text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_seller_submit_return_evidence(uuid,text[],text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_seller_submit_return_evidence(uuid,text[],text)', 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.fn_seller_submit_return_evidence(uuid,text[],text)'::regprocedure
         AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'Seller evidence RPC execution authority postcondition failed';
  END IF;
END;
$postcondition$;
COMMIT;
