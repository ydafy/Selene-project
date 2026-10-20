-- ============================================================================
-- Migration: single_modal_checkout_settlement
-- Created: 2026-07-02
-- Description: Settlement/allocation foundation for single-platform-charge
--              multi-seller checkout.
--              Adds Stripe settlement identifiers and a payment-processing
--              recovery flag on `orders`, a per-shipment platform->seller
--              Transfer reference on `shipments`, supporting indexes, and
--              recreates `admin_connect_payout_release_view` to surface
--              transfer_group and stripe_transfer_id without altering the
--              existing release eligibility gates.
-- Prerequisite: connect_manual_payout_release migration (20260621000000).
--
-- NOTE (manual step): after applying this migration, regenerate the shared
--   generated DB row types by running `bun db:types` at the repo root. The
--   hand-written shared contracts in packages/types/src/index.ts are updated
--   separately; database.types.ts is NOT hand-edited here.
-- ============================================================================

BEGIN;

-- 1. orders: platform charge + transfer group + processing recovery
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_transfer_group TEXT,
  ADD COLUMN IF NOT EXISTS payment_processing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_processing_reason TEXT;

COMMENT ON COLUMN public.orders.stripe_charge_id IS
  'Stripe Charge ID captured from the platform PaymentIntent on payment success. NULL until the webhook persists it.';
COMMENT ON COLUMN public.orders.stripe_transfer_group IS
  'Stripe transfer_group used to group per-shipment platform->seller Transfers on manual release. NULL for legacy per-seller orders.';
COMMENT ON COLUMN public.orders.payment_processing IS
  'True when the platform payment succeeded but order/shipment/allocation persistence failed and is pending ops recovery. Keeps status=pending until durable.';
COMMENT ON COLUMN public.orders.payment_processing_reason IS
  'Human-readable reason for the current payment_processing recovery state. NULL when payment_processing=false.';

-- 2. shipments: per-shipment platform->seller transfer reference
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT;

COMMENT ON COLUMN public.shipments.stripe_transfer_id IS
  'Stripe Transfer ID created by manual admin release moving platform funds to the seller Connect account, grouped under orders.stripe_transfer_group. NULL until release creates it; written exactly once.';

-- 3. Indexes for settlement lookup, recovery, and uniqueness
CREATE INDEX IF NOT EXISTS idx_orders_stripe_transfer_group
  ON public.orders (stripe_transfer_group)
  WHERE stripe_transfer_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_stripe_charge_id
  ON public.orders (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_processing
  ON public.orders (payment_processing)
  WHERE payment_processing = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stripe_transfer_group_unique
  ON public.orders (stripe_transfer_group)
  WHERE stripe_transfer_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_stripe_transfer_id
  ON public.shipments (stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

-- 4. Recreate the admin release view to surface transfer_group and
--    stripe_transfer_id. Eligibility gates are preserved unchanged; release
--    transfer_group/stripe_transfer_id gating is handled in release logic
--    (later batch), not in this read model.
--
-- CREATE OR REPLACE VIEW requires the replaced view to keep existing column
-- names, order, and types; new columns must be APPENDED at the end of the
-- outer SELECT. The original 12 output columns from
-- 20260621000000_connect_manual_payout_release are therefore kept verbatim
-- and in the same order, with transfer_group (order-level) and
-- stripe_transfer_id (shipment-level) appended at the tail.

CREATE OR REPLACE VIEW public.admin_connect_payout_release_view
WITH (security_invoker = true) AS
WITH shipment_amounts AS (
  SELECT
    s.id AS shipment_id,
    s.seller_id,
    s.order_id,
    s.status,
    s.completed_at,
    s.stripe_payment_intent_id,
    s.stripe_payout_id,
    s.shipping_cost,
    pp.stripe_account_id,
    pp.stripe_onboarding_status,
    p.username AS seller_name,
    s.status = 'completed' AS is_completed,
    s.completed_at IS NOT NULL AS has_completed_at,
    s.stripe_payment_intent_id IS NOT NULL AS has_connect_payment_intent,
    GREATEST(
      CASE
        WHEN o.stripe_transfer_group IS NOT NULL THEN
          ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER
        ELSE
          ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER - COALESCE(s.shipping_cost, 0)
      END,
      0
    ) AS release_amount_cents,
    s.shipping_cost IS NOT NULL AND s.shipping_cost > 0 AS has_shipping_cost_cents,
    EXISTS (
      SELECT 1
      FROM public.disputes d
      WHERE d.shipment_id = s.id
        AND d.status IN ('open', 'under_review', 'waiting_return', 'return_shipped', 'return_delivered')
    ) AS has_active_dispute,
    EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments crs
      WHERE crs.shipment_id = s.id
        AND crs.status IN ('pending_reconciliation', 'paid', 'reconciliation_needed')
    ) AS has_active_release,
    -- New settlement columns: appended at the end of the CTE so the outer
    -- SELECT can keep the original view column order and append at the tail.
    -- transfer_group is order-level (sourced via the orders JOIN);
    -- stripe_transfer_id is shipment-level.
    o.stripe_transfer_group AS transfer_group,
    s.stripe_transfer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  LEFT JOIN public.order_items oi ON oi.shipment_id = s.id
  LEFT JOIN public.profiles_private pp ON pp.id = s.seller_id
  LEFT JOIN public.profiles p ON p.id = s.seller_id
  GROUP BY
    s.id,
    s.seller_id,
    s.order_id,
    s.status,
    s.completed_at,
    s.stripe_payment_intent_id,
    s.stripe_payout_id,
    s.shipping_cost,
    pp.stripe_account_id,
    pp.stripe_onboarding_status,
    p.username,
    o.stripe_transfer_group,
    s.stripe_transfer_id
)
SELECT
  shipment_id,
  seller_id,
  seller_name,
  order_id,
  status,
  completed_at,
  stripe_payment_intent_id,
  stripe_account_id,
  stripe_onboarding_status,
  release_amount_cents,
  (
    is_completed
    AND has_completed_at
    AND has_connect_payment_intent
    AND NOT has_active_dispute
    AND NOT has_active_release
    AND has_shipping_cost_cents
    AND stripe_account_id IS NOT NULL
    AND stripe_onboarding_status = 'complete'
    AND release_amount_cents > 0
  ) AS is_eligible,
  CASE
    WHEN NOT is_completed THEN 'shipment_not_completed'
    WHEN NOT has_completed_at THEN 'missing_completed_at'
    WHEN NOT has_connect_payment_intent THEN 'missing_connect_payment_intent'
    WHEN has_active_dispute THEN 'active_dispute'
    WHEN has_active_release THEN 'already_released'
    WHEN NOT has_shipping_cost_cents THEN 'missing_shipping_cost'
    WHEN stripe_account_id IS NULL THEN 'missing_stripe_account'
    WHEN stripe_onboarding_status <> 'complete' OR stripe_onboarding_status IS NULL THEN 'seller_not_payout_ready'
    WHEN release_amount_cents <= 0 THEN 'missing_release_amount'
    ELSE NULL
  END AS ineligible_reason,
  -- New columns appended at the tail to preserve CREATE OR REPLACE VIEW
  -- column-order compatibility with the existing view.
  transfer_group,
  stripe_transfer_id
FROM shipment_amounts;

REVOKE ALL ON public.admin_connect_payout_release_view FROM anon, authenticated;
GRANT SELECT ON public.admin_connect_payout_release_view TO service_role;

COMMIT;
