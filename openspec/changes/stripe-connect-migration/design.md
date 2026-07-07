# Design: Stripe Connect Migration

## Technical Approach

Migrate money movement out of Selene wallets by adding Connect-aware schema, replacing `create-payment-intent` with a per-seller PaymentIntent orchestrator, and routing webhooks by PaymentIntent metadata. Existing wallet RPCs stay available for legacy rows; Connect rows are identified by `shipments.stripe_payment_intent_id`.

## Architecture Decisions

| Decision | Options | Chosen | Why |
|---|---|---|---|
| Checkout charge model | Single PI + transfers; per-seller destination PI | Per-seller PI with `transfer_data.destination` | Shipment already maps 1 seller; refunds and partial failure compensation are isolated. Buyer sees N charges, but audit is clean. |
| Connect account API | v1 Express account; Accounts v2 | Accounts v2 in `create-connect-account` | Required by Stripe reference and proposal; controller properties explicitly model KYC, fees, dashboard, losses. |
| Order idempotency key | `orders.stripe_payment_intent_id`; shipment PI | Shipment PI + `order_id` metadata | Order-level PI becomes nullable; duplicate webhooks are naturally de-duped per shipment. |
| Wallet removal | Drop tables; deprecate | Deprecate/read-only | Preserves audit and legacy fallback during cutover. |
| Recovery | Manual Stripe dashboard; jobs | DLQ + reconcile jobs | Money events cannot depend on a single webhook attempt. |

## Edge Function Component Tree

```text
create-payment-intent
  auth → read system_settings(connect_enabled) → fn_reserve_products
  load products+sellers+profiles_private → groupBySeller
  create order/shipment draft RPC → create N PIs → rollback/refund on failure

create-connect-account
  auth → existing profile? → Stripe Accounts v2 → AccountLink → profile update

stripe-webhooks
  verify signature → idempotency guard → route(event) → legacy|connect|return|account
  failures → webhook_dlq + admin_audit_logs

resolve-dispute-refund
  admin auth → load dispute+shipment → legacy|connect → Stripe refund → DB sync

drain-legacy-wallets
  admin auth → select wallets available_balance>0 → transfer per seller → audit → zero on success
```

## Data Flow

```text
Cart → useCartStore.groupBySeller → create-payment-intent
     → fn_reserve_products → draft order + shipments
     → PI[A], PI[B], PI[C] → clientSecrets[] → PaymentSheet sequence
     → stripe-webhooks → fn_create_shipment_from_payment → SOLD/paid
```

Rollback: if Seller C PI creation/confirmation fails after A/B succeed, refund A/B with idempotency keys `checkout_rollback_{orderId}_{piId}`, call `fn_release_products(productIds)`, mark draft shipments cancelled, and return retryable `PARTIAL_PAYMENT_ROLLED_BACK`.

## State Machines

```text
Checkout: idle → reserving → creating_pis → awaiting_confirmation
  → succeeded | rolling_back → rolled_back_retryable | failed

Webhook: received → verified → idempotency_checked
  → legacy(fn_create_order_from_payment)
  → connect(fn_create_shipment_from_payment)
  → account_updated(profile onboarding status)
  → acked | dlq
```

Order lifecycle remains shipment-driven: `paid → preparing → shipped → delivered → completed`. `fn_derive_order_status` does not need semantic changes because it only derives from shipment statuses. `fn_release_shipment_funds` and `fn_cron_release_shipment_funds` become legacy-only: skip rows where `shipments.stripe_payment_intent_id IS NOT NULL`.

## Schema Migration Order

1. Create enum `stripe_onboarding_status` (`pending`, `complete`, `rejected`).
2. Add nullable `profiles_private.stripe_account_id`, `profiles_private.stripe_onboarding_status`.
3. Add nullable `shipments.stripe_payment_intent_id` and unique partial index.
4. Make `orders.stripe_payment_intent_id` nullable.
5. Add `system_settings.connect_enabled boolean default false`.
6. Add/replace security-invoker admin views for Connect payments/onboarding.
7. Regenerate `packages/types` aliases.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/functions/create-payment-intent/index.ts` | Modify | Multi-PI orchestrator, rollback, Connect validation. |
| `supabase/functions/create-connect-account/index.ts` | Create | Accounts v2 + AccountLink. |
| `supabase/functions/stripe-webhooks/index.ts` | Modify | Dual-path router, `account.updated`, DLQ idempotency. |
| `supabase/functions/resolve-dispute-refund/index.ts` | Modify | `reverse_transfer: true` for Connect, legacy fallback. |
| `supabase/functions/drain-legacy-wallets/index.ts` | Create | Idempotent wallet drain transfers. |
| `supabase/queries/orders/fn_create_shipment_from_payment.sql` | Create | Connect order/shipment upsert without wallet writes. |
| `supabase/queries/shipments/fn_release_shipment_funds.sql` | Modify | Legacy-only guard. |
| `apps/frontend/core/store/useCheckoutStore.ts` | Modify | Store `clientSecrets[]`, current PI, rollback errors. |
| `apps/frontend/core/store/useCartStore.ts` | Modify | Add seller grouping selector. |
| `apps/admin-web/src/hooks/*payments*` | Modify | Replace payout views/actions with Connect views; no BBVA CSV. |

## Interfaces / Contracts

`create-payment-intent` returns `{ orderId, customer, ephemeralKey, paymentIntents: [{ sellerId, shipmentId, clientSecret, amount, descriptor }] }`. Metadata on every Connect PI includes `app_name`, `flow: connect_checkout`, `order_id`, `shipment_id`, `seller_id`, `product_ids`.

## Error Handling & Recovery

- PI succeeded but webhook never fires: `reconcile-connect-payments` scans pending draft shipments and Stripe PIs by metadata, then calls the same RPC.
- Webhook fires but RPC fails: store `webhook_dlq`; retry worker replays idempotently.
- Seller balance insufficient on refund: Stripe creates negative connected-account balance under `losses.payments: stripe`; log audit, DB marks refunded after Stripe success.
- Transfer fails during drain: audit failure, do not zero wallet, continue sellers.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | grouping, fee math, router detection | Bun tests with Stripe stubs. |
| Integration | RPC idempotency, wallet guards | Supabase local SQL tests. |
| E2E | multi-seller checkout, refund, drain dry-run | Stripe test mode + webhook replay. |

## Open Questions

None blocking; implementation must verify exact Accounts v2 controller payload against the pinned Stripe SDK/API version.
