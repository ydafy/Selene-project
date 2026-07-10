# Design: Shipment Cancel Safety

## Technical Approach

Manual cancellation is shipment-scoped despite the legacy Edge Function name `cancel-order`. The mobile detail screen already resolves `currentShipment` from `/profile/orders/[id]?shipment_id=...`; this change makes both UI permission calculation and backend validation shipment-required, paid-only, and owner-only for buyer or seller. Stripe refunds use an explicit shipment amount before the DB mutation, then `fn_cancel_shipment` performs the atomic wallet/product/status update. Cron cancellation paths remain shipment-scoped and continue using `system`.

Owner detail CTA -> `useOrderActions.cancelOrder({ shipmentId })` -> `cancel-order` -> Stripe partial refund -> `fn_cancel_shipment(..., caller_role)`.

## Architecture Decisions

| Option                                       | Tradeoff                                             | Decision                                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `cancel-order` name                     | Name is confusing, but deployed clients keep working | Keep name; add legacy-name comment and reject missing `shipmentId` with 422.                                                                                                                                                                        |
| Gate seller cancel only in backend           | Safer than UI alone, but sellers still see CTA today | Update `useShipments.ts` to `canCancel: (isBuyer || isSellerOwnShipment) && shipment.status === 'paid'` and keep `[id].tsx` render guarded by `currentShipment.permissions.canCancel`; backend rejects non-owners and non-paid shipments with 403/422. |
| Call SQL as `system` for manual buyer/seller cancel | Avoids SQL change, but audit trail lies              | Use service-role-only RPC after Edge Function actor validation; pass explicit `p_cancelled_by_role` for audit. Cron calls keep `system`, unchanged.                                                                           |
| Broad SLA replacement                        | Easy, but risks changing dispute/release timers      | Only new cancellation/preparing notices use `order_expiration_hours` / `preparing_expiration_hours`; do not replace dispute return-payment, return-shipping, delivery, or payout-release 48h timers unless their semantics are separately verified. |

## Data Flow

`[id].tsx` passes `currentShipment.id`; `useOrderActions.ts` sends `{ orderId, shipmentId, reason }`. `cancel-order` verifies JWT, `system_settings.is_maintenance`, order/shipment relation, caller ownership, `status='paid'`, and `stripe_transfer_id IS NULL` before Stripe. It computes the refund from the shipment subtotal plus the shipment's proportional share of the buyer-paid fee, caps it against the remaining refundable amount when available, refunds with `amount`, metadata `{ shipment_id, order_id, caller_role: 'buyer' | 'seller', reason }`, idempotency key `cancel_shipment_${shipmentId}`, then calls the owner SQL path.

## File Changes

| File                                                           | Action | Description                                                                                                    |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/cancel-order/index.ts`                     | Modify | Require `shipmentId`, owner-only auth, maintenance gate, deterministic refund basis, cap guard, and service-role RPC after refund. |
| `supabase/queries/orders/fn_cancel_shipment.sql`               | Modify | Make the mutation service-role-only; keep `system` audit role for crons and explicit buyer/seller audit metadata. |
| `packages/types/src/index.ts`                                  | Modify | `cancel-order` payload becomes `{ orderId; shipmentId; reason? }`.                                             |
| `apps/frontend/core/hooks/useShipments.ts`                     | Modify | Compute `permissions.canCancel = (isBuyer || isSellerOwnShipment) && shipment.status === 'paid'`.             |
| `apps/frontend/core/hooks/useOrderActions.ts`                  | Modify | Require/forward `shipmentId`; invalidate `shipments`.                                                          |
| `apps/frontend/app/profile/orders/[id].tsx`                    | Modify | Pass `currentShipment.id` and rely on buyer-only permission gate.                                              |
| `apps/frontend/core/hooks/useCancellationSettings.ts`          | Create | Centralize order/preparing cancellation SLA settings with 48/72 fallbacks.                                     |
| `apps/frontend/components/features/orders/OrderActionCard.tsx` | Modify | Use cancellation settings only for cancellation/SLA notices; preserve unboxing warning.                        |

## Interfaces / Contracts

```ts
type CancelShipmentRequest = {
  orderId: string;
  shipmentId: string;
  reason?: string;
};
```

Minimal SQL contract change: `fn_cancel_shipment(UUID, TEXT, TEXT)` is service-role-only; the Edge Function validates the buyer/seller and then passes `p_cancelled_by_role` for audit. `preparing` stays `system`-only for `auto-cancel-preparing`.

Stripe rule: because current settlement stores the platform PaymentIntent on `shipments.stripe_payment_intent_id` and writes `stripe_transfer_id` only on payout release, manual paid cancellation refunds that PaymentIntent with explicit `amount`; omit `reverse_transfer` for platform-held PIs. If `stripe_transfer_id` exists, log CRITICAL and refuse; do not guess a transfer reversal. Refund calculations must exclude seller-paid shipping and cap against the remaining refundable charge when available.

## Testing Strategy

| Layer | What to Test                                                                                                         | Approach                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Unit  | `canCancel` buyer-only and `cancelOrder` payload                                                                     | Hook/helper tests with buyer/seller shipments. |
| Edge  | Missing scope, seller request, cross-order shipment, non-paid states, transfer-id block, amount/metadata/idempotency | `bun test` with mocked Supabase/Stripe.        |
| SQL   | Buyer paid allowed; buyer preparing rejected; system paid/preparing preserved                                        | SQL guard tests or migration smoke script.     |
| UI    | Seller CTA hidden; buyer paid CTA shown; unboxing notice preserved                                                   | Screen/component tests or manual Expo smoke.   |

## Migration / Rollout

Deploy SQL first, then Edge Function, then frontend/types. No table migration required. Roll back by redeploying previous Edge/frontend; crons remain compatible because `system` behavior is unchanged.

## Open Questions

None blocking.
