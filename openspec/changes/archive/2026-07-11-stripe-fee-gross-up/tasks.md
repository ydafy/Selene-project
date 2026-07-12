# Tasks: Stripe Fee Gross-Up

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~750 authored (excluding regenerated DB types) |
| 400-line budget risk | High |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: foundation+schema → PR 2: checkout+webhook → PR 3: cancellation+verify |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Shared gross-up math + schema + types | PR 1 | `bun test supabase/functions/_shared/stripe-fee-gross-up.test.ts` | `supabase migration up` + `bun db:types` | Revert migration; delete helper + tests |
| 2 | Checkout integration + webhook reconciliation | PR 2 | `bun test supabase/functions/create-connect-payment` + `bun test supabase/functions/stripe-webhooks` | `supabase functions serve create-connect-payment` / `stripe-webhooks` | Revert `fee-calculator.ts`, `single-payment-builder.ts`, webhook index |
| 3 | Cancellation loss + auto-cancel parity + verification | PR 3 | `bun test supabase/functions/cancel-order` + `bun test supabase/functions/_shared/refund-basis.test.ts` | `supabase functions serve cancel-order` | Revert `refund-basis.ts`, cancel/auto-cancel functions, RPC signature |

## Phase 1: Foundation / Schema

- [x] 1.0 Read `packages/types/src/database.types.ts` and `packages/types/src/index.ts` before any DB-touching code.
- [x] 1.1 RED: write failing tests for `grossUpDomesticMx` (500,000 => 522,154 ±1, small subtotal ≤2-cent slack) and `allocateCents` sum/ties in `supabase/functions/_shared/stripe-fee-gross-up.test.ts`.
- [x] 1.2 GREEN: create `supabase/functions/_shared/stripe-fee-gross-up.ts` with pure integer helpers and no runtime imports.
- [x] 1.3 Create migration adding `orders.actual_stripe_fee_cents`, `orders.stripe_fee_reconciled_at`, `orders.cancellation_loss_cents` and recreating `fn_cancel_shipment(UUID, TEXT, TEXT, BIGINT DEFAULT NULL)` with atomic cumulative loss update and service-role grants.
- [x] 1.4 Run `bun db:types` and commit regenerated `packages/types/src/database.types.ts`.

## Phase 2: Checkout Integration

- [x] 2.1 RED: update `fee-calculator.test.ts` to expect order-level gross-up and Hamilton allocation; make tests fail.
- [x] 2.2 GREEN: modify `supabase/functions/create-connect-payment/fee-calculator.ts` to call `grossUpDomesticMx` and `allocateCents` for `totalSeguroCents`, keeping `commissionCents` as seller commission only.
- [x] 2.3 Add `grossed_up_total_cents` and `domestic_seguro_cents` to PI metadata in `single-payment-builder.ts`; add backend/frontend total parity test.
- [x] 2.4 Replace frontend `calculateSeguroSelene` in `apps/frontend/core/utils/connectPayment.ts` with helper import; update `apps/frontend/core/hooks/useOrderCalculations.ts` to use integer total/fee directly.

## Phase 3: Webhook Reconciliation

- [x] 3.1 RED: add failing tests in `single-modal-settlement.test.ts` for missing/duplicate balance-transaction fee reconciliation.
- [x] 3.2 GREEN: in `supabase/functions/stripe-webhooks/index.ts`, after settlement RPC ok, retrieve Charge with `balance_transaction` expanded and idempotently write `actual_stripe_fee_cents` + `stripe_fee_reconciled_at`.
- [x] 3.3 If balance transaction is missing or write fails, leave columns NULL and return retryable 500 + DLQ.

## Phase 4: Cancellation Loss

- [x] 4.1 RED: write failing tests in `refund-basis.test.ts` for Hamilton allocation of actual fee across shipments and NULL when unreconciled.
- [x] 4.2 GREEN: add `allocateCancellationLossCents` to `supabase/functions/_shared/refund-basis.ts`.
- [x] 4.3 Update `cancel-order/index.ts` and `cancel-order.ts` to load reconciliation fields, reconcile on-demand, include `seguro_share_cents` in refund metadata, and pass allocated loss to RPC.
- [x] 4.4 Apply the same loss/metadata flow to `auto-cancel-orders/index.ts` and `auto-cancel-preparing/index.ts`.

## Phase 5: Verification

- [x] 5.1 Run `bun test`, `bun run lint`, and type-check `packages/types`, `apps/frontend`, and affected Edge Function workspaces. **Maintainer exception:** proven repo-wide TypeScript/ESLint failures outside changed files are accepted as scoped baseline debt; full tests, changed-file ESLint, and `packages/types` typecheck pass, with no accepted failure in a changed file.
- [x] 5.2 Verify spec scenarios: 500,000-cent cart → 522,154-cent PI; partial cancellation loss sums to actual fee; unreconciled cancellation loss stays NULL; `service_fee_amount` excludes Stripe fee.
