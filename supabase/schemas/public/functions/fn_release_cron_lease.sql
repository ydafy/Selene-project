CREATE OR REPLACE FUNCTION public.fn_release_cron_lease (
  p_job      text,
  p_lease_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- The same job names as fn_acquire_cron_lease.
  IF p_job IS NULL OR p_job NOT IN (
    'auto_cancel_orders', 'auto_cancel_preparing',
    'track_shipments_preparing', 'track_shipments_shipped',
    'checkout_recovery'
  ) THEN
    RAISE EXCEPTION 'INVALID_CRON_LEASE_JOB';
  END IF;

  -- Only the holder releases: another or a NULL lease id deletes nothing.
  DELETE FROM internal.cron_leases AS leases
  WHERE leases.job = p_job
    AND leases.lease_id = p_lease_id;

  RETURN FOUND;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) FROM PUBLIC, "anon", "authenticated";
