-- Migration: connect_payout_tracking
-- Created: 2026-06-11
-- Description: Adds stripe_payout_id to shipments for tracking manual payouts.
--              Cron scheduling handled via Supabase Dashboard (Edge Functions
--              → Cron Jobs → release-connect-payout every 5 minutes).
-- Prerequisite: stripe_connect_schema migration (20260603000000).

-- 1. Add stripe_payout_id column (NULL = not yet paid out)
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS stripe_payout_id TEXT;

COMMENT ON COLUMN public.shipments.stripe_payout_id IS
  'Stripe Payout ID when the seller''s Connect balance was transferred to their bank. NULL until release-connect-payout processes the completed shipment.';

-- 2. Manual: after deploying this migration, configure the cron job in
--    Supabase Dashboard → Edge Functions → Cron Jobs:
--    Function: release-connect-payout
--    Schedule: */5 * * * * (every 5 minutes)
--
-- The function finds shipments WHERE status='completed'
-- AND stripe_payment_intent_id IS NOT NULL AND stripe_payout_id IS NULL
-- and triggers Stripe payouts for each.
