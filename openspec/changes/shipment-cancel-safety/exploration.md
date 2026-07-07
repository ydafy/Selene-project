# Exploration: shipment-cancel-safety

## Current State

- `apps/frontend/app/profile/orders/[id].tsx` resolves `currentShipment` from `shipment_id`, so the screen can operate in shipment context inside a multi-seller order.
- `apps/frontend/core/hooks/useShipments.ts` sets `currentShipment.permissions.canCancel` from `shipment.status === 'paid'`, which allows a cancel CTA in shipment-scoped UI.
- `apps/frontend/core/hooks/useOrderActions.ts` calls `cancel-order` with `{ orderId, reason }` only.
- `packages/types/src/index.ts` types `cancel-order` as order-scoped only.
- `supabase/functions/cancel-order/index.ts` refunds all non-cancelled shipments in the order and then calls `fn_cancel_order`.
- `supabase/queries/orders/fn_cancel_order.sql` cancels the whole order and reverses all order items, while `supabase/queries/orders/fn_cancel_shipment.sql` already exists for shipment-scoped cancellation.

## Risk

- In mixed-state multi-seller orders, a shipment-level cancel action can trigger whole-order refunds/cancellation for unrelated sellers and shipments.
- This is a critical buyer/seller safety issue because UI scope and backend cancellation scope do not match.

## Recommended Future Scope

- Separate shipment-scoped cancellation from whole-order cancellation end to end.
- Add explicit shipment-aware frontend action wiring for shipment detail context.
- Define a shipment-safe backend contract and use shipment-level cancellation semantics where appropriate.
- Add regression coverage for mixed-state multi-seller orders, shipment-context routing, and legacy whole-order cases.

## Non-Goal

Do not solve this inside `connect-manual-payout-release` unless it is explicitly reprioritized.

## Ready for Proposal

Yes.
