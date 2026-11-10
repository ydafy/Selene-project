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
  v_previous_status public.product_status_enum;
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
      status = 'HIDDEN'::public.product_status_enum,
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

GRANT EXECUTE ON FUNCTION "public"."fn_admin_soft_delete_product"(uuid, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_soft_delete_product"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_admin_soft_delete_product"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_soft_delete_product"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_admin_soft_delete_product"(uuid, text) FROM PUBLIC, "anon";
