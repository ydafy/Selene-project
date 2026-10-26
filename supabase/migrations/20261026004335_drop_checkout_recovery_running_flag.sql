-- BL13 (odd/tasks/checkout-recovery-lease.md): drop the legacy global boolean of
-- checkout-recovery-worker, replaced by the expiring lease of 20261026003552_checkout_recovery_lease.
-- Apply only after checkout-recovery-worker with the lease is deployed: an older function
-- version still reads and writes this column.
-- Canonical: supabase/queries/orders/checkout_recovery_lease.sql (same statement).

ALTER TABLE public.system_settings
  DROP COLUMN IF EXISTS checkout_recovery_running;
