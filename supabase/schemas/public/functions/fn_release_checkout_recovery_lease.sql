CREATE OR REPLACE FUNCTION public.fn_release_checkout_recovery_lease (
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

  UPDATE public.system_settings AS settings
  SET
    checkout_recovery_lease_id = NULL,
    checkout_recovery_lease_expires_at = NULL
  WHERE id = 1
    AND settings.checkout_recovery_lease_id = p_lease_id
  RETURNING true INTO v_released;

  RETURN COALESCE(v_released, false);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_checkout_recovery_lease"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_checkout_recovery_lease"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_checkout_recovery_lease"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_checkout_recovery_lease"(uuid) FROM PUBLIC, "anon", "authenticated";
