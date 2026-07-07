# Exploration: single-modal-multiseller-checkout

## Current State

Selene's checkout already uses Stripe Connect, but it exposes the buyer to one Stripe PaymentSheet modal per seller:

- **Frontend**: `checkout/index.tsx` → `checkout/payment.tsx` → `usePaymentProcess` calls `create-connect-payment` and loops through `paymentIntents[]`, calling `initPaymentSheet` + `presentPaymentSheet` once per seller. `useCheckoutStore` tracks a list of `clientSecrets`, confirmed sellers, and the current seller index.
- **Edge function**: `create-connect-payment` groups cart items by seller, validates onboarding, then creates one destination-charge `PaymentIntent` per seller (`transfer_data.destination` + `application_fee_amount`). It returns an `orderGroupId` plus an array of per-seller client secrets.
- **Webhook**: `stripe-webhooks` routes `payment_intent.succeeded` by the presence of `metadata.seller_id` to `fn_create_shipment_from_payment`, which creates/upserts the order and per-seller shipments, marks products `SOLD`, and skips wallet writes.
- **Lifecycle**: Funds land directly in each seller's Connect account. `release-connect-payout` (admin/manual) releases funds to bank after delivery. `cancel-order` and `resolve-dispute-refund` use `reverse_transfer: true` on the per-seller PaymentIntent.
- **Reservation hardening (PR1, reusable)**: `fn_reserve_products` / `fn_release_products` with a 10-minute TTL is safe to keep unchanged; the reservation model is independent of how money is split after checkout.

## Affected Areas

- `apps/frontend/core/hooks/usePaymentProcess.ts` — replace the per-seller PaymentSheet loop with a single PaymentSheet for one platform PaymentIntent.
- `apps/frontend/core/utils/connectPayment.ts` — response schema changes from `paymentIntents[]` to a single `{ clientSecret, transferGroup, amount }`.
- `apps/frontend/core/store/useCheckoutStore.ts` — simplify state: one client secret, no seller-index tracking.
- `apps/frontend/app/checkout/payment.tsx` — render one total, remove descriptor/loop UI concerns.
- `supabase/functions/create-connect-payment/index.ts` + `fee-calculator.ts` — create one platform PaymentIntent with `transfer_group`; compute per-seller transfer amounts but do **not** set `transfer_data` or `application_fee_amount`.
- `supabase/functions/stripe-webhooks/index.ts` — on SCT success, create per-seller `Transfer` objects (with `source_transaction` linking to the platform charge) before/while creating the order and shipments.
- `supabase/queries/orders/fn_create_shipment_from_payment.sql` — accept the new SCT metadata shape and, optionally, persist `transfer_group`.
- `supabase/functions/reconcile-connect-payments/index.ts` — must also create missing per-seller transfers for an SCT PaymentIntent.
- `supabase/functions/cancel-order/index.ts` — reverse the per-seller Transfers instead of using `reverse_transfer` on destination charges.
- `supabase/functions/resolve-dispute-refund/index.ts` — same transfer-reversal logic for SCT-era disputes.
- `packages/types/src/index.ts` — update `EdgeFunctionRegistry['create-connect-payment']` response and related SCT types.
- DB schema — add `shipments.stripe_transfer_id` (nullable string) so refunds/disputes can reverse the correct transfer. Optionally add `orders.stripe_transfer_group` for grouping/audit.
- `apps/admin-web` Connect earnings/payout views — currently built around `shipments.stripe_payment_intent_id` and `application_fee_amount`; may need updates because SCT has no `application_fee_amount` and the platform PI is shared across shipments.

## Approaches

### 1. Keep per-seller destination charges (status quo) + UX band-aid

- **Description**: Retain one PaymentIntent per seller; try to mask the UX with a single spinner and sequential auto-present modals.
- **Pros**: No backend money-flow changes; existing dispute/refund/payout code remains valid.
- **Cons**: Buyer still sees multiple modals/charges; violates the stated goal; fragile auto-sequencing.
- **Effort**: Low, but does not solve the problem.

### 2. SCT with immediate per-seller transfers on payment success (recommended)

- **Description**: Create one platform PaymentIntent with `transfer_group`. In the webhook, create one `Transfer` per seller using `source_transaction: <platform charge id>` ( Stripe automatically groups them by `transfer_group`). Store each `Transfer.id` on the shipment.
- **Pros**: One buyer modal/one charge; financial outcome equivalent to current flow; funds reach seller Connect accounts immediately; keeps the existing manual payout release model.
- **Cons**: Refunds/disputes must reverse transfers manually; webhook must be idempotent and handle partial transfer failure; platform is liable for refunds until transfers are reversed.
- **Effort**: Medium–Large.

### 3. SCT with delayed transfers until delivery/payout

- **Description**: Charge the buyer once on the platform account, hold funds, and create seller Transfers only when the admin triggers payout release.
- **Pros**: Platform retains funds longer; aligns with classic escrow mental model.
- **Cons**: Conflicts with the current "funds in seller Connect account + manual payout release" design; introduces a second money movement step at payout time; risk of charge being refunded before transfers are created; more complex.
- **Effort**: Large.

## Recommendation

**Approach 2 — SCT with immediate transfers on payment success.**

It directly solves the one-modal requirement while preserving Selene's existing Connect account model and manual payout release timing. The main trade-off is moving refund/dispute recovery from `reverse_transfer` on destination charges to explicit `Transfer` reversals, which requires persisting transfer IDs and updating `cancel-order` and `resolve-dispute-refund`.

## Risks

- **Refund/dispute complexity**: SCT refunds debit the platform balance first; we must reverse the specific per-seller Transfer to recover funds. Need stored `transfer_id` per shipment and exact reversal amounts.
- **Transfer creation failure after payment**: If the webhook creates the order but fails to create a seller transfer, the order is in an inconsistent state. Mitigation: create transfers synchronously in the webhook before marking the order `paid`, with idempotency keys, and roll back (refund the platform PI) on any transfer failure.
- **Idempotency**: Webhook retries must not duplicate transfers. Use idempotent `Transfer.create` keys keyed by `order_id` + `seller_id` and check `shipments.stripe_transfer_id` before creating.
- **Platform balance liability**: Until transfers are reversed, the platform covers refunds/chargebacks. Keep a cash reserve and monitor platform balance.
- **Partial reversal / seller insufficient balance**: With manual payouts sellers cannot withdraw before delivery, so reversals should normally succeed. If a transfer reversal fails because the seller account lacks funds, Stripe may create a negative balance; the `losses.payments: 'stripe'` controller setting protects the platform from chargeback liability but does not automatically cover every refund shortfall—verify behavior in test mode.
- **Connect account capabilities**: Transfers into connected accounts require the `transfers` capability. The current v1 fallback requests it explicitly; the v2 controller uses a merchant configuration that should enable it, but this must be validated with Stripe test accounts.
- **Currency constraint**: All transfers must be in `mxn`, the same as the charge. Selene is MXN-only today, so this is satisfied.
- **Reconciliation**: `reconcile-connect-payments` must be updated to detect SCT PaymentIntents and create any missing transfers.
- **Obsoletes paused PR2/PR3 work**: The existing `create-connect-payment` destination-charge implementation and the paused `reservation-lifecycle-hardening` Edge/frontend PRs will need to be reworked or discarded.

## Implementation Size

**Medium to large**, not a tiny patch. Estimated 800–1200 changed lines across frontend, Edge Functions, SQL, types, and tests. This exceeds the 400-line review budget, so delivery must be split into chained PRs, for example:

1. Schema additions (`shipments.stripe_transfer_id`, `orders.stripe_transfer_group`) + backend `create-connect-payment` rewrite.
2. Webhook SCT transfer creation + `fn_create_shipment_from_payment` updates + reconciliation.
3. Frontend single PaymentSheet refactor.
4. Refund/cancel/dispute transfer reversals + tests.
5. Admin/audit view updates.

## Ready for Proposal

**Yes — proceed to `sdd-propose` (+ `sdd-spec` immediately after).**

The orchestrator should tell the user:

- SCT is technically viable and recommended.
- It is a medium/large change that supersedes the paused destination-charge PR2/PR3 work.
- It requires accepting platform liability for refunds until transfers are reversed.
- Delivery must be sliced into chained PRs because it will exceed the 400-line review budget.
