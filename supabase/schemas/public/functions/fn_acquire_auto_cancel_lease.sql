CREATE OR REPLACE FUNCTION public.fn_acquire_auto_cancel_lease (
  p_job text
)
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

  IF p_job IS NULL OR p_job NOT IN ('orders', 'preparing') THEN
    RAISE EXCEPTION 'INVALID_AUTO_CANCEL_JOB';
  END IF;

  IF p_job = 'orders' THEN
    UPDATE public.system_settings AS settings
    SET
      auto_cancel_orders_lease_id = v_lease_id,
      auto_cancel_orders_lease_expires_at = v_lease_expires_at
    WHERE id = 1
      AND (
        settings.auto_cancel_orders_lease_id IS NULL
        OR settings.auto_cancel_orders_lease_expires_at <= pg_catalog.statement_timestamp()
      )
    RETURNING
      settings.auto_cancel_orders_lease_id,
      settings.auto_cancel_orders_lease_expires_at
    INTO v_lease_id, v_lease_expires_at;
  ELSE
    UPDATE public.system_settings AS settings
    SET
      auto_cancel_preparing_lease_id = v_lease_id,
      auto_cancel_preparing_lease_expires_at = v_lease_expires_at
    WHERE id = 1
      AND (
        settings.auto_cancel_preparing_lease_id IS NULL
        OR settings.auto_cancel_preparing_lease_expires_at <= pg_catalog.statement_timestamp()
      )
    RETURNING
      settings.auto_cancel_preparing_lease_id,
      settings.auto_cancel_preparing_lease_expires_at
    INTO v_lease_id, v_lease_expires_at;
  END IF;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_lease_id, v_lease_expires_at;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_auto_cancel_lease"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_acquire_auto_cancel_lease"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_auto_cancel_lease"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_acquire_auto_cancel_lease"(text) FROM PUBLIC, "anon", "authenticated";
