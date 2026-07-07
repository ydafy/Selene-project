# Tasks: Single-Modal Multi-Seller Checkout

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Est. ~1,500–1,800 lines. Needs 5 chained PRs.

| Unit | Goal | Likely PR |
|------|------|-----------|
| 1 | DB migration + types + contracts | PR 1 |
| 2 | fee-calculator + single-PI create-connect-payment | PR 2 |
| 3 | Webhook + SQL settlement function | PR 3 |
| 4 | release-connect-payout Transfer step | PR 4 |
| 5 | Frontend single modal + retire SellerPaymentBreakdown | PR 5 |

## Phase 1: DB & Types

- [x] 1.1 Migration: add `orders.stripe_charge_id`, `orders.stripe_transfer_group`, `orders.payment_processing`, `orders.payment_processing_reason`, `shipments.stripe_transfer_id` + indexes
- [x] 1.2 Update `admin_connect_payout_release_view` to surface `transfer_group`, `stripe_transfer_id` (appended at the tail; original column order preserved for CREATE OR REPLACE VIEW compatibility)
- [x] 1.3 Update `packages/types/src/index.ts` hand-written shared contracts: new `CreateConnectPaymentResponse` (single secret), `EdgeFunctionRegistry` contracts, `ReleaseConnectPayoutResponse` Transfer field
- [x] 1.4 (manual, post-migration) Run `bun db:types` to regenerate `packages/types/src/database.types.ts` (orders/shipments row types). Verified generated fields present: `orders.stripe_charge_id`, `orders.stripe_transfer_group`, `orders.payment_processing`, `orders.payment_processing_reason`, `shipments.stripe_transfer_id` (row + Insert + Update) and view `stripe_transfer_id`. `database.types.ts` is generated, not hand-edited.

## Phase 2: Fee Calculator

- [x] 2.1 Refactor `fee-calculator.ts`: return `AllocationRow[]` per seller (gross, commission, shipping, seguro, net)
- [x] 2.2 Update `fee-calculator.test.ts` for new allocation output
- [x] 2.3 (corrective rev 3) Add explicit `shipmentId` to `SellerAllocationInput` + `AllocationRow`; `calculateCheckoutAllocation` rejects missing/empty/duplicate shipment ids; `assertValidCheckoutAllocation` rejects missing/duplicate shipment correlation. Multi-seller allocation tests preserve each row's shipment id and prevent ambiguous correlation. Phase 3 single-PI runtime still untouched.

## Phase 3: Single-PI Payment

- [x] 3.1 Rewrite `create-connect-payment/index.ts`: one platform PI with `transfer_group`, no `transfer_data.destination` / `application_fee_amount`
- [x] 3.2 Return `{ orderId, clientSecret, customer, ephemeralKey, amount, transferGroup }`; add idempotency key on PI
- [x] 3.3 Embed allocation JSON + `transfer_group` in PI metadata
- [x] 3.4 (corrective rev — fresh-review blockers) Check `fn_reserve_products` `{ success:false }` soft-fail (blocks PI creation); deterministic Stripe idempotency (orderGroupId/transfer_group/shipment ids derived from idempotency key, allocation rows sorted by sellerId for byte-deterministic body); metadata chunking completes (seller_ids/shipment_ids/seller_product_ids folded into chunked allocation rows, no redundant top-level keys); connectMoneyFlowGuards + connectPayoutContracts updated to the new SCT contract. Builder tests 25/25, guards 14/14, packages/types tsc OK.
- [x] 3.5 (bugfix) Normalize the Supabase `fn_reserve_products` RPC result in `create-connect-payment` so the Edge Function accepts the array row shape returned by PostgREST, still throws `RESERVATION_FAILED` for `success:false`, and logs the RPC shape/error payload for diagnosis.

## Phase 4: Webhook & Settlement

- [x] 4.1 Create `fn_create_shipments_from_single_payment.sql`: one-txn creating order+all shipments+items, `payment_processing` on failure, idempotent
- [x] 4.2 Modify `stripe-webhooks/index.ts`: route `flow='single_modal_connect_checkout'`, persist `stripe_charge_id` + `transfer_group`
- [x] 4.3 On failure: set `payment_processing=true` + reason, return 200 (retry-safe)
- [x] 4.4 Keep `payment_intent.payment_failed`/`.canceled` product release

## Phase 5: Release Payout Transfer

- [x] 5.1 Add `createStripeTransfer` to `release-connect-payout.ts`: platform→seller Transfer with `transfer_group`, `source_transaction`, per-shipment idempotency
- [x] 5.2 Pre-Payout: iterate shipments, create/reuse Transfer via `stripe_transfer_id` check, store returned ID
- [x] 5.3 Gate: reject if `transfer_group` or `stripe_charge_id` missing (legacy compat)
- [x] 5.4 If balance insufficient after Transfer → `pending_reconciliation`, admin-visible recovery
- [x] 5.5 Update `release-connect-payout.test.ts`

## Phase 6: Frontend

- [x] 6.1 Rewrite `usePaymentProcess.ts`: one `initPaymentSheet`/`presentPaymentSheet`, remove seller loop
- [x] 6.2 Rewrite `useCheckoutStore.ts`: replace `clientSecrets[]`/`confirmedSellers`/`currentSellerIndex` with single `clientSecret`
- [x] 6.3 Update `connectPayment.ts`: new Zod schema, remove `buildSellerChargeBreakdown` from checkout
- [x] 6.4 Update `checkout/payment.tsx`: single amount from one secret
- [x] 6.5 Update `checkout/index.tsx`: remove `SellerPaymentBreakdown` import/usage; keep `SummaryBreakdown`

## Phase 7: Verification

- [x] 7.1 Test: PI has `transfer_group`, no `transfer_data.destination`
- [x] 7.2 Test: webhook creates order+all shipments in one txn; duplicate PI idempotent
- [x] 7.3 Test: release creates Transfer before Payout; skips if `stripe_transfer_id` exists; rejects missing `transfer_group`
- [x] 7.4 Test: PI success + DB fail → `payment_processing=true` shell, retry recovers
- [x] 7.5 Test: legacy per-seller flow still works via `flow` metadata toggle
