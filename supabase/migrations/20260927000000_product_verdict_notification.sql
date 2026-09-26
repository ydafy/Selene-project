-- N5c: apply only after N4b, N4a, N5a and N5b. Confirm deployed RPC
-- body, ACL and older-client compatibility before manual Dashboard cutover.
-- Submit the whole file as one transaction; inspect before retrying uncertainty.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_product_verdict'
      AND p.oid = 'public.fn_resolve_product_verdict(uuid,text,text,text)'::regprocedure
      AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Verdict RPC ACL or security settings differ from expected baseline';
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
    RAISE EXCEPTION 'N4b restrictive notification grants required before N5c';
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

CREATE OR REPLACE FUNCTION public.fn_resolve_product_verdict(
  p_product_id UUID,
  p_verdict TEXT,
  p_public_note TEXT DEFAULT NULL,
  p_private_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_user_id UUID;
  v_locked_by UUID;
  v_lock_time TIMESTAMPTZ;
  v_seller_id UUID;
  v_product_name TEXT;
  v_status public.product_status_enum;
  v_audit_id UUID;
  v_event_kind TEXT;
  v_notif_title TEXT;
  v_notif_msg TEXT;
  v_notif_type TEXT;
  v_action_path TEXT;
BEGIN
  -- 1. Extraer ID del Administrador desde la sesión segura del JWT
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  -- 2. Validar que el usuario sea realmente un administrador
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- 3. Cargar datos del producto y bloquear la fila para actualización
  SELECT p.locked_by, p.locked_at, p.seller_id, p.name, p.status
  INTO v_locked_by, v_lock_time, v_seller_id, v_product_name, v_status
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  -- 4. Validar concurrencia: que el bloqueo siga perteneciendo al administrador y no haya expirado (10 min)
  IF v_locked_by IS NULL OR v_locked_by IS DISTINCT FROM v_auth_user_id OR v_lock_time < (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
  END IF;

  IF (p_verdict = 'APPROVE' AND v_status = 'VERIFIED')
     OR (p_verdict = 'REJECT' AND v_status = 'REJECTED') THEN
    UPDATE public.products
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = p_product_id;
    RETURN true;
  END IF;

  -- 5. Insertar Nota Privada de Inteligencia del Admin (Solo si fue proporcionada)
  IF p_private_note IS NOT NULL AND trim(p_private_note) <> '' THEN
    INSERT INTO public.admin_user_notes (user_id, admin_id, content)
    VALUES (v_seller_id, v_auth_user_id, trim(p_private_note));
  END IF;

  -- 6. Actualizar Estado del Producto y liberar el lock
  IF p_verdict = 'REJECT' THEN
    UPDATE public.products
    SET status = 'REJECTED'::public.product_status_enum,
        rejection_reason = trim(p_public_note),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_product_id;
  ELSIF p_verdict = 'APPROVE' THEN
    UPDATE public.products
    SET status = 'VERIFIED'::public.product_status_enum,
        rejection_reason = NULL,
        verified_at = now(),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_product_id;
  ELSE
    RAISE EXCEPTION 'INVALID_VERDICT_VALUE';
  END IF;

  -- 7. Registrar Log de Auditoría Administrativa (Corregido: p_product_id sin castear a texto)
  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    CASE WHEN p_verdict = 'REJECT' THEN 'PRODUCT_REJECT' ELSE 'PRODUCT_APPROVE' END,
    p_product_id, -- <-- FIX: Eliminamos el ::text para que coincida con el tipo UUID de la columna
    jsonb_build_object(
      'product_name', v_product_name,
      'seller_id', v_seller_id,
      'admin_note', trim(p_public_note),
      'verdict', p_verdict
    )
  )
  RETURNING id INTO v_audit_id;

  -- 8. Resolver textos dinámicos de la Notificación para el vendedor
  IF p_verdict = 'REJECT' THEN
    v_notif_title := 'Producto Rechazado';
    v_event_kind := 'product.rejected';
    v_notif_type := 'error';
    v_notif_msg := 'Tu producto "' || v_product_name || '" ha sido rechazado. Motivo: ' || COALESCE(trim(p_public_note), 'No especificado por el administrador.');
    v_action_path := '/verify/' || p_product_id::text;
  ELSE
    v_notif_title := 'Producto Verificado';
    v_action_path := '/product/' || p_product_id::text;
    IF p_public_note IS NOT NULL AND trim(p_public_note) <> '' THEN
      v_event_kind := 'product.approved_with_note';
      v_notif_type := 'warning';
      v_notif_msg := '¡Listo! Tu producto "' || v_product_name || '" ya está a la venta. Nota del administrador: ' || trim(p_public_note);
    ELSE
      v_event_kind := 'product.approved';
      v_notif_type := 'success';
      v_notif_msg := '¡Felicidades! Tu producto "' || v_product_name || '" ha sido aprobado por moderación.';
    END IF;
  END IF;

  -- 9. Insertar Notificación para el vendedor (Bypass seguro de RLS)
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  ) VALUES (
    v_seller_id,
    v_event_kind,
    v_event_kind || ':' || p_product_id::text || ':' || v_audit_id::text,
    jsonb_build_object('product_id', p_product_id, 'recipient_role', 'seller'),
    v_notif_title,
    v_notif_msg,
    v_notif_type,
    false,
    v_action_path
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN true;
END;
$$;

COMMIT;
