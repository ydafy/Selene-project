CREATE OR REPLACE FUNCTION public.fn_acquire_checkout_recovery_lease()
  RETURNS TABLE (
    acquired         boolean,
    lease_id         uuid,
    lease_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_lease_id UUID := pg_catalog.gen_random_uuid();
  v_lease_expires_at TIMESTAMPTZ := pg_catalog.statement_timestamp() + interval '600 seconds';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  UPDATE public.system_settings AS settings
  SET
    checkout_recovery_lease_id = v_lease_id,
    checkout_recovery_lease_expires_at = v_lease_expires_at
  WHERE id = 1
    AND settings.checkout_recovery_enabled = true
    AND (
      settings.checkout_recovery_lease_id IS NULL
      OR settings.checkout_recovery_lease_expires_at <= pg_catalog.statement_timestamp()
    )
  RETURNING
    settings.checkout_recovery_lease_id,
    settings.checkout_recovery_lease_expires_at
  INTO v_lease_id, v_lease_expires_at;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_lease_id, v_lease_expires_at;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_checkout_recovery_lease"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_acquire_checkout_recovery_lease"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_checkout_recovery_lease"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_acquire_checkout_recovery_lease"() FROM PUBLIC, "anon", "authenticated";
