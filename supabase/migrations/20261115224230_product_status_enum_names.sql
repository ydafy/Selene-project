SET local check_function_bodies = off;

-- Hand edit: pg-delta dropped and recreated the type (and every view, policy, index and function on it); a rename keeps the data and every OID-bound dependency, so only function bodies that name the type are replaced.
ALTER TYPE "public"."product_status_enum" RENAME TO "product_status";

CREATE OR REPLACE FUNCTION public.fn_admin_restore_product (
  p_product_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status;
BEGIN
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- Read previous_status from the last soft-delete audit log
  SELECT (details->>'previous_status')::public.product_status
  INTO v_previous_status
  FROM public.admin_audit_logs
  WHERE target_id = p_product_id::text
    AND action_type = 'PRODUCT_SOFT_DELETE'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback to PENDING_VERIFICATION if no admin log found (seller self-deleted).
  -- Never auto-approve to VERIFIED — force re-moderation.
  IF v_previous_status IS NULL THEN
    v_previous_status := 'PENDING_VERIFICATION'::public.product_status;
  END IF;

  UPDATE public.products
  SET status = v_previous_status,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_RESTORE',
    p_product_id::text,
    jsonb_build_object('restored_status', v_previous_status::text)
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_soft_delete_product (
  p_product_id uuid,
  p_reason     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status;
BEGIN
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT status INTO v_previous_status
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_previous_status IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.products
  SET deleted_at = now(),
      status = 'HIDDEN'::public.product_status,
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_SOFT_DELETE',
    p_product_id,
    jsonb_build_object('reason', p_reason, 'previous_status', v_previous_status::text)
  );

  RETURN true;
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
            status = 'HIDDEN'::public.product_status,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND deleted_at IS NULL
        AND status = ANY(ARRAY['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW']::public.product_status[]);

    -- Lifting a suspension restores only listings this hold hid; other HIDDEN listings stay hidden
    ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN
        UPDATE public.products
        SET status = status_before_account_hold,
            status_before_account_hold = NULL,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'::public.product_status
        AND status_before_account_hold IS NOT NULL
        AND deleted_at IS NULL;

        -- Listings an admin moved out of HIDDEN during the suspension keep no stale hold
        UPDATE public.products
        SET status_before_account_hold = NULL
        WHERE seller_id = p_target_user_id
        AND status_before_account_hold IS NOT NULL
        AND status <> 'HIDDEN'::public.product_status;
    END IF;

    -- E. ADMIN AUDIT LOG
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('previous_status', v_previous_status::text, 'new_status', p_new_status::text, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_release_listings (
  p_product_ids   uuid[],
  p_only_reserved boolean,
  p_only_expired  boolean
)
  RETURNS SETOF uuid
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM 1
  FROM public.profiles_private pp
  WHERE pp.id IN (
    SELECT s.seller_id
    FROM public.products s
    WHERE s.id = ANY(p_product_ids)
      AND (NOT p_only_reserved OR s.status = 'RESERVED')
      AND (NOT p_only_expired OR s.reserved_at < now() - interval '10 minutes')
  )
  ORDER BY pp.id
  FOR SHARE;

  RETURN QUERY
  UPDATE public.products AS p
  SET status = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN 'VERIFIED'::public.product_status
        ELSE 'HIDDEN'::public.product_status
      END,
      status_before_account_hold = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN p.status_before_account_hold
        ELSE COALESCE(p.status_before_account_hold, 'VERIFIED'::public.product_status)
      END,
      updated_at = now(),
      reserved_at = NULL
  FROM public.products AS s
  LEFT JOIN public.profiles_private AS pp ON pp.id = s.seller_id
  WHERE s.id = p.id
    AND p.id = ANY(p_product_ids)
    AND (NOT p_only_reserved OR p.status = 'RESERVED')
    AND (NOT p_only_expired OR p.reserved_at < now() - interval '10 minutes')
  RETURNING p.id;
END;
$function$;

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
    SET status = 'REJECTED'::public.product_status,
        rejection_reason = trim(p_public_note),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_product_id;
  ELSIF p_verdict = 'APPROVE' THEN
    UPDATE public.products
    SET status = 'VERIFIED'::public.product_status,
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_product_in_dispute()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product_id UUID;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
  SET status = 'IN_DISPUTE'::public.product_status,
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD'::public.product_status, 'RESERVED'::public.product_status);

  RETURN NEW;
END;
$function$;
