# Auto-Cancel + Seller Manual Cancel — Exploration

> Pre-archive exploration for `shipment-cancel-safety` extension.
> Adds: auto-cancel Edge Function refund-basis audit, shared refund-basis helper
> design, and seller manual cancel in `paid` state authorization.
> Source of truth: Engram `sdd/shipment-cancel-safety/*` topics.

## Current State

### Auto-cancel functions still use the old refund basis

`supabase/functions/auto-cancel-orders/index.ts` (lines 100-119) and
`supabase/functions/auto-cancel-preparing/index.ts` (lines 108-125) both
compute:

```ts
const refundAmountCents = Math.round(
  refundItems.reduce(
    (sum, item) =>
      sum + item.price_at_purchase + (item.shipping_amount ?? 0),
    0,
  ) * 100,
);
```

This is the **same formula the original `cancel-order` Edge Function had
before the buyer-paid fix** and has the same over-refund exposure when
`shipping_amount` is seller-paid (Selene single-modal policy: seller pays
shipping). Confirmed in Engram `sdd/shipment-cancel-safety/auto-cancel-refund-basis-gap`
(observation #690) and `sdd/shipment-cancel-safety/refund-policy-context`
(#679).

The auto-cancel functions **also do not cap the refund against the actual
Stripe charge amount** — they only sum `order_items`. This is a separate
gap from the manual cancel fix, which uses `charge.amount -
charge.amount_refunded` as a safety cap. For Connect-era orders each
shipment has its own PI so the math happens to land inside the cap, but
for legacy single-PI orders an over-count would not be caught.

### Auto-cancel functions still hardcode the `shipped+` -> dispute routing

This is correct by the design rule "preparing is cron-only", but worth
documenting: the auto-cancel-preparing flow only fires for `status =
'preparing'` (line 79), so the rule "`preparing` manual cancel not
allowed" is preserved by the SQL `fn_cancel_shipment` already rejecting
`'buyer'` for `status = 'preparing'`. No change required.

### Seller manual cancel is currently blocked in three layers

1. **SQL `fn_cancel_shipment.sql` (line 45-46)**:
   `ELSIF p_cancelled_by_role = 'seller' THEN RETURN QUERY SELECT false,
   'UNAUTHORIZED'::TEXT; RETURN;` — explicit reject.
2. **Edge Function `cancel-order/index.ts` (line 108-110)**:
   `if (!order.buyer_id || order.buyer_id !== user.id) throw new
   ApiError(403, 'BUYER_ONLY');`
3. **Edge Function helper `cancel-order/cancel-order.ts`
   `resolveManualShipmentCancelPlan` (line 186-188)**:
   `if (input.callerRole !== 'buyer') throw new ApiError(403,
   'BUYER_ONLY');` — also `callerRole` is hard-typed to `'buyer'`.
4. **Frontend `useShipments.ts` (line 72)**: `canCancel:
   canBuyerCancelShipment({ isBuyer, status })` — buyer-only.
5. **Spec delta `specs/shipments/spec.md` line 24**: "Seller manual
   cancellation MUST NOT be allowed."

All four layers need to be loosened in lockstep — any single drift
produces a "frontend shows button, backend rejects" or worse, "backend
allows, SQL rejects" surface. The current setup is consistent.

### DRY / shared-helper opportunity

`supabase/functions/_shared/connect-status.ts` is the existing
cross-Edge-Function helper pattern (imported by
`refresh-connect-account-status` and `stripe-webhooks`). The repo
already proves Deno Edge Functions can import siblings from
`../_shared/`.

The manual `cancel-order.ts` already exports pure helpers
(`computeShipmentRefundAmountCents`, `buildCancelShipmentRefundParams`)
that the auto-cancel functions could reuse. The auto-cancel functions
currently inline identical-looking math with subtle differences
(`reverse_transfer: true` on Connect, `type: 'auto_cancel'` metadata).

## Refund-Basis Data Crons Actually Need

To compute the corrected buyer-paid refund basis the auto-cancel
functions need:

| Field                        | Source                                                              |
| ---------------------------- | ------------------------------------------------------------------- |
| `shipmentItems`              | `order_items WHERE shipment_id = $shipment_id` (already fetched)    |
| `orderItems`                 | `order_items WHERE order_id = $order_id` (currently NOT fetched)    |
| `orderChargeCents`           | `orders.stripe_charge_id` → `stripe.charges.retrieve(...).amount`   |
| `remainingRefundableCents`   | `charge.amount - charge.amount_refunded` (NULL when charge unknown) |

Currently the auto-cancel functions have only `shipmentItems`. The
corrected basis needs an extra `order_items` query and a Stripe
`charges.retrieve` round-trip per shipment. The Stripe call is the only
new latency/cost; it can be skipped for the rare
`stripe_charge_id IS NULL` legacy path and fall back to
`orders.total_amount * 100`.

## Affected Areas

- `supabase/functions/auto-cancel-orders/index.ts` — replace inline
  refund math with shared helper; fetch order items + charge amount.
  **Modified.**
- `supabase/functions/auto-cancel-preparing/index.ts` — same. **Modified.**
- `supabase/functions/_shared/refund-basis.ts` — new. Pure helpers
  `computeShipmentRefundAmountCents` + `fetchOrderChargeCents` extracted
  from `cancel-order.ts`. **Created.**
- `supabase/functions/cancel-order/cancel-order.ts` — re-export
  `computeShipmentRefundAmountCents` from `_shared` for backward
  compat with the existing test file; or update tests to import from
  `_shared`. **Modified (low churn).**
- `supabase/functions/cancel-order/cancel-order.test.ts` — adjust import
  path if helpers move. **Modified (mechanical).**
- `supabase/functions/cancel-order/index.ts` — relax buyer-only check to
  `(isBuyer || isSeller)` for `paid`; otherwise reject with 403. **Modified.**
- `supabase/queries/orders/fn_cancel_shipment.sql` — replace explicit
  seller reject with a parallel `auth.uid() = v_seller_id AND status =
  'paid'` branch. **Modified.**
- `supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts` —
  assert new seller branch + still-rejects `preparing`. **Modified.**
- `apps/frontend/core/utils/shipment-cancel-safety.ts` — relax
  `canBuyerCancelShipment` to `canCancelShipment` (or add a sibling)
  that allows seller when `isSeller && status === 'paid'`. **Modified.**
- `apps/frontend/core/hooks/useShipments.ts` — switch
  `permissions.canCancel` to the new helper. **Modified.**
- `apps/frontend/app/profile/orders/[id].tsx` — no change (gated by
  `permissions.canCancel` already).
- `packages/types/src/index.ts` — `EdgeFunctionRegistry['cancel-order']`
  payload stays the same; no new fields. **No change.**
- `openspec/changes/shipment-cancel-safety/specs/shipments/spec.md` —
  amend "Seller manual cancellation MUST NOT be allowed" to allow
  seller in `paid`. **Modified.**
- `tests/shipment-cancel-safety.test.ts` — add seller-can-cancel-paid
  case. **Modified.**
- New `supabase/functions/auto-cancel-orders/auto-cancel-orders.refund-basis.test.ts`
  (or in `tests/`) — add auto-cancel refund-basis cases.
  **Created.**

## Approaches

### 1. Extract refund-basis helper to `_shared/refund-basis.ts` (RECOMMENDED)

Move `computeShipmentRefundAmountCents` and the new
`fetchOrderChargeCents` helper into
`supabase/functions/_shared/refund-basis.ts`. Import from both
`cancel-order/cancel-order.ts` and both auto-cancel functions.

- **Pros:** Single source of truth for the corrected basis; proven
  `_shared/` pattern already used by 2 edge functions; trivial
  refactor; preserves existing helper API for the cancel-order test
  file.
- **Cons:** Requires updating imports in 3 Edge Function entry points
  and 1 test file; slight indirection for readers.
- **Effort:** Low.

### 2. Duplicate the helper, do not extract

Copy `computeShipmentRefundAmountCents` into a new module owned by
auto-cancel, leaving manual `cancel-order.ts` untouched.

- **Pros:** Zero churn to the verified manual cancel path; faster to
  ship.
- **Cons:** Two sources of truth for the buyer-paid basis — exactly the
  drift class that caused the original bug. Future bug fixes have to be
  applied twice.
- **Effort:** Low.

### 3. Authorize seller manual cancel via existing `fn_cancel_shipment` SQL

Add a parallel `auth.uid() = v_seller_id AND status = 'paid'` branch
mirroring the buyer branch.

- **Pros:** Mirrors the buyer pattern; minimal SQL; preserves direct
  RPC safety (the `system` branch still requires service_role).
- **Cons:** Adds a third caller role; needs SQL test.
- **Effort:** Low.

### 4. Authorize seller manual cancel via a new dedicated RPC
`fn_seller_cancel_shipment`

Wrap the cancel primitive in a new SQL function with seller-only
checks, leaving `fn_cancel_shipment` buyer-only.

- **Pros:** Strict separation of buyer and seller code paths; easier
  to reason about caller authorization.
- **Cons:** Significant new SQL surface for what is conceptually the
  same operation; doubles the maintenance for future cancel changes.
  Over-engineering for a paid-only seller path.
- **Effort:** Medium.

### 5. Authorize seller manual cancel purely in the Edge Function
(no SQL change)

Detect "seller + paid" in `cancel-order/index.ts`, do the Stripe
refund + state cleanup manually, and call a new audit-only SQL
function.

- **Pros:** Bypasses `fn_cancel_shipment` entirely.
- **Cons:** Loses the atomicity of the wallet/product/status mutation
  that `fn_cancel_shipment` guarantees; reintroduces the "two places to
  update" drift problem at a worse level. Anti-pattern.
- **Effort:** Medium-High (and wrong direction).

## Recommendation

Adopt **Approach 1 + Approach 3** as a single change:

1. **Extract** `computeShipmentRefundAmountCents` (and a new
   `fetchOrderChargeCents` helper) into
   `supabase/functions/_shared/refund-basis.ts`. Update
   `cancel-order/cancel-order.ts` to re-export from `_shared` so the
   existing test file does not need to change.
2. **Update** both auto-cancel functions to import the shared helper,
   pass it the order-level items and charge amount, and use the
   resulting `amountCents` in their existing `reverse_transfer`-aware
   refund params builder.
3. **Add** a parallel seller branch to `fn_cancel_shipment`:
   ```sql
   ELSIF p_cancelled_by_role = 'seller' THEN
     IF auth.uid() IS DISTINCT FROM v_seller_id THEN
       RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
     END IF;
     IF v_status <> 'paid' THEN
       RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT; RETURN;
     END IF;
   ```
4. **Widen** `resolveManualShipmentCancelPlan` to accept `callerRole:
   'buyer' | 'seller'`, with the same matrix:
   - `'buyer'`: `callerId === orderBuyerId` + `paid` only (existing).
   - `'seller'`: `callerId === shipment.seller_id` + `paid` only (new).
   - Both share the same `shipmentItems`/`orderItems`/`orderChargeCents`
     refund basis.
5. **Update** `useShipments.ts` to call a `canCancelShipment({ isBuyer,
   isSeller, status })` helper that returns true when
   `(isBuyer || isSeller) && status === 'paid'`. Seller sees the cancel
   CTA in the same place the buyer does (the order detail screen), with
   confirm-dialog copy clarifying it is a seller-initiated cancel.
6. **Amend** the spec delta "Seller manual cancellation MUST NOT be
   allowed" to "Seller manual cancellation MUST be allowed only for
   `paid` shipments, mirroring the buyer path."

This keeps the change scoped, reuses proven patterns, and avoids
introducing new SQL surface. Estimated additional lines: ~120 backend
(50 SQL, 30 edge function helper, 40 shared refund-basis tests) + ~50
frontend + ~30 spec/test.

## Risks

- **Auto-cancel Stripe charge lookup adds a round-trip per shipment.**
  Cron already loops with a 500ms delay; adding a `charges.retrieve`
  per shipment (already in `cancel-order/index.ts`) keeps the loop
  under Stripe rate limits. **Mitigation:** add
  `remainingRefundableCents` only; do not require it (use
  `orderChargeCents` cap as fallback). — Low.
- **Seller cancels their own shipment before label generation, leaving
  buyer unable to ship.** By design — cron would auto-cancel anyway in
  48h. The seller manual cancel is an explicit "I'm not going to
  fulfill this" path, same as the buyer "I changed my mind" path.
  Documented in spec. — Low.
- **`reverse_transfer` divergence.** Manual `paid` state never has a
  `stripe_transfer_id` (transfer is on `delivered`), so the manual
  helper intentionally omits `reverse_transfer`. Auto-cancel keeps its
  current `reverse_transfer: true` for Connect. **Mitigation:** do not
  centralize the refund params builder; only centralize the *amount*.
  The two callers keep their own `refundParams` builder. — Low.
- **Loosening seller block at the SQL layer expands the attack surface
  for direct RPC calls.** A malicious seller who finds a shipment row
  could call `fn_cancel_shipment` directly. The new branch enforces
  `auth.uid() = v_seller_id` + `status = 'paid'`, which means only the
  shipment's own seller on a paid shipment is allowed. This is
  equivalent to the buyer branch. — Low.
- **Test infrastructure gaps.** The auto-cancel functions have **no
  existing unit tests**. Adding a refund-basis test requires either a
  new mocked-Supabase harness or extracting the amount computation
  into a pure function (already done by extraction). **Mitigation:**
  test only the pure helper; do not test the Edge Function handler
  end-to-end. — Low.

## Ready for Proposal

Yes. The fix is small enough to fold into the current `shipment-cancel-safety`
change before archive, and aligns with the open verification warnings
(actor-aware copy + auto-cancel refund-basis gap).

### Sequencing inside this SDD change (before archive)

1. Add `supabase/functions/_shared/refund-basis.ts` with
   `computeShipmentRefundAmountCents` (moved) + new
   `fetchOrderChargeCents`.
2. Update `cancel-order/cancel-order.ts` to import the shared
   `computeShipmentRefundAmountCents` (re-export for test compat).
3. Update `auto-cancel-orders/index.ts` and
   `auto-cancel-preparing/index.ts` to use the shared helper.
4. Amend `fn_cancel_shipment.sql` to add the seller branch.
5. Widen `resolveManualShipmentCancelPlan` + Edge Function
   `cancel-order/index.ts` for seller.
6. Update `useShipments.ts` + `shipment-cancel-safety.ts` helper.
7. Amend the spec delta to allow seller in `paid`.
8. Extend `shipmentCancelSafetySqlGuards.test.ts` and
   `tests/shipment-cancel-safety.test.ts` with the new cases.
9. Add `supabase/functions/auto-cancel-orders/auto-cancel-orders.refund-basis.test.ts`
   (or inline in `tests/`) covering the corrected basis.
10. Re-run focused verification + full `bun test` + `bun run lint`.

### Estimated line budget

| Layer                    | Lines |
| ------------------------ | ----- |
| `_shared/refund-basis.ts` (new) | ~40  |
| SQL seller branch        | ~8    |
| Edge Function wiring     | ~30   |
| Frontend helper + hook   | ~25   |
| Spec + tests             | ~80   |
| **Total**                | **~180** |

Stacks on top of the existing 700-900 apply lines but keeps the
single-PR delivery the user already approved.

## Non-Goals

- Auto-cancel functions continue to be cron-only; no public/manual
  exposure.
- `preparing` cancellation remains cron-only (no seller manual path
  for `preparing`).
- Disputes module, release-funds flow, and Connect payout release
  timing are untouched.
- The whole-order `fn_cancel_order.sql` path stays deprecated; not in
  scope to refactor.
