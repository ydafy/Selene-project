-- N5d: apply only after N4b, N4a, N5a, N5b and N5c. Confirm deployed
-- buyer RPC body and search_path match before manual cutover; this preflight
-- rejects unexpected function settings. Submit whole file in one transaction;
-- on uncertain execution inspect the deployed state before retrying.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_dispute_to_buyer'
      AND p.oid = 'public.fn_resolve_dispute_to_buyer(uuid,text)'::regprocedure
      AND p.prosecdef
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Buyer dispute RPC signature, authority or security settings differ';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.admin_audit_logs'::regclass
      AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype
      AND a.attnotnull AND NOT a.attisdropped
      AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()'
  ) THEN
    RAISE EXCEPTION 'Expected UUID audit occurrence identity is absent';
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
    RAISE EXCEPTION 'N4b restrictive notification grants required before N5d';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_attribute key_column
      ON key_column.attrelid = i.indrelid AND key_column.attnum = i.indkey[0]
    JOIN pg_catalog.pg_attribute recipient_column
      ON recipient_column.attrelid = i.indrelid AND recipient_column.attnum = i.indkey[1]
    WHERE i.indrelid = 'public.notifications'::regclass
      AND c.relname = 'notifications_source_event_key_user_id_uidx'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts = 2 AND i.indnatts = 2
      AND key_column.attname = 'source_event_key'
      AND recipient_column.attname = 'user_id'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'Expected N4a partial unique notification arbiter is absent or incompatible';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.fn_resolve_dispute_to_buyer(
  p_dispute_id UUID,
  p_admin_note TEXT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_status public.dispute_status;
    v_buyer_id UUID;
    v_seller_id UUID;
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
    SELECT order_id, status, buyer_id, seller_id
    INTO v_order_id, v_status, v_buyer_id, v_seller_id
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
           recipients.message, '/profile/orders/' || v_order_id::text,
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

COMMIT;
