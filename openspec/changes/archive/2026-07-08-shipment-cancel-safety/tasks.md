# Tasks: Shipment Cancel Safety

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 backend → PR 2 frontend/types |
| Delivery strategy | single-pr-default |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
800-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR |
|------|------|-----|
| 1 | Backend: SQL buyer branch + shipment-scoped `cancel-order` | PR 1 |
| 2 | Frontend/types wiring, SLA settings, tests | PR 2 |

## Phase 1: Foundation

- [x] 1.1 Update `packages/types/src/index.ts` `EdgeFunctionRegistry['cancel-order']` payload to require `shipmentId` and optional `reason`.
- [x] 1.2 Create `apps/frontend/core/hooks/useCancellationSettings.ts` exposing `orderExpirationHours`/`preparingExpirationHours` from `useSystemConfig` with 48/72 fallbacks.
- [x] 1.3 Modify `supabase/queries/orders/fn_cancel_shipment.sql` to add a `buyer` branch validating `auth.uid() = order.buyer_id` and `status = 'paid'`; keep `system` branch unchanged.

## Phase 2: Backend Safety

- [x] 2.1 In `supabase/functions/cancel-order/index.ts`, add a legacy-name comment, require `shipmentId`, and reject missing scope with 422.
- [x] 2.2 Add `system_settings.is_maintenance` gate before mutation; reject with 503 when true.
- [x] 2.3 Enforce buyer-only auth (403) and verify the shipment belongs to the order and buyer.
- [x] 2.4 Reject non-`paid` status (422); keep `preparing` cron-only.
- [x] 2.5 Block refund and log `CRITICAL` when `shipment.stripe_transfer_id IS NOT NULL`.
- [x] 2.6 Compute explicit refund amount from `order_items` for the requested shipment: `SUM(price_at_purchase + COALESCE(shipping_amount,0)) * 100`.
- [x] 2.7 Create Stripe refund with metadata `{ shipment_id, order_id, caller_role: 'buyer', reason }` and idempotency key `cancel_shipment_${shipmentId}`.
- [x] 2.8 Set `reverse_transfer` only when the PI has an associated transfer; omit for platform-held single-modal PIs.
- [x] 2.9 Call `fn_cancel_shipment` using a service-role Supabase client after Edge Function actor validation; pass explicit audited actor role for DB logging.

## Phase 3: Frontend Wiring

- [x] 3.1 Modify `apps/frontend/core/hooks/useShipments.ts` so `permissions.canCancel = isBuyer && shipment.status === 'paid'`.
- [x] 3.2 Update `apps/frontend/core/hooks/useOrderActions.ts` `cancelOrder` to accept `{ shipmentId; reason? }`, invoke `cancel-order` with `orderId` + `shipmentId`, and invalidate `['shipments', orderId]`.
- [x] 3.3 Update `apps/frontend/app/profile/orders/[id].tsx` ConfirmDialog `onConfirm` to pass `shipmentId: currentShipment?.id`.
- [x] 3.4 Update `apps/frontend/components/features/orders/OrderActionCard.tsx` to read cancellation/preparing SLA hours from `useCancellationSettings`; leave dispute timers and unboxing notice untouched.
- [x] 3.5 Make the preparing-window SLA banner actor-aware in `apps/frontend/components/features/orders/OrderActionCard.tsx` so buyer and seller copy stay distinct.

## Phase 4: Testing & Verification

- [x] 4.1 RED: write failing `useShipments` test for seller and non-`paid` `canCancel=false`.
- [x] 4.2 GREEN: implement gate to pass the test.
- [x] 4.3 RED: write failing Edge Function tests for missing `shipmentId`, seller, non-paid, cross-order, maintenance, and transfer-id block.
- [x] 4.4 GREEN: implement guards and pass tests.
- [x] 4.5 RED: write failing refund test for amount, metadata, idempotency key, and no `reverse_transfer` on platform PI.
- [x] 4.6 GREEN: implement refund and `reverse_transfer` handling; pass tests.
- [x] 4.7 Run `bun test`, per-workspace typechecks, and SQL smoke test: no cross-shipment mutation.

## Phase 5: Focused Extension

- [x] 5.1 Add the shared refund-basis helper and rewire `cancel-order` to re-export it for existing tests.
- [x] 5.2 Allow seller-initiated manual cancel only for the seller's own `paid` shipment; keep `preparing` cron-only.
- [x] 5.3 Update frontend cancel eligibility so sellers see the CTA only on their own `paid` shipment.
- [x] 5.4 Reuse the buyer-paid refund basis in both auto-cancel crons and exclude seller-paid shipping from the refund amount.
