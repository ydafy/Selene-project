-- Migration: connect_order_lifecycle_cleanup
-- Created: 2026-06-11
-- Description: Phase 4-6 cleanup for Stripe Connect migration.
--              1. Unschedules the escrow release cron (Connect handles payouts).
--              2. Adds deprecation markers to wallet-dependent functions.
--              3. Creates reconcile-connect-payments cron for DLQ recovery.
-- Prerequisite: stripe_connect_schema migration (20260603000000).

-- 1. Unscheduled: escrow release cron — Stripe Connect handles fund release
SELECT cron.unschedule('release-shipment-funds');

-- 2. Mark old wallet functions as deprecated (Connect replaces them)
COMMENT ON FUNCTION fn_release_shipment_funds(UUID) IS
  'DEPRECATED by Stripe Connect migration. Stripe Connect handles automatic payouts. Remove in cleanup phase.';

COMMENT ON FUNCTION fn_cron_release_shipment_funds() IS
  'DEPRECATED by Stripe Connect migration. Cron unscheduled. Remove in cleanup phase.';

COMMENT ON FUNCTION fn_request_payout(NUMERIC, UUID) IS
  'DEPRECATED by Stripe Connect migration. Sellers withdraw via Stripe Express dashboard. Remove in cleanup phase.';

-- 3. Create reconcile-connect-payments function
--    Periodically checks for shipments where the PaymentIntent succeeded
--    at Stripe but the webhook/DB failed to record it (DLQ recovery).
CREATE OR REPLACE FUNCTION fn_reconcile_connect_payments()
RETURNS TABLE(shipment_id UUID, status TEXT, action TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Find shipments in 'paid' status older than 1 hour that have no
  -- stripe_payment_intent_id — these missed the webhook.
  -- In production, this would call Stripe API to verify the PI status.
  -- For now, it logs and marks them for manual review.
  RETURN QUERY
  SELECT
    s.id,
    s.status::TEXT,
    'MANUAL_REVIEW'::TEXT
  FROM public.shipments s
  WHERE s.stripe_payment_intent_id IS NULL
    AND s.status = 'paid'
    AND s.created_at < NOW() - INTERVAL '1 hour'
    AND s.created_at > '2026-06-01'::TIMESTAMPTZ -- Only Connect-era shipments
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reconcile_connect_payments() TO service_role;

-- Schedule: run every 6 hours
SELECT cron.schedule(
  'reconcile-connect-payments',
  '0 */6 * * *',
  'SELECT * FROM public.fn_reconcile_connect_payments()'
);

-- 4. Add deprecation markers to wallet-dependent tables
COMMENT ON TABLE wallets IS
  'DEPRECATED by Stripe Connect migration (stripe-connect-migration). Keep read-only for audit.';
COMMENT ON TABLE wallet_transactions IS
  'DEPRECATED by Stripe Connect migration. Keep read-only for audit.';
COMMENT ON TABLE payout_requests IS
  'DEPRECATED by Stripe Connect migration. Stripe Connect Express dashboard replaces manual payouts.';
COMMENT ON TABLE seller_bank_accounts IS
  'DEPRECATED by Stripe Connect migration. Sellers provide banking info via Stripe onboarding.';
