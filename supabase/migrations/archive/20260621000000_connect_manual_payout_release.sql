-- ============================================================================
-- Migration: connect_manual_payout_release
-- ----------------------------------------------------------------------------
-- Adds shipment-scoped Connect payout run persistence and an admin-only
-- eligibility read model for manual seller fund release.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.connect_payout_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending_reconciliation' CHECK (
    status IN ('pending_reconciliation', 'paid', 'failed', 'canceled', 'reconciliation_needed')
  ),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  stripe_payout_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT
);

COMMENT ON TABLE public.connect_payout_runs IS
  'Auditable manual Stripe Connect payout run created by an admin for a seller shipment batch.';
COMMENT ON COLUMN public.connect_payout_runs.amount IS
  'Total payout amount in cents, computed from selected shipment order_items.net_payout values minus shipment shipping_cost cents.';
COMMENT ON COLUMN public.connect_payout_runs.idempotency_key IS
  'Client-provided idempotency key used to reuse an existing payout run on retry.';

CREATE TABLE IF NOT EXISTS public.connect_payout_run_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.connect_payout_runs(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  net_payout INTEGER NOT NULL CHECK (net_payout >= 0),
  status TEXT NOT NULL DEFAULT 'pending_reconciliation' CHECK (
    status IN ('pending_reconciliation', 'paid', 'failed', 'canceled', 'reconciliation_needed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, shipment_id)
);

COMMENT ON TABLE public.connect_payout_run_shipments IS
  'Shipment-to-payout-run mapping for Connect manual release reconciliation.';
COMMENT ON COLUMN public.connect_payout_run_shipments.net_payout IS
  'Shipment payout amount in cents captured at release-run creation time.';

CREATE INDEX IF NOT EXISTS idx_connect_payout_runs_seller_id
  ON public.connect_payout_runs (seller_id);

CREATE INDEX IF NOT EXISTS idx_connect_payout_runs_actor_id
  ON public.connect_payout_runs (actor_id);

CREATE INDEX IF NOT EXISTS idx_connect_payout_runs_stripe_payout_id
  ON public.connect_payout_runs (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connect_payout_run_shipments_run_id
  ON public.connect_payout_run_shipments (run_id);

CREATE INDEX IF NOT EXISTS idx_connect_payout_run_shipments_shipment_id
  ON public.connect_payout_run_shipments (shipment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_payout_run_shipments_active_once
  ON public.connect_payout_run_shipments (shipment_id)
  WHERE status IN ('pending_reconciliation', 'paid', 'reconciliation_needed');

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
      ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER - COALESCE(s.shipping_cost, 0),
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
    ) AS has_active_release
  FROM public.shipments s
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
    p.username
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
  END AS ineligible_reason
FROM shipment_amounts;

ALTER TABLE public.connect_payout_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_payout_run_shipments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.connect_payout_runs FROM anon, authenticated;
REVOKE ALL ON public.connect_payout_run_shipments FROM anon, authenticated;
REVOKE ALL ON public.admin_connect_payout_release_view FROM anon, authenticated;

GRANT ALL ON public.connect_payout_runs TO service_role;
GRANT ALL ON public.connect_payout_run_shipments TO service_role;
GRANT SELECT ON public.admin_connect_payout_release_view TO service_role;

COMMIT;
