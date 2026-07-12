# Design: Stripe Fee Gross-Up

## Technical Approach

For domestic MXN single-modal checkout, calculate one buyer total from integer cents: `ceil((subtotal + 348) * 100000 / 95824)`. The buyer fee is `total - subtotal`; this includes 3.6%, MXN 3, and 16% VAT, with bounded 1–2 cent slack. A dependency-free module at `supabase/functions/_shared/stripe-fee-gross-up.ts` is the canonical source: Deno imports it as a sibling shared module, Bun tests it directly, and Expo imports that pure file through its monorepo path. This is feasible with the current Expo SDK 54 automatic monorepo Metro support and Supabase `_shared` imports; it must contain no Deno, Node, React, or Stripe imports.

## Architecture Decisions

| Decision | Alternatives / tradeoff | Choice and rationale |
|---|---|---|
| Math source | Workspace package needs unconfigured Edge import-map/deploy changes; copied formulas drift | One pure `_shared` source imported by all three runtimes. Existing `@selene/types` proves Expo workspace resolution; direct pure-source import avoids an unverified Deno package boundary. |
| Gross-up | Float math or iterative fee-only calculation | Integer numerator/denominator ceiling. It includes VAT on the fixed fee and never under-collects; the actual Stripe fee remains authoritative. |
| Fee reconciliation | Estimate only | Retrieve the successful Charge expanded with `balance_transaction`; persist `BalanceTransaction.fee` once, after settlement succeeds. |
| Partial cancellation loss | Rounded independent shares can over/under-sum | Allocate actual fee by shipment refund cents using Hamilton largest remainder, ties by shipment UUID. Full cancellation sums exactly to the actual fee. |

## Data Flow

```
Expo summary ─┐
              ├─ pure gross-up ─→ PI amount + allocation metadata
Edge checkout ┘                         │
                                       webhook
                                         │
                    Charge.balance_transaction.fee ─→ orders actual fee
                                         │
refund (one shipment) ─→ deterministic loss share ─→ fn_cancel_shipment
                                                   └→ cumulative order loss
```

`calculateCheckoutAllocation` changes from per-seller fee calculation to one order-level gross-up, then allocates `totalSeguroCents` across rows by subtotal using the same largest-remainder rule. Thus metadata, PI amount, and Expo summary agree exactly, while seller `gross = commission + shipping + net` remains unchanged.

After the existing settlement RPC reports `ok`, the webhook retrieves the Charge with `balance_transaction` expanded. It conditionally writes `actual_stripe_fee_cents` and `stripe_fee_reconciled_at` only when unreconciled, making duplicate events safe. A retrieval/write failure returns a retryable webhook failure after the idempotent settlement; the DLQ records it.

Each cancellation obtains the authoritative fee from the order; if null, it retries Charge/BalanceTransaction reconciliation before refund accounting. If still unavailable, it completes the buyer refund and shipment cancellation but passes no loss, logs `WARN loss_source=unreconciled`, and leaves the loss null—never records an estimate as exact. With a fee, all shipment refund shares are calculated, the target shipment gets its Hamilton allocation, and the atomic RPC adds it only while changing a non-cancelled shipment. Retries therefore cannot double count.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/functions/_shared/stripe-fee-gross-up.ts` | Create | Universal integer gross-up, Stripe-cost estimate, and deterministic proportional allocation helpers. |
| `supabase/functions/create-connect-payment/fee-calculator.ts` | Modify | Use one order-level fee, distribute it across allocation rows; retain deprecated legacy exports only if callers require them. |
| `apps/frontend/core/utils/connectPayment.ts` | Modify | Import canonical helper; expose buyer summary fee without float round-trips. |
| `apps/frontend/core/hooks/useOrderCalculations.ts` | Modify | Consume integer buyer total/fee from the helper. |
| `supabase/functions/stripe-webhooks/index.ts` | Modify | Reconcile expanded Charge BalanceTransaction after successful settlement. |
| `supabase/functions/_shared/refund-basis.ts` | Modify | Add shipment loss allocation input/output helpers. |
| `supabase/functions/{cancel-order,auto-cancel-orders,auto-cancel-preparing}/` | Modify | Load reconciliation fields, reconcile-on-demand, pass allocated loss, structured INFO/WARN logs. |
| `supabase/queries/orders/fn_cancel_shipment.sql` and new migration | Modify/Create | Add nullable order fields; recreate service-role RPC with `p_cancellation_loss_cents BIGINT`, lock/order-update atomically, and preserve grants. |
| `packages/types/src/database.types.ts` | Regenerate | Include the three new nullable `orders` columns via `bun db:types`. |

## Interfaces / Contracts

```ts
type GrossUp = { buyerTotalCents: number; seguroCents: number };
grossUpDomesticMx(subtotalCents: number): GrossUp;
allocateCents(totalCents: number, weights: { id: string; cents: number }[]): Map<string, number>;
// RPC: fn_cancel_shipment(UUID, TEXT, TEXT, BIGINT DEFAULT NULL)
```

`orders.actual_stripe_fee_cents BIGINT NULL`, `stripe_fee_reconciled_at TIMESTAMPTZ NULL`, and `cancellation_loss_cents BIGINT NULL` are domestic audit data. `service_fee_amount` remains seller commission. No new RLS policy or index: service-role updates locate one order by primary key.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | MXN 5,000 result, invalid cents, bounded slack, largest-remainder ties/sum | RED Bun tests for universal helper and allocation invariants; gross-up expected result remains ±1 cent pending a second Stripe observation. |
| Unit | PI/metadata/Expo parity | Assert one global total, allocation reconciliation, and frontend fee/total equal backend output. |
| Unit | Reconciliation and cancellation plans | Mock expanded/missing BalanceTransaction; duplicate webhook update; partial multi-seller loss sums, unreconciled no-loss fallback, and retry idempotency. |
| Integration | Migration/RPC | Apply migration, regenerate types, verify RPC grants and atomic cumulative loss across repeated shipment calls. |
| E2E | N/A | No E2E harness is configured; do not add UI scope. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Deploy the additive migration first, regenerate/commit DB types, then deploy Edge Functions and Expo. New PIs use the gross-up; existing orders retain their charged total. Monitor null reconciliation fields and DLQ. Roll back application imports/formula first; leave nullable columns and the backward-compatible RPC parameter in place. Do not backfill or alter international, admin, dispute, shipping, or buyer UI behavior.

## Open Questions

- [ ] Obtain a second domestic MX Stripe observation at a different charge size to pin Stripe VAT rounding; until then preserve the ±1-cent gross-up assertion.
