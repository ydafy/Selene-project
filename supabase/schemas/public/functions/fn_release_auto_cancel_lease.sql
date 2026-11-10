CREATE OR REPLACE FUNCTION public.fn_release_auto_cancel_lease (
  p_job      text,
  p_lease_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_released BOOLEAN := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_job IS NULL OR p_job NOT IN ('orders', 'preparing') THEN
    RAISE EXCEPTION 'INVALID_AUTO_CANCEL_JOB';
  END IF;

  IF p_job = 'orders' THEN
    UPDATE public.system_settings AS settings
    SET
      auto_cancel_orders_lease_id = NULL,
      auto_cancel_orders_lease_expires_at = NULL
    WHERE id = 1
      AND settings.auto_cancel_orders_lease_id = p_lease_id
    RETURNING true INTO v_released;
  ELSE
    UPDATE public.system_settings AS settings
    SET
      auto_cancel_preparing_lease_id = NULL,
      auto_cancel_preparing_lease_expires_at = NULL
    WHERE id = 1
      AND settings.auto_cancel_preparing_lease_id = p_lease_id
    RETURNING true INTO v_released;
  END IF;

  RETURN COALESCE(v_released, false);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_auto_cancel_lease"(text, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_auto_cancel_lease"(text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_auto_cancel_lease"(text, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_auto_cancel_lease"(text, uuid) FROM PUBLIC, "anon", "authenticated";
