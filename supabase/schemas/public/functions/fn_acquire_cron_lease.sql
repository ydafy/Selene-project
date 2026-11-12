CREATE OR REPLACE FUNCTION public.fn_acquire_cron_lease (
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
  v_ttl interval;
  v_lease_id UUID;
  v_lease_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- The cron jobs and their lease lengths. fn_release_cron_lease accepts the same names.
  v_ttl := CASE p_job
    WHEN 'auto_cancel_orders' THEN interval '600 seconds'
    WHEN 'auto_cancel_preparing' THEN interval '600 seconds'
    WHEN 'track_shipments_preparing' THEN interval '300 seconds'
    WHEN 'track_shipments_shipped' THEN interval '300 seconds'
    WHEN 'checkout_recovery' THEN interval '600 seconds'
  END;
  IF v_ttl IS NULL THEN
    RAISE EXCEPTION 'INVALID_CRON_LEASE_JOB';
  END IF;

  IF p_job = 'checkout_recovery' AND (
    SELECT settings.checkout_recovery_enabled
    FROM public.system_settings AS settings
    WHERE settings.id = 1
  ) IS NOT TRUE THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO internal.cron_leases AS leases (job, lease_id, expires_at)
  VALUES (p_job, pg_catalog.gen_random_uuid(), pg_catalog.statement_timestamp() + v_ttl)
  ON CONFLICT (job) DO UPDATE
  SET
    lease_id = EXCLUDED.lease_id,
    expires_at = EXCLUDED.expires_at
  WHERE leases.expires_at <= pg_catalog.statement_timestamp()
  RETURNING leases.lease_id, leases.expires_at
  INTO v_lease_id, v_lease_expires_at;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_lease_id, v_lease_expires_at;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_cron_lease"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_acquire_cron_lease"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_cron_lease"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_acquire_cron_lease"(text) FROM PUBLIC, "anon", "authenticated";
