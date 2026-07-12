# Proposal: Stripe Fee Gross-Up

## Intent

Fix domestic MX checkout so the buyer-paid processing line gross-ups Stripe’s actual cost model (3.6% + MXN 3, plus 16% VAT on the fee), computed in integer cents against the total charge. Keep `service_fee_amount` as seller commission only, preserve full buyer refunds on cancellation, and make the platform’s absorbed Stripe loss explicit and auditable.

## Scope

### In Scope
- Deterministic gross-up math shared by backend and frontend checkout paths.
- Persist `orders.actual_stripe_fee_cents`, `orders.stripe_fee_reconciled_at`, and `orders.cancellation_loss_cents`.
- Minimal cancel/refund logging based on reconciled actual fee; no alert threshold.

### Out of Scope
- International cards, Adaptive Pricing, multi-currency, saved-card classification.
- Post-charge buyer reconciliation UX, admin badges, dispute-module changes, shipping insurance.

## Capabilities

### New Capabilities
- `stripe-fee-gross-up`: domestic MXN fee gross-up plus actual-fee reconciliation and loss audit.

### Modified Capabilities
- `single-modal-multiseller-checkout`: checkout total / PI amount now derives from gross-up math.
- `shipments`: cancellation stays shipment-scoped, refunds the buyer fully, and records platform Stripe loss.

## Approach

Use one pure integer-cents helper as the source of truth for checkout, summary display, and PaymentIntent amount. Allow a bounded 1–2 cent slack to guarantee no domestic under-collection. On `payment_intent.succeeded`, the webhook reads `BalanceTransaction.fee` as the authoritative actual fee and stamps reconciliation fields. Manual and auto-cancel paths compute loss from the reconciled fee; `service_fee_amount` remains unchanged.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `supabase/functions/create-connect-payment/*` | Modified | Gross-up calculation and PI metadata |
| `apps/frontend/core/{utils,hooks}` | Modified | Buyer summary matches checkout math |
| `supabase/functions/stripe-webhooks/index.ts` | Modified | Persist actual Stripe fee |
| `supabase/functions/{cancel-order,auto-cancel-*}` | Modified | Log/persist cancellation loss |
| `supabase/queries/orders/*` | Modified | Order columns for reconciliation |
| `packages/types/src/database.types.ts` | Modified | Regenerated DB types |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| VAT rounding is pinned incorrectly | Medium | Keep deterministic integer math and a ±1 cent test tolerance until a second data point confirms the rounding rule. |
| Reconciliation write is missed | Low | `stripe_fee_reconciled_at` stays null and the cancel path remains auditable. |

## Rollback Plan

Revert the helper import paths and restore the prior checkout formula. Leave the new nullable columns unused; no destructive schema rollback is required.

## Dependencies

- Validated domestic Stripe fee data at the current charge shape.

## Success Criteria

- [ ] Domestic MX charges match the shared gross-up math in backend and frontend.
- [ ] Actual Stripe fee and cancellation loss are persisted with an auditable trail.
- [ ] `service_fee_amount` still represents seller commission only.
