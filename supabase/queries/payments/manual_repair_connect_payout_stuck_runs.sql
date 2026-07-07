-- Manual repair for historical Connect payout runs stuck before the
-- ambiguous Stripe-create failure guard existed.
--
-- Scope:
--   Only runs whose shipment mappings are active
--   (pending_reconciliation/reconciliation_needed) while the parent run has no
--   local stripe_payout_id.
--
-- Safety requirement:
--   Do not mark a run failed until an operator confirms in Stripe that no payout
--   exists for that run/idempotency key, connected account, amount, and shipment
--   metadata. If Stripe may have created a payout, leave the row active and
--   reconcile it instead of using this repair.
--
-- This script defaults to ROLLBACK. Change the final ROLLBACK to COMMIT only
-- after reviewing the candidate SELECT and explicitly inserting verified run ids
-- into the temp table below.

BEGIN;

-- 1. Review candidates. Use this output to verify each run in Stripe first.
SELECT
  cpr.id AS run_id,
  cpr.idempotency_key,
  cpr.seller_id,
  cpr.amount,
  cpr.status AS run_status,
  cpr.stripe_payout_id,
  cpr.created_at,
  cpr.failure_reason,
  array_agg(crs.shipment_id ORDER BY crs.shipment_id) AS shipment_ids,
  array_agg(DISTINCT crs.status ORDER BY crs.status) AS mapping_statuses
FROM public.connect_payout_runs cpr
JOIN public.connect_payout_run_shipments crs ON crs.run_id = cpr.id
WHERE cpr.stripe_payout_id IS NULL
  AND crs.status IN ('pending_reconciliation', 'reconciliation_needed')
GROUP BY
  cpr.id,
  cpr.idempotency_key,
  cpr.seller_id,
  cpr.amount,
  cpr.status,
  cpr.stripe_payout_id,
  cpr.created_at,
  cpr.failure_reason
ORDER BY cpr.created_at;

-- 2. Insert only run ids that were verified to have no Stripe payout.
CREATE TEMP TABLE verified_no_stripe_payout_run_ids (
  run_id UUID PRIMARY KEY
) ON COMMIT DROP;

-- Example, after manual Stripe verification:
-- INSERT INTO verified_no_stripe_payout_run_ids (run_id)
-- VALUES ('00000000-0000-0000-0000-000000000000'::UUID);

-- 3. Mark only verified no-payout rows as failed so the admin queue can retry.
UPDATE public.connect_payout_run_shipments crs
SET
  status = 'failed',
  updated_at = now()
FROM public.connect_payout_runs cpr
JOIN verified_no_stripe_payout_run_ids verified ON verified.run_id = cpr.id
WHERE crs.run_id = cpr.id
  AND cpr.stripe_payout_id IS NULL
  AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
  AND crs.status IN ('pending_reconciliation', 'reconciliation_needed');

UPDATE public.connect_payout_runs cpr
SET
  status = 'failed',
  failed_at = now(),
  failure_reason = 'Manual repair: operator verified no Stripe payout exists for this stuck run.',
  updated_at = now()
FROM verified_no_stripe_payout_run_ids verified
WHERE cpr.id = verified.run_id
  AND cpr.stripe_payout_id IS NULL
  AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed');

-- 4. Review repaired rows before deciding whether to commit.
SELECT
  cpr.id AS run_id,
  cpr.idempotency_key,
  cpr.status AS run_status,
  cpr.stripe_payout_id,
  cpr.failed_at,
  cpr.failure_reason,
  array_agg(crs.shipment_id ORDER BY crs.shipment_id) AS shipment_ids,
  array_agg(DISTINCT crs.status ORDER BY crs.status) AS mapping_statuses
FROM public.connect_payout_runs cpr
JOIN public.connect_payout_run_shipments crs ON crs.run_id = cpr.id
JOIN verified_no_stripe_payout_run_ids verified ON verified.run_id = cpr.id
GROUP BY
  cpr.id,
  cpr.idempotency_key,
  cpr.status,
  cpr.stripe_payout_id,
  cpr.failed_at,
  cpr.failure_reason;

ROLLBACK;
-- Replace ROLLBACK with COMMIT only after every selected run has been verified
-- to have no Stripe payout.
