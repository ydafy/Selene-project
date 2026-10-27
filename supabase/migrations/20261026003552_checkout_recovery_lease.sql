-- Canonical: supabase/queries/orders/checkout_recovery_lease.sql (identical body).
-- Apply this migration OR the canonical file, not both. Deploy checkout-recovery-worker only
-- after this SQL is applied. The legacy checkout_recovery_running boolean stays until the new
-- function is deployed; a later migration drops it.

-- BL13 (odd/tasks/checkout-recovery-lease.md): expiring lease for checkout-recovery-worker.
-- Replaces the global boolean checkout_recovery_running, which stays true forever when a run
-- is killed mid-flight (the remote project has skipped every run since 2026-04-24). A lease
-- expires after 600 seconds, longer than any Edge Function wall clock, so a killed run blocks
-- at most the next two 5-minute runs and never overlaps a live one. Only the holder may
-- release. A lease is granted only while checkout_recovery_enabled is true.
-- Same pattern as fn_acquire_auto_cancel_lease.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS checkout_recovery_lease_id UUID,
  ADD COLUMN IF NOT EXISTS checkout_recovery_lease_expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.fn_acquire_checkout_recovery_lease()
RETURNS TABLE (
  acquired BOOLEAN,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.fn_release_checkout_recovery_lease(
  p_lease_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- Grant review: SECURITY DEFINER, called only by checkout-recovery-worker with its dedicated
-- service-role JWT. No anonymous or user access is intended.
REVOKE EXECUTE ON FUNCTION public.fn_acquire_checkout_recovery_lease()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acquire_checkout_recovery_lease()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_release_checkout_recovery_lease(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_checkout_recovery_lease(UUID)
  TO service_role;
