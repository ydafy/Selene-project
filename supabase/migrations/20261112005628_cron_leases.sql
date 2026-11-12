-- Cron leases move out of system_settings (odd/tasks/internal-schema.md S4, T1):
-- internal.cron_leases holds one expiring lease per cron job, and the generic
-- fn_acquire_cron_lease / fn_release_cron_lease pair replaces the six per-job
-- functions. The ten lease columns and the unused release_funds_running and
-- return_delivery_timeout_running flags are dropped.
-- Grant review: both functions are SECURITY DEFINER because only they touch
-- internal.cron_leases, which no other role can read or write. Edge Functions
-- call them with .rpc(), so they stay in public; EXECUTE is revoked from PUBLIC,
-- anon and authenticated and granted to service_role only, and the body also
-- requires the service_role claim.
SET local check_function_bodies = off;

DROP FUNCTION "public"."fn_acquire_auto_cancel_lease"(text);

DROP FUNCTION "public"."fn_acquire_checkout_recovery_lease"();

DROP FUNCTION "public"."fn_acquire_track_shipments_lease"(text);

DROP FUNCTION "public"."fn_release_auto_cancel_lease"(text, uuid);

DROP FUNCTION "public"."fn_release_checkout_recovery_lease"(uuid);

DROP FUNCTION "public"."fn_release_track_shipments_lease"(text, uuid);

ALTER TABLE "public"."system_settings"
  DROP COLUMN "auto_cancel_orders_lease_expires_at";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "auto_cancel_orders_lease_id";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "auto_cancel_preparing_lease_expires_at";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "auto_cancel_preparing_lease_id";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "checkout_recovery_lease_expires_at";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "checkout_recovery_lease_id";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "release_funds_running";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "return_delivery_timeout_running";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "track_shipments_preparing_lease_expires_at";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "track_shipments_preparing_lease_id";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "track_shipments_shipped_lease_expires_at";

ALTER TABLE "public"."system_settings"
  DROP COLUMN "track_shipments_shipped_lease_id";

CREATE TABLE "internal"."cron_leases" (
  "job"        text                     NOT NULL,
  "lease_id"   uuid                     NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "cron_leases_pkey" PRIMARY KEY (job)
);

ALTER TABLE "internal"."cron_leases"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "internal"."cron_leases" FROM PUBLIC, "anon", "authenticated", "service_role";

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

REVOKE ALL ON FUNCTION "public"."fn_acquire_cron_lease"(text) FROM PUBLIC, "anon", "authenticated";

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

REVOKE ALL ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fn_acquire_cron_lease"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_cron_lease"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_cron_lease"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_cron_lease"(text, uuid) TO "service_role";
