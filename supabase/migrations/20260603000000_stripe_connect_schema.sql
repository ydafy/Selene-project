-- ============================================================================
-- Migration: stripe-connect-migration — Phase 1 Freeze (T-001)
-- ----------------------------------------------------------------------------
-- Covers (delta specs CON-001 .. CON-009):
--   CON-001  Stripe Connect onboarding columns on profiles_private
--   CON-002  shipments.stripe_payment_intent_id for per-seller PIs
--   CON-006  Make orders.stripe_payment_intent_id nullable (multi-PI orders)
--   CON-007  system_settings.connect_enabled feature flag for dual-path routing
--
-- Schema migration order (per design.md):
--   1. Create enum stripe_onboarding_status
--   2. Add nullable Connect columns to profiles_private
--   3. Add nullable shipments.stripe_payment_intent_id
--   4. Make orders.stripe_payment_intent_id nullable
--   5. Add system_settings.connect_enabled feature flag
--
-- All changes are additive/nullable so legacy wallet-era flows keep working
-- during the dual-path period. Connect rows are identified by the presence
-- of shipments.stripe_payment_intent_id.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create stripe_onboarding_status enum
-- ---------------------------------------------------------------------------
-- Values:
--   pending   — Account created, KYC not yet complete (default for new sellers)
--   complete  — Stripe confirmed charges_enabled = true via account.updated
--   rejected  — Stripe rejected KYC; seller cannot generate shipping labels

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'stripe_onboarding_status'
  ) THEN
    CREATE TYPE public.stripe_onboarding_status AS ENUM (
      'pending',
      'complete',
      'rejected'
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. profiles_private — Connect account identifiers
-- ---------------------------------------------------------------------------
-- Both columns are nullable: sellers may list products before onboarding,
-- but must complete onboarding before generating their first shipping label
-- (enforced at the edge function layer, not via NOT NULL).

ALTER TABLE public.profiles_private
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

ALTER TABLE public.profiles_private
  ADD COLUMN IF NOT EXISTS stripe_onboarding_status public.stripe_onboarding_status
    DEFAULT 'pending';

COMMENT ON COLUMN public.profiles_private.stripe_account_id IS
  'Stripe Connect Account v2 ID (acct_...). NULL until seller starts onboarding.';

COMMENT ON COLUMN public.profiles_private.stripe_onboarding_status IS
  'Stripe Connect onboarding state. Updated by account.updated webhook.';

-- ---------------------------------------------------------------------------
-- 3. shipments — Per-seller PaymentIntent identifier
-- ---------------------------------------------------------------------------
-- Marks Connect-era shipments. Presence of this column is the canonical
-- signal that webhooks/refunds/release flows must use Connect logic instead
-- of legacy wallet operations (see CON-006, CON-007, CON-008, CON-009).

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

COMMENT ON COLUMN public.shipments.stripe_payment_intent_id IS
  'Stripe PaymentIntent ID for this shipment (Connect-era). NULL for legacy wallet-era shipments.';

-- Indexes for webhook performance: account.updated and payment_intent.succeeded
-- look up rows by these columns on every Stripe event. Without indexes,
-- Postgres sequential-scans the entire table, which degrades linearly with
-- seller/order growth.
CREATE INDEX IF NOT EXISTS idx_profiles_private_stripe_account_id
  ON public.profiles_private (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_stripe_payment_intent_id
  ON public.shipments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. orders.stripe_payment_intent_id — Make nullable for multi-PI orders
-- ---------------------------------------------------------------------------
-- In Connect-era orders, each shipment has its own PaymentIntent, so the
-- order-level column no longer applies. Legacy single-PI orders keep their
-- value populated for backward compatibility.

ALTER TABLE public.orders
  ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

COMMENT ON COLUMN public.orders.stripe_payment_intent_id IS
  'Single PaymentIntent ID for legacy wallet-era orders. NULL for Connect-era orders (see shipments.stripe_payment_intent_id per shipment).';

-- ---------------------------------------------------------------------------
-- 5. system_settings.connect_enabled — Feature flag for dual-path routing
-- ---------------------------------------------------------------------------
-- When false (default): create-payment-intent uses legacy single-PI flow.
-- When true: create-payment-intent groups by seller and creates per-seller PIs.
-- Webhook routing uses shipments.stripe_payment_intent_id presence (not this
-- flag) so in-flight orders are not affected by toggling the flag.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS connect_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.system_settings.connect_enabled IS
  'Feature flag: when true, checkout uses Stripe Connect multi-PI flow. Webhook routing is independent of this flag.';

-- Ensure the singleton settings row exists so the new column has a value
-- to update later. ON CONFLICT DO NOTHING keeps this idempotent across reruns.
INSERT INTO public.system_settings (id, connect_enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
