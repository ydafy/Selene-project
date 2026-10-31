-- Issue #88: make a database rebuilt from migrations grant anon and
-- authenticated no more than project acoiclkeymgtlwcxilun does.
--
-- Cause: the grant restrictions (profiles column grants, no client access to
-- server-only tables) lived in pre-baseline migrations that now sit in
-- migrations/archive and are never replayed. pg_dump emits only GRANT lines, so
-- the baseline cannot undo the default privileges a fresh local database gives
-- every new table. The remote project never ran the baseline (it was recorded
-- as applied), so it kept the restricted grants.
--
-- Grant review: this migration only REVOKEs and re-GRANTs exactly what the
-- remote has (read from it on 2026-10-30), so it is a no-op there. It widens
-- nothing: every GRANT is to authenticated and is a subset of the remote ACL.
-- Tables and views where the remote has no anon or authenticated privilege lose
-- every privilege for those roles. service_role is untouched.
BEGIN;

-- profiles: nobody but the owner's own username, avatar and updated_at can be
-- updated by a client; anon cannot update at all. Other table privileges are
-- unchanged.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (avatar_url, updated_at, username) ON TABLE public.profiles TO authenticated;

-- Server-only tables and views: no client privilege on the remote.
REVOKE ALL ON TABLE
  public.admin_connect_payout_release_view,
  public.checkout_recovery_shells,
  public.connect_account_actionability,
  public.connect_account_events,
  public.connect_payout_events,
  public.connect_payout_run_shipments,
  public.connect_payout_runs,
  public.shipment_cancellation_operations,
  public.shipment_completion_events,
  public.stripe_fee_reconciliation_jobs,
  public.webhook_deliveries
FROM anon, authenticated;

-- Admin views: the remote keeps anon privileges here (unchanged by this
-- migration) and none for authenticated.
REVOKE ALL ON TABLE
  public.admin_connect_earnings_view,
  public.admin_seller_onboarding_view
FROM authenticated;

-- notifications: anon none; authenticated reads and updates only deleted_at and
-- read.
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (deleted_at, read) ON TABLE public.notifications TO authenticated;

-- shipment_tracking_events: anon none; authenticated read-only.
REVOKE ALL ON TABLE public.shipment_tracking_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.shipment_tracking_events TO authenticated;

COMMIT;
