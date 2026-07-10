# Exploration: shipment-cancel-safety (refreshed)

> Refresh of the prior exploration. Adds: a verified code map, `system_settings`
> inventory, cancellation state matrix, Stripe refund risk analysis, drift log,
> and a recommended design direction for the change proposal.
> Source of truth for product decisions: Engram `sdd/shipment-cancel-safety/*`.

## Current State

### What already exists

**Shipment-scoped cancellation primitive is production-ready.**

- `supabase/queries/orders/fn_cancel_shipment.sql` — atomic per-shipment cancel
  via `fn_cancel_shipment(p_shipment_id, p_cancelled_by_role, p_reason)`.
  - Locks `shipments` row, validates role (`admin` / `seller` / `system`),
    allows cancellation only on `status IN ('paid','preparing')`.
  - Reverses the **single seller's** wallet pending balance by `SUM(net_payout)`,
    writes a `wallet_transactions` adjustment row, restores products to
    `VERIFIED`, and emits per-seller + buyer notifications.
  - Returns `{ success, error_message }` (`ALREADY_CANCELLED`,
    `SHIPMENT_NOT_FOUND`, `CANNOT_CANCEL_IN_THIS_STATUS`, `UNAUTHORIZED`,
    `INTERNAL_SERVER_ERROR`).
  - **Already used by both crons** in production. The shipment-scoped path
    itself is correct and tested in production via the auto-cancel jobs.
- `supabase/queries/orders/fn_cancel_order.sql` — whole-order cancel. Locks
  the order row, checks `orders.status='paid'`, then iterates **every**
  `order_items` row for the order (regardless of shipment state) and reverses
  each seller's wallet. **This is the dangerous path** that the mixed-state
  bug relies on. No role-based authorization inside the function — caller is
  trusted.
- `supabase/functions/auto-cancel-orders/index.ts` (271 lines) — cron path
  that already uses the shipment-scoped flow. Per-shipment Stripe refund
  with `reverse_transfer: true` on Connect-era rows. Idempotency key
  `auto_cancel_${shipment.id}`. Uses `system_settings.order_expiration_hours`
  (default 48h) and the `auto_cancel_orders_running` concurrent-execution
  lock.
- `supabase/functions/auto-cancel-preparing/index.ts` (269 lines) — same
  shape but for `status='preparing'`, using `preparing_expiration_hours`
  (default 72h) and the `auto_cancel_preparing_running` lock. Uses
  `shipments.updated_at` (not `created_at`) because the timer starts when
  the label is generated, not when the order is created. Idempotency key
  `auto_cancel_preparing_${shipment.id}`.
- `supabase/functions/cancel-order/index.ts` (266 lines) — **the buggy one**.
  - Zod schema: `RequestSchema = { orderId: uuid, reason?: string }`. No
    `shipmentId` field. Rejects with 400 if any other field is sent (Zod
    strips extras by default but unknown keys still flow through the
    body).
  - Loops over `shipments WHERE order_id = orderId AND status != 'cancelled'`
    and **creates one Stripe refund per shipment** with idempotency key
    `cancel_order_${shipment.id}`. Uses `reverse_transfer: true` on Connect
    rows, falls back to legacy `orders.stripe_payment_intent_id` without
    `reverse_transfer` if no shipment-level PI exists.
  - Then calls `fn_cancel_order(p_order_id, p_reason, p_cancelled_by_role)`
    which iterates every `order_items` row and reverses every seller's
    wallet. **Always whole-order regardless of caller intent.**

### Frontend

- `apps/frontend/app/profile/orders/[id].tsx` (772 lines) — the screen that
  has the cancel CTA. Resolves `currentShipment` from URL `shipment_id`
  query param. Renders the `OrderActionCard` with the resolved shipment.
  The cancel PrimaryButton (line 644) only renders when
  `currentShipment.permissions.canCancel` is true. The ConfirmDialog
  (line 702-714) calls `actions.cancelOrder.execute({})` with no scope.
- `apps/frontend/app/profile/orders/summary/[id].tsx` (238 lines) — the
  multi-seller summary. **No cancel CTA**. Renders one
  `OrderShipmentCard` per shipment and routes per-shipment when tapped.
- `apps/frontend/app/profile/orders/index.tsx` (178 lines) — list screen.
  No cancel CTA.
- `apps/frontend/core/hooks/useOrderActions.ts` (205 lines) — the
  `cancelOrder` mutation (line 68-80) calls
  `invokeEdge('cancel-order', { orderId, reason })`. **No `shipmentId`
  overload** — only `reason?: string`. The `confirmDelivery` mutation in
  the same file (line 38-65) already implements the `params?.shipmentId`
  branching pattern that the cancel mutation should mirror.
- `apps/frontend/core/hooks/useShipments.ts` (191 lines) — sets
  `permissions.canCancel = shipment.status === 'paid'` (line 71). This is
  already consistent with the product rule "buyer manual cancel: only
  `paid`". Note: `fn_cancel_shipment` SQL also accepts `preparing` — the
  frontend gate is stricter than the SQL, which is fine (defense in depth).
- `apps/frontend/core/hooks/useOrderCountdown.ts` (55 lines) — generic
  countdown hook. Signature `useOrderCountdown(startTimeString?, hoursLimit
= 48)`. **Default `48` is hardcoded**; no `useSystemConfig` integration.
- `apps/frontend/core/hooks/useSystemConfig.ts` (36 lines) — already
  fetches the full `system_settings` row (`eq('id', 1).single()`) with
  15-minute staleTime. No RLS on `system_settings` (verified — no
  `ENABLE ROW LEVEL SECURITY` or policies on this table in any
  migration), so this hook is safe to call from the frontend with the
  anon key.
- `apps/frontend/components/features/orders/OrderActionCard.tsx` (262
  lines) — the banner component. Uses `useOrderCountdown` with three
  hardcoded `limit: 48` cases (delivered-buyer-window, return-pay-pending,
  return-ship-pending). **All three copy lines and limits are hardcoded**;
  none of them read `useSystemConfig`.
- `apps/frontend/components/features/orders/OrderShipmentCard.tsx`,
  `OrderCard.tsx`, `OrderStepper.tsx` — checked, none of them drive
  cancellation logic.

### Tests

- No `supabase/tests/` directory exists.
- No cancellation tests under `apps/frontend/core/hooks/*.test.ts` (the
  eight existing tests cover `useReviewAction`, `useConnectOnboarding`,
  `useDeleteAccount`, `useAllFavorites`, `useMyFavorites`,
  `useProducts`, `useUpdateProfile`, `useSellerReviews`).
- No `*.test.*` in `apps/frontend/app/profile/orders/`.
- The current `cancellation test coverage` requirement in the delta
  spec is **not satisfied** by any existing test artifact.

### Types

- `packages/types/src/index.ts` `EdgeFunctionRegistry['cancel-order']`
  declares `payload: { orderId: string; reason: string }`. No
  `shipmentId` field. Adding the field is a typed-contract change.
- `EnrichedShipment.permissions` (line 324-339 of `index.ts`) already
  includes `canCancel`, `canReport`, `canConfirmDelivery`, `canPayReturn`,
  `canUploadReturnEvidence`, `canGenerateReturnLabel`, etc. **No new
  permission keys required** for the safety change. We can reuse
  `canCancel` after the matrix is finalized.

### Drifts / Stale Docs Found

1. **`shipmentId` vs `shipment_id` casing.** The delta spec uses
   `shipmentId` (camelCase) inside the cancel payload. The URL search
   params in `[id].tsx` use `shipment_id` (snake_case). The cancel
   mutation in `useOrderActions.ts` already uses `shipmentId` for the
   `confirmDelivery` overload. **Correction**: keep URL as
   `shipment_id` (snake_case matches the rest of Expo Router query
   params in this codebase), use `shipmentId` (camelCase) for the
   function/mutation payload. Document the asymmetry in JSDoc on the
   mutation signature.
2. **`useOrderCountdown` default `hoursLimit: 48`.** The signature
   has a default of 48 even though every production caller passes an
   explicit value. **Correction**: keep the default for back-compat, but
   in this change every caller must read the value from
   `useSystemConfig` rather than pass a literal. Add a typed
   `CancellationSettings` helper to avoid sprinkling fallback magic
   numbers.
3. **`OrderActionCard` three hardcoded `limit: 48`.** Same as #2.
4. **No `manual_cancel_enabled` flag on `system_settings`.** The crons
   can be turned off with `auto_cancel_*_running`, but there is no
   runtime flag to disable buyer-initiated manual cancel. If we want
   emergency stop on manual cancel without a deploy, we need to either
   add a new column or reuse a generic `is_maintenance` flag (already
   exists). Recommend reusing `is_maintenance` for now (it already
   gates other writes) and documenting the choice in the spec.
5. **`fn_cancel_order.sql` is missing role-based authorization.** It
   accepts `p_cancelled_by_role` but never checks it. Caller (the
   Edge Function) sets it. For defense in depth the SQL should
   require an admin/buyer/seller/system context, not just trust the
   caller. This is consistent with `fn_cancel_shipment` which does
   enforce role checks.

## Cancellation State Matrix

Decisions (confirmed via Engram `sdd/shipment-cancel-safety/cancellation-scope-decision`
and `sdd/shipment-cancel-safety/cancelable-states` topics):

| State                | Buyer manual    | Seller manual | Cron auto                                                     |
| -------------------- | --------------- | ------------- | ------------------------------------------------------------- |
| `paid`               | ✅ Shipment     | ❌ No         | ✅ `auto-cancel-orders` after `order_expiration_hours`        |
| `preparing`          | ❌ No           | ❌ No         | ✅ `auto-cancel-preparing` after `preparing_expiration_hours` |
| `shipped`            | ❌ No (dispute) | ❌ No         | ❌ No                                                         |
| `delivered`          | ❌ No (dispute) | ❌ No         | ❌ No                                                         |
| `completed`          | ❌ No (review)  | ❌ No         | ❌ No                                                         |
| `cancelled`          | —               | —             | —                                                             |
| `refunded`/`dispute` | ❌ No           | ❌ No         | ❌ No                                                         |

`paid` buyer manual cancel is **always shipment-scoped** — there is no
whole-order path the buyer can trigger. Whole-order cancel only happens
implicitly when `auto-cancel-orders` sweeps a multi-shipment order
where every shipment is still `paid` (rare; covered by existing cron
logic and idempotent).

## Stripe Refund Risk Analysis

The existing per-shipment refund flow in both `cancel-order` and
`auto-cancel-*` Edge Functions already covers the risky cases:

- **Partial amount per shipment.** Both auto-cancel functions compute
  `SUM(price_at_purchase + shipping_amount) * 100` from `order_items`
  per shipment. The current `cancel-order` Edge Function **does not**
  compute a partial amount — it refunds the full PaymentIntent for each
  shipment. For Connect, each shipment has its own PaymentIntent so
  per-shipment refund = per-shipment amount, which is correct. For
  legacy orders (one PaymentIntent for the whole order), this refunds
  the entire order per shipment, which is over-refunding. **Risk:
  Medium** — the legacy flow needs a single-PI refund in that case.
- **Idempotency.** `cancel_order_${shipment.id}` (current), plus the
  `charge_already_refunded` swallow pattern, gives a robust retry
  story. We must keep this idempotency key when splitting the call
  per shipment.
- **Transfer reversal.** `reverse_transfer: true` is only set when
  `shipment.stripe_payment_intent_id` is present (Connect era). For
  legacy orders, the transfer was never made (destination charge
  flow) so no reversal is needed. **Correct.**
- **`stripe_transfer_id` block.** In the `paid` state the transfer
  has not been made (`stripe_transfer_id IS NULL`), so the refund does
  not need to reverse anything. The `preparing` state can theoretically
  have a transfer if the auto-payout-release job ran, but in the
  current payment flow that job only fires on `delivered` so this
  case is impossible today. **Defensive check recommended**: in the
  shipment cancel path, if `shipment.stripe_transfer_id IS NOT NULL`
  we should log a CRITICAL and alert, not attempt a refund (the
  transfer must be reversed via a separate flow).
- **Full-PI legacy refund.** When the order has a single
  `orders.stripe_payment_intent_id` (no shipment-level PIs), the
  current `cancel-order` loops over the shipments and creates one
  refund per shipment against the same PaymentIntent. The second
  refund would fail with `charge_already_refunded` for the full
  amount because the first already drained the PI. **Risk: Medium**
  — this branch needs to detect "legacy single-PI" and refund once
  for the full order, not N times.

## Recommended Design Direction

The change is **medium-sized** (estimated 700-900 changed lines across
backend, frontend, types, and tests). Recommend a two-PR split
consistent with the `single-pr-default` budget but respecting the
800-line cap:

### PR 1 — Backend safety (target ~450 lines)

1. **Edge Function `supabase/functions/cancel-order/index.ts`**
   - Accept either `{ orderId, reason }` (whole-order) or
     `{ orderId, shipmentId, reason }` (shipment-scoped).
   - When `shipmentId` is provided:
     - Validate `shipmentId` belongs to `orderId` (query `shipments`
       with both filters).
     - Validate `shipment.status IN ('paid','preparing')` —
       reject with 422 otherwise.
     - Compute single-shipment refund amount from
       `order_items WHERE shipment_id = shipment_id` (same formula
       the auto-cancel crons use).
     - Refund exactly the active shipment's PI (with
       `reverse_transfer: true` if Connect).
     - If `shipment.stripe_transfer_id IS NOT NULL`, log CRITICAL
       and refuse (refund would not reverse the transfer).
     - Call `fn_cancel_shipment(p_shipment_id, p_cancelled_by_role,
p_reason)`.
   - When `shipmentId` is absent:
     - Verify every non-cancelled shipment is in `'paid'`. Reject
       with 422 otherwise.
     - Use existing loop (refund per shipment) and call
       `fn_cancel_order`.
     - Detect "legacy single-PI" and refund once.
2. **`supabase/queries/orders/fn_cancel_order.sql`**
   - Add explicit whole-order eligibility check: count of
     non-cancelled shipments not in `('paid','preparing')` must be
     zero, else return `WHOLE_ORDER_NOT_CANCELABLE`.
   - Add `p_cancelled_by_role` auth check (admin or buyer only).
3. **Migration** if needed for the `is_maintenance` emergency-stop
   comment (no column add — `is_maintenance` already exists in
   `system_settings`).
4. **Smoke SQL** (no formal test framework, but a documented run
   plan in the spec).

### PR 2 — Frontend wiring + SLA timer (target ~300 lines)

1. **`packages/types/src/index.ts`**
   - `EdgeFunctionRegistry['cancel-order']` payload becomes a
     discriminated union:
     ```ts
     { kind: 'shipment'; orderId: string; shipmentId: string; reason?: string }
     | { kind: 'order'; orderId: string; reason?: string }
     ```
     (Keep the wire shape camelCase to match the existing pattern.)
2. **`apps/frontend/core/hooks/useOrderActions.ts`**
   - `cancelOrder.execute(params)`:
     - If `params.shipmentId` → call `invokeEdge('cancel-order', { orderId, shipmentId, reason })`.
     - Else → call `invokeEdge('cancel-order', { orderId, reason })`.
   - Same shape as the existing `confirmDelivery` overload.
3. **`apps/frontend/app/profile/orders/[id].tsx`**
   - In the ConfirmDialog onConfirm (line 706-709), pass
     `shipmentId: currentShipment?.id` to `cancelOrder.execute`.
   - The cancel button visibility stays driven by
     `currentShipment.permissions.canCancel` (already correct).
4. **`apps/frontend/components/features/orders/OrderActionCard.tsx`**
   - Replace the three hardcoded `limit: 48` with values from
     `useSystemConfig()`.
   - The "show unboxing warning" must remain; the user decision is
     to keep it and not replace it.
5. **New `apps/frontend/core/hooks/useCancellationSettings.ts`** (or
   extend `useOrderCountdown`):
   - Exposes `orderExpirationHours`, `preparingExpirationHours`,
     with sensible fallback constants.
   - The 48/72 numbers used by the crons are the same values, so
     keeping them as in-code fallbacks means the UI degrades
     gracefully if the row is missing.

### Test coverage (split across both PRs)

- **PR1**: SQL-level test plan documented in the spec
  (`fn_cancel_order` rejects mixed-state orders, allows all-paid
  orders, rejects cross-order `shipmentId`, etc.). Manual run
  instructions in the spec.
- **PR2**: One new `useOrderCountdown.test.ts` covering fallback
  behavior when `useSystemConfig` returns null. One new
  `useOrderActions.test.ts` covering the scope branching (or extend
  if a test file already exists).

## Open Questions

1. **`preparing` manual cancel.** The product decision is "buyer
   manual cancel only on `paid`". The current `fn_cancel_shipment`
   SQL allows `preparing` too. Should the Edge Function enforce
   `paid`-only at the buyer level (leave `preparing` open to system
   cron only)? **Recommend yes**: the Edge Function is the right
   place because `fn_cancel_shipment` is reused by both the buyer
   path and the auto-cancel-preparing cron. Tightening the SQL
   would break the cron.
2. **Whole-order entry point.** The buyer UI never calls whole-order
   cancel today. Does the Edge Function still need to support it?
   The spec says yes for "legacy single-seller" backward compat.
   Confirm with the product owner that this path is genuinely
   still reachable; otherwise drop it and reduce surface area.
3. **`is_maintenance` emergency stop.** Does using
   `system_settings.is_maintenance` to gate the cancel endpoint
   conflict with any other consumer of that flag? Grep did not
   find any other frontend writer, so this should be safe, but
   worth confirming with backend owner.
4. **Legacy single-PI refund math.** The current `cancel-order`
   Edge Function does not compute a partial amount for legacy
   orders (one PI for the whole order). For legacy single-seller
   orders, full-order refund is correct. For legacy multi-seller
   orders... the legacy flow should not have created multiple
   shipments in the first place, so this is mostly theoretical.
   Confirm the assumption with a query.

## Affected Areas

- `packages/types/src/index.ts` — payload type for `cancel-order`
  Edge Function. **Modified.**
- `apps/frontend/core/hooks/useOrderActions.ts` — `cancelOrder`
  mutation scope branching. **Modified.**
- `apps/frontend/app/profile/orders/[id].tsx` — ConfirmDialog
  passes shipmentId. **Modified.**
- `apps/frontend/components/features/orders/OrderActionCard.tsx` —
  useSystemConfig replaces hardcoded 48s. **Modified.**
- `apps/frontend/core/hooks/useOrderCountdown.ts` — keep signature,
  but document caller responsibility to source from
  `useSystemConfig`. **No change (already supports the call).**
- `apps/frontend/core/hooks/useSystemConfig.ts` — already
  sufficient. **No change.**
- `supabase/functions/cancel-order/index.ts` — add scope branching,
  partial-amount logic, transfer-reversal guard. **Modified.**
- `supabase/queries/orders/fn_cancel_order.sql` — add whole-order
  eligibility check + role auth. **Modified.**
- `supabase/queries/orders/fn_cancel_shipment.sql` — **no change**
  (already correct, reused as-is).
- `supabase/functions/auto-cancel-orders/index.ts` — **no change**
  (already shipment-scoped, already uses the right
  `system_settings` column).
- `supabase/functions/auto-cancel-preparing/index.ts` — **no
  change** (same as above).
- **New**: `apps/frontend/core/hooks/useCancellationSettings.ts`
  (optional, ~25 lines) to centralize the SLA-hour fallbacks.

## Reusable Hooks / Components

- `useShipmentsByOrder` and `useShipmentById` — already
  shipment-scoped, no change needed.
- `useOrderCountdown` — already accepts `hoursLimit`, no change
  needed.
- `useSystemConfig` — already returns the SLA columns, no change
  needed.
- `OrderActionCard` — already receives `shipment: EnrichedShipment`
  prop. Only the timer config in its memo needs to source from
  `useSystemConfig`.
- `EnrichedShipment.permissions.canCancel` — already driven by
  `shipment.status === 'paid'`, already correct.
- `fn_cancel_shipment` — already correct, used by both crons. No
  code change.

## Risks

| Risk                                                                       | Likelihood | Mitigation                                                                                       |
| -------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| Mixed-state multi-seller refund still happens if PR1 is not deployed first | High       | The split must ship PR1 first; mark PR2 as blocked on PR1. Document in the spec.                 |
| `cancel-order` Edge Function over-refunds legacy single-PI orders          | Medium     | Detect "all shipments share one PI" path; refund once for the full order.                        |
| SLA copy desyncs from cron timing if `system_settings` is not updated      | Low        | Frontend reads the same `system_settings` row the crons read; values stay in lockstep.           |
| `preparing` buyer manual cancel slips through if Edge Function guard fails | Low        | Add a defensive SQL `RAISE EXCEPTION` when `p_cancelled_by_role='buyer' AND status='preparing'`. |
| Whole-order eligibility check races a shipment transition                  | Medium     | `fn_cancel_order` already takes `FOR UPDATE` on the order row. Re-validate under the same lock.  |
| `shipmentId` from a different order is accepted                            | Low        | Validate in Edge Function before any Stripe call. Add a typed rejection in the registry.         |
| `is_maintenance` collides with another consumer                            | Low        | Grep at apply time; coordinate with backend owner if a new collision is found.                   |

## Ready for Proposal

Yes. The code map is verified, the `system_settings` inventory is
complete, the state matrix is finalized, and the Stripe refund path
is understood. Recommend shipping this change as the two-PR split
described above so the backend safety land before the frontend
wiring can trigger it.

## Non-Goals

- Disputes module changes.
- Connect manual payout release logic (this change must not block
  release in any state).
- New customer-facing cancel UX beyond scope correction.
- Renaming the deployed `cancel-order` Edge Function (legacy name
  kept for compatibility, with comments clarifying the
  shipment-scoped behavior).
