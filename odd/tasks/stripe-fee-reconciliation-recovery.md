# Stripe fee reconciliation recovery

## Goal
Keep successful Stripe checkout settlement independent from temporary unavailability of the authoritative balance-transaction fee, then reconcile the fee idempotently after it becomes available.

## Invariants
- Orders and shipments created from a successful PaymentIntent remain valid even if the fee is not yet available.
- Only Stripe balance-transaction data may set `actual_stripe_fee_cents`.
- A missing fee never produces a checkout webhook HTTP 500.
- Reconciliation is idempotent and observable; it cannot overwrite an existing fee.
- Retry work is bounded and never repeats checkout settlement, payment, transfer, payout, cancellation, or refund behavior.

## Tasks

- [x] **1. Define deferred-fee recovery contract (RED)**
  - Added a deferred, non-fatal missing balance-transaction contract.
  - Evidence: focused test RED captured — 42 passing, 1 failing; GREEN passed — 43 tests, 0 failures.

- [x] **2. Implement persistence and recovery worker**
  - Implemented a deployable authenticated Deno worker with atomic claims, server-side charge lookup, bounded retry/backoff, and transactional fee/job completion.
  - Evidence: `bun test supabase/functions/reconcile-stripe-fees/index.test.ts` passed: 7 tests, 0 failures.

- [x] **3. Make checkout webhook defer missing fees**
  - Deferred fee plans now upsert an idempotent reconciliation job and return the normal settlement 200 response.
  - Immediate and already-reconciled paths remain unchanged.
  - Evidence: `bun test supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` passed: 44 tests, 0 failures.

- [x] **4. Verify and prepare deployment handoff**
  - Independent verification passed: webhook helper/wiring 44/44, worker 7/7, migration recovery contract 5/5.
  - Deploy `stripe-webhooks` and `reconcile-stripe-fees`; configure the worker service-role bearer secret and a protected scheduler POST. Remote scheduler configuration and live invocation remain maintainer actions.
