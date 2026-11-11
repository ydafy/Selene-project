-- Allow 'reconciliation_needed' as a checkout recovery compensation state (#383).
-- fn_mark_checkout_recovery_reconciliation_needed parks an order or a standalone
-- shell whose charge evidence is missing, but neither CHECK allowed that value,
-- so every call failed with 23514 and checkout-recovery-worker never parked the
-- row. fn_claim_checkout_recovery_shells only claims refund_pending,
-- refund_failed_retry_queued and refunding, so a parked row is not claimed again.
-- Widening a CHECK keeps every existing row valid. No grants change.

ALTER TABLE "public"."checkout_recovery_shells"
  DROP CONSTRAINT "checkout_recovery_shells_compensation_state_check";

ALTER TABLE "public"."orders"
  DROP CONSTRAINT "orders_compensation_state_check";

ALTER TABLE "public"."checkout_recovery_shells"
  ADD CONSTRAINT "checkout_recovery_shells_compensation_state_check"
    CHECK ((compensation_state = ANY (ARRAY['refund_pending'::text, 'refunding'::text, 'refund_failed_retry_queued'::text, 'refunded'::text, 'reconciliation_needed'::text])));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_compensation_state_check"
    CHECK (((compensation_state IS NULL) OR (compensation_state = ANY (ARRAY['refund_pending'::text, 'refunding'::text, 'refund_failed_retry_queued'::text, 'refunded'::text, 'reconciliation_needed'::text]))));
