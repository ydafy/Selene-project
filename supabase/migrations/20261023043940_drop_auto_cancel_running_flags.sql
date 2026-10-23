-- B3.4 (odd/tasks/shipment-cancellations-b3.md): drop the legacy global booleans of the
-- auto-cancel crons, replaced by the expiring leases of 20261023023952_auto_cancel_cron_leases.
-- Apply only after auto-cancel-orders and auto-cancel-preparing with the lease are deployed:
-- an older function version still reads these columns. No function, view or cron job
-- references them (checked on the remote project before writing this migration).
-- Canonical: supabase/queries/orders/auto_cancel_cron_leases.sql (same statement).

ALTER TABLE public.system_settings
  DROP COLUMN IF EXISTS auto_cancel_orders_running,
  DROP COLUMN IF EXISTS auto_cancel_preparing_running;
