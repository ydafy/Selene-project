# Design: Single-Modal Multi-Seller Checkout

## Technical Approach

Replace the current seller-loop destination-charge flow with one platform `PaymentIntent` returned to PaymentSheet. Seller economics stay internal: `create-connect-payment` reserves products, calculates per-seller allocation, creates one MXN platform PI with `transfer_group`, and stores enough metadata for the webhook/RPC to persist order, shipments, and allocation idempotently. No Stripe `Transfer` or `Payout` is created at payment success; manual admin release later creates shipment-scoped Transfers before Payouts.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Add `payment_processing` to `order_status_enum` | Semantically neat, but enum churn touches generated types and existing status derivation. | Reject. Keep `orders.status='pending'` until allocation is durable; add `orders.payment_processing:boolean`/`payment_processing_reason:text` for ops recovery. |
| Immediate seller Transfers after payment | Simpler payout balance, but violates manual-release constraint. | Reject. Store allocations only; release creates Transfers later. |
| One platform PI with internal allocation | Requires stronger recovery and release changes. | Accept. It is the only path with one buyer modal/charge and manual seller release. |
| Reuse seller breakdown UI | Helps explain old multi-charge UX, but exposes seller split. | Reject. `SummaryBreakdown` remains primary; remove `SellerPaymentBreakdown` from checkout. |

## Data Flow

    checkout/payment.tsx -> usePaymentProcess -> create-connect-payment
      -> reserve products -> calculate allocation -> platform PaymentIntent
      -> PaymentSheet once -> stripe-webhooks payment_intent.succeeded
      -> fn_create_shipment_from_payment -> orders/shipments/order_items
      -> admin release -> Transfer(s) -> Payout -> webhook reconciliation

Failure rule: if payment succeeded but allocation write fails, keep/recover an order shell as `status='pending'`, `payment_processing=true`; retry uses `stripe_payment_intent_id`/`transfer_group` uniqueness and does not duplicate shipments.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/*_single_modal_checkout.sql` | Create | Add `orders.stripe_charge_id`, `orders.stripe_transfer_group`, `orders.payment_processing`, `orders.payment_processing_reason`, `shipments.stripe_transfer_id`, indexes/unique guards; refresh generated types. |
| `supabase/functions/create-connect-payment/index.ts` | Modify | Return single `{ orderId, clientSecret, customer, ephemeralKey, amount, transferGroup }`; remove `transfer_data` and `application_fee_amount`; use request idempotency. |
| `supabase/functions/create-connect-payment/fee-calculator.ts` | Modify | Keep buyer amount = subtotal + Seguro; expose allocation rows per seller/shipment. |
| `supabase/functions/stripe-webhooks/index.ts` | Modify | Route `flow='single_modal_connect_checkout'`; persist charge id and allocation idempotently; mark processing failures. |
| `supabase/queries/orders/fn_create_shipment_from_payment.sql` | Modify | Accept platform PI metadata and allocation JSON; create all shipments/items in one transaction before `paid`. |
| `supabase/functions/release-connect-payout/*` | Modify | Validate allocation/`transfer_group`, create/reuse per-shipment Transfer, store `shipments.stripe_transfer_id`, then create Payout. |
| `apps/frontend/core/hooks/usePaymentProcess.ts` | Modify | Initialize/present PaymentSheet once; remove seller confirmation loop and rollback sibling logic. |
| `apps/frontend/core/store/useCheckoutStore.ts` | Modify | Replace `clientSecrets[]`, `confirmedSellers`, `currentSellerIndex` with one checkout secret/session. |
| `apps/frontend/core/utils/connectPayment.ts` | Modify | Update Zod schema and normalized response; remove seller charge breakdown helpers from checkout path. |
| `apps/frontend/app/checkout/index.tsx` | Modify | Remove buyer-facing `SellerPaymentBreakdown`; keep `SummaryBreakdown`. |
| `packages/types/src/index.ts` | Modify | Update `EdgeFunctionRegistry['create-connect-payment']`, payout release contracts, and exported aliases after DB type refresh. |

## Interfaces / Contracts

```ts
type CreateConnectPaymentResponse = {
  orderId: string;
  clientSecret: string;
  customer: string;
  ephemeralKey: string;
  amount: number;
  transferGroup: string;
};
```

DB references verified today: current `orders` has `stripe_payment_intent_id` but not `stripe_charge_id`/`stripe_transfer_group`; `shipments` has `stripe_payment_intent_id`/`stripe_payout_id` but not `stripe_transfer_id`; `order_status_enum` lacks `payment_processing`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | fee/allocation math, single response schema, release Transfer idempotency | Strict TDD with `bun:test` before implementation. |
| Integration | SQL transaction creates all shipments/items before `paid`; processing flag on failure | SQL/RPC tests with mocked metadata. |
| E2E | One PaymentSheet call and no seller breakdown | Focused Expo hook/component tests; manual Stripe test-mode smoke later. |

## Migration / Rollout

DB/types first, backend single-PI path behind metadata `flow`, frontend switch last. Existing orders without `transfer_group` remain legacy release path; new single-modal orders require allocation and transfer-group gates.

## Open Questions

- [ ] Confirm whether Payout should run immediately after Transfer or move to `pending_reconciliation` when Stripe keeps transferred funds pending.
