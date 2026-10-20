-- ============================================================================
-- Migration: fix_payout_release_amount_contract
-- ----------------------------------------------------------------------------
-- Makes the manual payout release amount explicit for both settlement flows.
-- Single-modal orders have a checkout-fixed seller allocation in
-- order_items.net_payout; label costs and product publication economics do not
-- participate in payout-time calculation. Legacy orders retain their existing
-- shipment shipping-cost deduction and eligibility requirement.
-- ============================================================================

BEGIN;

COMMENT ON COLUMN public.connect_payout_runs.amount IS
  'Total payout amount in cents. Single-modal orders use the checkout-fixed sum of order_items.net_payout; legacy orders retain the shipment shipping_cost deduction.';

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
    )::INTEGER AS release_amount_cents,
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
    AND (transfer_group IS NOT NULL OR has_shipping_cost_cents)
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
    WHEN transfer_group IS NULL AND NOT has_shipping_cost_cents THEN 'missing_shipping_cost'
    WHEN stripe_account_id IS NULL THEN 'missing_stripe_account'
    WHEN stripe_onboarding_status <> 'complete' OR stripe_onboarding_status IS NULL THEN 'seller_not_payout_ready'
    WHEN release_amount_cents <= 0 THEN 'missing_release_amount'
    ELSE NULL
  END AS ineligible_reason,
  transfer_group,
  stripe_transfer_id
FROM shipment_amounts;

REVOKE ALL ON public.admin_connect_payout_release_view FROM anon, authenticated;
GRANT SELECT ON public.admin_connect_payout_release_view TO service_role;

COMMIT;
