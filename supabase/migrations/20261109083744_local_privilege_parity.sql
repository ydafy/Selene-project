-- Issue #301: make a database rebuilt from migrations grant no more function
-- and table privileges than project acoiclkeymgtlwcxilun does
-- (odd/tasks/migration-history.md, L2).
--
-- Cause: the revokes below lived in pre-baseline migrations that now sit in
-- migrations/archive and are never replayed. pg_dump emits only GRANT lines, so
-- the baseline cannot undo the default privileges a fresh local database gives
-- every new function (EXECUTE to anon and authenticated) and the table
-- privileges it gives service_role. The remote project never ran the baseline
-- (it was recorded as applied), so it kept the restricted privileges.
--
-- Grant review: this migration only REVOKEs, and the result matches what the
-- remote has (read through the MCP on 2026-11-09), so it is a no-op there.
-- PUBLIC keeps EXECUTE on the functions, as on the remote. No Edge Function
-- reads the four tables directly; they are written through SECURITY DEFINER
-- RPCs, so service_role loses nothing it uses.
BEGIN;

-- Functions postgres creates in public from now on: EXECUTE only for postgres
-- and service_role (plus PUBLIC), as on the remote.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Trigger functions: no client role calls them.
REVOKE EXECUTE ON FUNCTION public.fn_shipments_status_trigger() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_shipment_origin_snapshot_mutation() FROM anon, authenticated;

-- is_admin(): authenticated keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- Tables written only through SECURITY DEFINER RPCs: no service_role privilege
-- on the remote.
REVOKE ALL ON TABLE
  public.connect_account_actionability,
  public.connect_account_events,
  public.connect_payout_events,
  public.shipment_cancellation_operations
FROM service_role;

COMMIT;
