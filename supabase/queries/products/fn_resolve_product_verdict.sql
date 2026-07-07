
DECLARE
  v_auth_user_id UUID;
  v_locked_by UUID;
  v_lock_time TIMESTAMPTZ;
  v_seller_id UUID;
  v_product_name TEXT;
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
  SELECT p.locked_by, p.locked_at, p.seller_id, p.name
  INTO v_locked_by, v_lock_time, v_seller_id, v_product_name
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  -- 4. Validar concurrencia: que el bloqueo siga perteneciendo al administrador y no haya expirado (10 min)
  IF v_locked_by IS NULL OR v_locked_by IS DISTINCT FROM v_auth_user_id OR v_lock_time < (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
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
  );

  -- 8. Resolver textos dinámicos de la Notificación para el vendedor
  IF p_verdict = 'REJECT' THEN
    v_notif_title := 'Producto Rechazado';
    v_notif_type := 'error';
    v_notif_msg := 'Tu producto "' || v_product_name || '" ha sido rechazado. Motivo: ' || COALESCE(trim(p_public_note), 'No especificado por el administrador.');
    v_action_path := '/verify/' || p_product_id::text;
  ELSE
    v_notif_title := 'Producto Verificado';
    v_action_path := '/profile/listings';
    IF p_public_note IS NOT NULL AND trim(p_public_note) <> '' THEN
      v_notif_type := 'warning';
      v_notif_msg := '¡Listo! Tu producto "' || v_product_name || '" ya está a la venta. Nota del administrador: ' || trim(p_public_note);
    ELSE
      v_notif_type := 'success';
      v_notif_msg := '¡Felicidades! Tu producto "' || v_product_name || '" ha sido aprobado por moderación.';
    END IF;
  END IF;

  -- 9. Insertar Notificación para el vendedor (Bypass seguro de RLS)
  INSERT INTO public.notifications (user_id, title, message, type, read, action_path)
  VALUES (
    v_seller_id,
    v_notif_title,
    v_notif_msg,
    v_notif_type,
    false,
    v_action_path
  );

  RETURN true;
END;
