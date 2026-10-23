-- B3.1: expiring leases for the auto-cancel crons (odd/tasks/shipment-cancellations-b3.md).
-- Replaces the global booleans auto_cancel_orders_running / auto_cancel_preparing_running,
-- which stayed true forever when a run was killed mid-flight. A lease expires after
-- 600 seconds, longer than any Edge Function wall clock, so a killed run blocks at most
-- the next hourly run window and never overlaps a live one. Only the holder may release.
-- Same pattern as fn_acquire_track_shipments_lease.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS auto_cancel_orders_lease_id UUID,
  ADD COLUMN IF NOT EXISTS auto_cancel_orders_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_cancel_preparing_lease_id UUID,
  ADD COLUMN IF NOT EXISTS auto_cancel_preparing_lease_expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.fn_acquire_auto_cancel_lease(
  p_job TEXT
) RETURNS TABLE (
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
$$;

CREATE OR REPLACE FUNCTION public.fn_release_auto_cancel_lease(
  p_job TEXT,
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
$$;

-- Grant review: SECURITY DEFINER, called only by the auto-cancel Edge Functions with the
-- service role. No anonymous or user access is intended.
REVOKE EXECUTE ON FUNCTION public.fn_acquire_auto_cancel_lease(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acquire_auto_cancel_lease(TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_release_auto_cancel_lease(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_auto_cancel_lease(TEXT, UUID)
  TO service_role;
