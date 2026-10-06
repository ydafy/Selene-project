-- ============================================================================
-- Migration: add_connect_payout_failed_retry_contract
-- ----------------------------------------------------------------------------
-- Models a failed payout retry as a child run while preserving the parent run
-- as immutable history. The admin release view keeps ordinary release batches
-- separate from run-scoped failed retries and canceled manual-review cases.
-- ============================================================================

BEGIN;

ALTER TABLE public.connect_payout_runs
  ADD COLUMN retry_of_run_id UUID
  CONSTRAINT connect_payout_runs_retry_of_run_id_fkey
  REFERENCES public.connect_payout_runs (id)
  ON DELETE RESTRICT;

COMMENT ON COLUMN public.connect_payout_runs.retry_of_run_id IS
  'Failed payout run retried by this child run. The parent remains immutable audit history.';

CREATE UNIQUE INDEX idx_connect_payout_runs_one_retry_per_parent
  ON public.connect_payout_runs (retry_of_run_id)
  WHERE retry_of_run_id IS NOT NULL;

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
  sa.shipment_id,
  sa.seller_id,
  sa.seller_name,
  sa.order_id,
  sa.status,
  sa.completed_at,
  sa.stripe_payment_intent_id,
  sa.stripe_account_id,
  sa.stripe_onboarding_status,
  sa.release_amount_cents,
  (
    sa.is_completed
    AND sa.has_completed_at
    AND sa.has_connect_payment_intent
    AND NOT sa.has_active_dispute
    AND NOT sa.has_active_release
    AND payout_run.id IS NULL
    AND (sa.transfer_group IS NOT NULL OR sa.has_shipping_cost_cents)
    AND sa.stripe_account_id IS NOT NULL
    AND sa.stripe_onboarding_status = 'complete'
    AND sa.release_amount_cents > 0
  ) AS is_eligible,
  CASE
    WHEN NOT sa.is_completed THEN 'shipment_not_completed'
    WHEN NOT sa.has_completed_at THEN 'missing_completed_at'
    WHEN NOT sa.has_connect_payment_intent THEN 'missing_connect_payment_intent'
    WHEN sa.has_active_dispute THEN 'active_dispute'
    WHEN sa.has_active_release THEN 'already_released'
    WHEN payout_run.status = 'canceled' THEN 'payout_canceled_manual_review'
    WHEN payout_run.status = 'failed' THEN 'payout_failed_retry_required'
    WHEN payout_run.id IS NOT NULL THEN 'payout_run_history_requires_review'
    WHEN sa.transfer_group IS NULL AND NOT sa.has_shipping_cost_cents THEN 'missing_shipping_cost'
    WHEN sa.stripe_account_id IS NULL THEN 'missing_stripe_account'
    WHEN sa.stripe_onboarding_status <> 'complete' OR sa.stripe_onboarding_status IS NULL THEN 'seller_not_payout_ready'
    WHEN sa.release_amount_cents <= 0 THEN 'missing_release_amount'
    ELSE NULL
  END AS ineligible_reason,
  sa.transfer_group,
  sa.stripe_transfer_id,
  payout_run.id AS payout_run_id,
  payout_run.status AS payout_run_status,
  payout_run.amount AS payout_run_amount_cents,
  payout_run.failure_reason AS payout_run_failure_reason,
  payout_run.failed_at AS payout_run_failed_at,
  payout_run.retry_of_run_id,
  COALESCE(
    payout_run.status = 'failed'
    AND NOT payout_run.has_protected_release
    AND NOT payout_run.has_retry_child,
    FALSE
  ) AS is_retryable,
  COALESCE(
    payout_run.status = 'canceled',
    FALSE
  ) AS requires_manual_review
FROM shipment_amounts sa
LEFT JOIN LATERAL (
  SELECT
    pr.id,
    pr.status,
    pr.amount,
    pr.failure_reason,
    pr.failed_at,
    pr.retry_of_run_id,
    EXISTS (
      SELECT 1
      FROM public.connect_payout_runs retry_child
      WHERE retry_child.retry_of_run_id = pr.id
    ) AS has_retry_child,
    EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments source_mapping
      JOIN public.connect_payout_run_shipments protected_mapping
        ON protected_mapping.shipment_id = source_mapping.shipment_id
      WHERE source_mapping.run_id = pr.id
        AND protected_mapping.status IN ('pending_reconciliation', 'paid', 'reconciliation_needed')
    ) AS has_protected_release
  FROM public.connect_payout_run_shipments crs
  JOIN public.connect_payout_runs pr ON pr.id = crs.run_id
  WHERE crs.shipment_id = sa.shipment_id
  ORDER BY pr.created_at DESC, pr.id DESC
  LIMIT 1
) payout_run ON TRUE;

REVOKE ALL ON public.admin_connect_payout_release_view FROM anon, authenticated;
GRANT SELECT ON public.admin_connect_payout_release_view TO service_role;

COMMIT;
