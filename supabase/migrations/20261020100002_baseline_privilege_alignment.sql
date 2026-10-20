-- Align table privileges with project acoiclkeymgtlwcxilun after the schema
-- baseline. pg_dump only emits grants that exist, so a fresh database that
-- applies default privileges on table creation ends up granting REFERENCES,
-- TRIGGER and TRUNCATE on server-only tables that the remote never granted.
-- TRUNCATE bypasses RLS, so these must not exist.
--
-- On the remote project these privileges are already absent: this migration
-- is a no-op there.
BEGIN;

REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE
  public.admin_connect_payout_release_view,
  public.checkout_recovery_shells,
  public.connect_account_actionability,
  public.connect_account_events,
  public.connect_payout_events,
  public.connect_payout_run_shipments,
  public.connect_payout_runs,
  public.notifications,
  public.shipment_cancellation_operations,
  public.shipment_completion_events,
  public.shipment_tracking_events,
  public.stripe_fee_reconciliation_jobs,
  public.webhook_deliveries
FROM anon, authenticated;

REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE
  public.admin_connect_earnings_view,
  public.admin_seller_onboarding_view
FROM authenticated;

REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE
  public.connect_account_actionability,
  public.connect_account_events,
  public.connect_payout_events,
  public.shipment_cancellation_operations
FROM service_role;

COMMIT;
