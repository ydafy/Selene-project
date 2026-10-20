BEGIN;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS track_shipments_preparing_lease_id UUID,
  ADD COLUMN IF NOT EXISTS track_shipments_preparing_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS track_shipments_shipped_lease_id UUID,
  ADD COLUMN IF NOT EXISTS track_shipments_shipped_lease_expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.fn_acquire_track_shipments_lease(
  p_lane TEXT
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
  v_lease_expires_at TIMESTAMPTZ := pg_catalog.statement_timestamp() + interval '300 seconds';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_lane NOT IN ('preparing', 'shipped') THEN
    RAISE EXCEPTION 'INVALID_TRACKING_LANE';
  END IF;

  IF p_lane = 'preparing' THEN
    UPDATE public.system_settings AS settings
    SET
      track_shipments_preparing_lease_id = v_lease_id,
      track_shipments_preparing_lease_expires_at = v_lease_expires_at
    WHERE id = 1
      AND (
        settings.track_shipments_preparing_lease_id IS NULL
        OR settings.track_shipments_preparing_lease_expires_at <= pg_catalog.statement_timestamp()
      )
    RETURNING
      settings.track_shipments_preparing_lease_id,
      settings.track_shipments_preparing_lease_expires_at
    INTO v_lease_id, v_lease_expires_at;
  ELSE
    UPDATE public.system_settings AS settings
    SET
      track_shipments_shipped_lease_id = v_lease_id,
      track_shipments_shipped_lease_expires_at = v_lease_expires_at
    WHERE id = 1
      AND (
        settings.track_shipments_shipped_lease_id IS NULL
        OR settings.track_shipments_shipped_lease_expires_at <= pg_catalog.statement_timestamp()
      )
    RETURNING
      settings.track_shipments_shipped_lease_id,
      settings.track_shipments_shipped_lease_expires_at
    INTO v_lease_id, v_lease_expires_at;
  END IF;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_lease_id, v_lease_expires_at;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_acquire_track_shipments_lease(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acquire_track_shipments_lease(TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_release_track_shipments_lease(
  p_lane TEXT,
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

  IF p_lane NOT IN ('preparing', 'shipped') THEN
    RAISE EXCEPTION 'INVALID_TRACKING_LANE';
  END IF;

  IF p_lane = 'preparing' THEN
    UPDATE public.system_settings AS settings
    SET
      track_shipments_preparing_lease_id = NULL,
      track_shipments_preparing_lease_expires_at = NULL
    WHERE id = 1
      AND settings.track_shipments_preparing_lease_id = p_lease_id
    RETURNING true INTO v_released;
  ELSE
    UPDATE public.system_settings AS settings
    SET
      track_shipments_shipped_lease_id = NULL,
      track_shipments_shipped_lease_expires_at = NULL
    WHERE id = 1
      AND settings.track_shipments_shipped_lease_id = p_lease_id
    RETURNING true INTO v_released;
  END IF;

  RETURN COALESCE(v_released, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_release_track_shipments_lease(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_track_shipments_lease(TEXT, UUID)
  TO service_role;

COMMIT;
