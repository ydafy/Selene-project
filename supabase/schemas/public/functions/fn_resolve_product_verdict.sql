CREATE OR REPLACE FUNCTION public.fn_resolve_product_verdict (
  p_product_id   uuid,
  p_verdict      text,
  p_public_note  text DEFAULT NULL::text,
  p_private_note text DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_verification_id UUID;
  v_private_note_id UUID;
  v_locked_by UUID;
  v_lock_time TIMESTAMPTZ;
  v_seller_id UUID;
  v_product_name TEXT;
  v_status public.product_status;
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
  SELECT p.seller_id, p.name, p.status
  INTO v_seller_id, v_product_name, v_status
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  -- The lock and the decision live on the listing's open verification
  -- attempt (odd/tasks/verification-history.md S4, S5).
  SELECT v.id, v.locked_by, v.locked_at
  INTO v_verification_id, v_locked_by, v_lock_time
  FROM public.product_verifications v
  WHERE v.product_id = p_product_id
    AND v.decision IS NULL
  FOR UPDATE;

  -- Without an open attempt there is no lock. The same verdict repeated after
  -- the attempt was decided writes nothing.
  IF v_verification_id IS NULL THEN
    IF (p_verdict = 'APPROVE' AND v_status = 'verified')
       OR (p_verdict = 'REJECT' AND v_status = 'rejected') THEN
      RETURN true;
    END IF;
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
  END IF;

  -- 4. Validar concurrencia: que el bloqueo siga perteneciendo al administrador y no haya expirado (10 min)
  IF v_locked_by IS NULL OR v_locked_by IS DISTINCT FROM v_auth_user_id OR v_lock_time < (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
  END IF;

  IF (p_verdict = 'APPROVE' AND v_status = 'verified')
     OR (p_verdict = 'REJECT' AND v_status = 'rejected') THEN
    UPDATE public.product_verifications
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = v_verification_id;
    RETURN true;
  END IF;

  IF p_verdict IS DISTINCT FROM 'APPROVE' AND p_verdict IS DISTINCT FROM 'REJECT' THEN
    RAISE EXCEPTION 'INVALID_VERDICT_VALUE';
  END IF;

  IF p_verdict = 'REJECT' AND COALESCE(trim(p_public_note), '') = '' THEN
    RAISE EXCEPTION 'REJECTION_NOTE_REQUIRED';
  END IF;

  -- 5. Insertar Nota Privada de Inteligencia del Admin (Solo si fue proporcionada)
  IF p_private_note IS NOT NULL AND trim(p_private_note) <> '' THEN
    INSERT INTO public.admin_user_notes (user_id, admin_id, content)
    VALUES (v_seller_id, v_auth_user_id, trim(p_private_note))
    RETURNING id INTO v_private_note_id;
  END IF;

  -- 6. Cerrar el intento con la decisión, liberar el lock y actualizar el estado del producto
  UPDATE public.product_verifications
  SET decision = CASE WHEN p_verdict = 'REJECT'
                   THEN 'rejected'::public.product_verification_decision
                   ELSE 'approved'::public.product_verification_decision END,
      decided_by = v_auth_user_id,
      decided_at = now(),
      public_note = NULLIF(trim(p_public_note), ''),
      private_note_id = v_private_note_id,
      locked_by = NULL,
      locked_at = NULL
  WHERE id = v_verification_id;

  UPDATE public.products
  SET status = CASE WHEN p_verdict = 'REJECT'
                 THEN 'rejected'::public.product_status
                 ELSE 'verified'::public.product_status END,
      updated_at = now()
  WHERE id = p_product_id;

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
      'verdict', p_verdict,
      'verification_id', v_verification_id
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_product_verdict"(uuid, text, text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_product_verdict"(uuid, text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_resolve_product_verdict"(uuid, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_resolve_product_verdict"(uuid, text, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_resolve_product_verdict"(uuid, text, text, text) FROM PUBLIC, "anon";
