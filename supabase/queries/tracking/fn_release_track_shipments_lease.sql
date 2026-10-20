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
