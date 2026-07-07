# Delta Specs: Stripe Connect Express Migration

## CON-001: Stripe Connect Onboarding

**Status**: NEW  
**Domain**: `connect-onboarding`

### Requirement: Seller MUST complete Stripe Connect onboarding before generating first shipping label

The system SHALL enforce Stripe Connect onboarding when a seller attempts to generate their first shipping label after a sale. Sellers MAY list products without onboarding, but MUST NOT ship orders until `stripe_account_id` exists and `charges_enabled = true`.

#### Scenario: First-time seller initiates onboarding

- GIVEN a seller with no `stripe_account_id` in `profiles_private`
- WHEN the seller attempts to generate a shipping label for their first sale
- THEN the system blocks label generation with status `SELLER_NOT_ONBOARDED`
- AND redirects seller to the onboarding flow

#### Scenario: Seller completes Stripe-hosted onboarding

- GIVEN a seller clicks "Start selling"
- WHEN `create-connect-account` edge function is called
- THEN the system creates Stripe Account v2 with controller properties: `losses.payments: 'stripe'`, `fees.payer: 'application'`, `stripe_dashboard.type: 'full'`, `requirement_collection: 'stripe'`
- AND generates AccountLink with `use_case.type: 'account_onboarding'`
- AND redirects seller to AccountLink URL
- AND stores `stripe_account_id` in `profiles_private`
- AND sets `stripe_onboarding_status = 'pending'`

#### Scenario: Stripe confirms seller KYC completion

- GIVEN a seller completes onboarding on Stripe's hosted page
- WHEN `account.updated` webhook fires with `charges_enabled: true`
- THEN the system updates `profiles_private.stripe_onboarding_status = 'complete'`
- AND allows seller to generate shipping labels

#### Scenario: Seller onboarding rejected by Stripe

- GIVEN Stripe rejects a seller's KYC documents
- WHEN `account.updated` webhook fires with `charges_enabled: false`
- THEN the system sets `stripe_onboarding_status = 'rejected'`
- AND blocks shipping label generation
- AND displays rejection reason to seller

---

## CON-002: Multi-Seller Checkout with Destination Charges

**Status**: NEW  
**Domain**: `multi-seller-checkout-connect`

### Requirement: Checkout MUST create one PaymentIntent per seller with destination charges

The system SHALL group cart items by seller and create separate PaymentIntents with `transfer_data.destination` and `application_fee_amount` for each seller. Buyer checkout MAY result in multiple charges on their card statement.

#### Scenario: Buyer checks out with items from two sellers

- GIVEN cart contains GPU from Seller A ($500) and RAM from Seller B ($150)
- AND both sellers have `stripe_account_id` with `charges_enabled = true`
- WHEN buyer confirms checkout
- THEN the system creates PaymentIntent A with `amount = 500 * 100`, `transfer_data.destination = sellerA.stripe_account_id`, `application_fee_amount = 500 * 0.06 * 100`
- AND creates PaymentIntent B with `amount = 150 * 100`, `transfer_data.destination = sellerB.stripe_account_id`, `application_fee_amount = 150 * 0.06 * 100`
- AND reserves products via `fn_reserve_products`

#### Scenario: One of three PaymentIntents fails post-confirmation

- GIVEN buyer confirmed checkout with 3 sellers (A, B, C)
- AND PaymentIntents A and B succeeded
- WHEN PaymentIntent C fails with `payment_failed`
- THEN the system refunds PaymentIntents A and B immediately
- AND releases product reservations for all items
- AND surfaces error to buyer with retry option

#### Scenario: Seller not onboarded blocks their cart items

- GIVEN cart contains items from Seller A (onboarded) and Seller B (not onboarded)
- WHEN buyer attempts checkout
- THEN the system blocks checkout with error `SELLER_NOT_ONBOARDED`
- AND displays message: "Seller [Name] must complete onboarding before this item can be purchased"

#### Scenario: Buyer sees per-seller charge breakdown

- GIVEN cart with items from 2 sellers
- WHEN buyer reviews checkout summary
- THEN the system displays per-seller subtotals with "You will see N charges on your card statement"
- AND each charge is labeled with seller descriptor

---

## CON-003: Stripe Connect Refunds with Reverse Transfer

**Status**: NEW  
**Domain**: `connect-refund`

### Requirement: Dispute refunds MUST use reverse_transfer to pull funds from seller's connected account

The system SHALL use `stripe.refunds.create({ reverse_transfer: true })` when processing buyer-wins disputes, automatically reversing the transfer and application fee.

#### Scenario: Admin triggers refund after buyer-wins dispute

- GIVEN dispute resolved in buyer's favor
- AND shipment has `stripe_payment_intent_id` (Connect-era order)
- WHEN admin calls `resolve-dispute-refund`
- THEN the system creates Stripe refund with `reverse_transfer: true` and `amount = shipment_total_cents`
- AND Stripe pulls funds from seller's connected account
- AND reverses proportional `application_fee_amount`
- AND updates `shipments.status = 'refunded'`

#### Scenario: Seller has insufficient Connect balance for refund

- GIVEN seller already withdrew funds to bank account
- WHEN admin triggers refund with `reverse_transfer: true`
- THEN Stripe creates negative balance on seller's connected account
- AND platform is NOT liable (due to `losses.payments: 'stripe'`)
- AND refund completes successfully for buyer

#### Scenario: Refund for legacy wallet-era order

- GIVEN order created before Connect cutover (no `stripe_payment_intent_id` on shipment)
- WHEN admin triggers refund
- THEN the system falls back to legacy refund flow (Stripe refund + `fn_complete_shipment_refund` wallet rollback)
- AND does NOT attempt `reverse_transfer`

---

## CON-004: Seller-Paid Return Shipping via Connected Account

**Status**: NEW  
**Domain**: `connect-return-label`

### Requirement: Return shipping label MUST charge seller's connected account

The system SHALL create a separate PaymentIntent on the seller's connected account for $300 MXN return shipping cost when buyer wins a dispute and ships product back.

#### Scenario: Seller pays for return label after buyer-wins verdict

- GIVEN dispute status is `waiting_return`
- AND seller has `stripe_account_id` with `charges_enabled = true`
- WHEN seller generates return label
- THEN the system calls `create-return-intent` with `amount = 30000` (300 MXN * 100)
- AND creates PaymentIntent on seller's connected account using saved payment method
- AND sets `on_behalf_of = seller.stripe_account_id`
- AND metadata includes `dispute_id`, `shipment_id`, `purpose: 'return_shipping'`

#### Scenario: Return label payment fails due to insufficient funds

- GIVEN seller's payment method is declined
- WHEN `create-return-intent` attempts to charge seller
- THEN the system retries with seller's default payment method
- AND if all methods fail, dispute status remains `waiting_return`
- AND admin is notified via `admin_audit_logs`

#### Scenario: Return tracking confirms delivery

- GIVEN buyer shipped return with tracking number
- WHEN `track-returns` cron detects `status = 'DELIVERED'`
- THEN the system updates dispute status to `return_delivered`
- AND enables admin to trigger final refund

---

## CON-005: Legacy Wallet Mass Payout

**Status**: NEW  
**Domain**: `legacy-wallet-drain`

### Requirement: System MUST transfer all existing wallet balances to sellers' Connect accounts in one-time migration

The system SHALL create Stripe Transfers for all sellers with `wallets.available_balance > 0`, transferring funds to their `stripe_account_id`, and zero out wallet balances.

#### Scenario: Mass drain of wallet balances to Connect accounts

- GIVEN 50 sellers have `available_balance > 0` in `wallets`
- AND all have `stripe_account_id` with `payouts_enabled = true`
- WHEN admin runs `drain-legacy-wallets` edge function
- THEN the system creates one `stripe.transfers.create` per seller with `amount = available_balance_cents`, `destination = stripe_account_id`, `description: 'Legacy wallet migration'`
- AND records each Transfer ID in `wallet_transactions` with `type = 'payout'`, `notes = 'Connect migration drain'`
- AND sets `wallets.available_balance = 0` for all migrated sellers
- AND writes success audit to `admin_audit_logs`

#### Scenario: Seller has zero wallet balance

- GIVEN seller has `available_balance = 0`
- WHEN drain script runs
- THEN the system skips Transfer creation for that seller
- AND logs "Skipped (zero balance)" in audit

#### Scenario: Transfer fails for one seller

- GIVEN seller's Connect account is restricted (`payouts_enabled = false`)
- WHEN drain script attempts Transfer
- THEN the system logs failure to `admin_audit_logs` with error reason
- AND does NOT zero out that seller's `available_balance`
- AND continues processing remaining sellers
- AND admin can manually retry failed transfers

---

## CON-006: Order Creation Without Wallet Operations

**Status**: MODIFIED  
**Domain**: `order-creation`  
(Previously: `fn_create_order_from_payment` created orders and wrote to `wallets.pending_balance`)

### Requirement: Order creation MUST skip wallet writes for Connect-era orders

The system SHALL create orders from `payment_intent.succeeded` webhooks without crediting `wallets` or `wallet_transactions` when `shipments.stripe_payment_intent_id` is present.

#### Scenario: Connect-era order created from webhook

- GIVEN `payment_intent.succeeded` webhook fires
- AND metadata contains `order_id`, `shipment_id`, `seller_id`
- WHEN `stripe-webhooks` calls `fn_create_order_from_payment`
- THEN the system creates/updates order with `status = 'paid'`
- AND stores `stripe_payment_intent_id` on `shipments` row
- AND marks `products.status = 'SOLD'`
- AND does NOT write to `wallets` or `wallet_transactions`

#### Scenario: Legacy order created before cutover

- GIVEN order has no `shipments.stripe_payment_intent_id` (created before Connect)
- WHEN `fn_create_order_from_payment` is called
- THEN the system creates order AND credits `wallets.pending_balance` (legacy behavior)
- AND writes to `wallet_transactions` with `type = 'sale'`

#### Scenario: Multi-seller order receives all PaymentIntent webhooks

- GIVEN order with 3 sellers (A, B, C) created 3 separate PaymentIntents
- WHEN `payment_intent.succeeded` fires for A, then B, then C
- THEN the system updates `shipments.stripe_payment_intent_id` for each shipment
- AND order remains `status = 'paid'` until all shipments confirm
- AND products for each seller are marked `SOLD` only after their PI succeeds

---

## CON-007: Dual-Path Webhook Routing

**Status**: MODIFIED  
**Domain**: `webhook-routing`  
(Previously: `stripe-webhooks` handled only single-PI orders)

### Requirement: Webhooks MUST route legacy single-PI and new multi-PI orders without crossover

The system SHALL distinguish between legacy wallet-era orders and Connect-era orders using presence of `shipments.stripe_payment_intent_id` and route webhook logic accordingly.

#### Scenario: Legacy single-PI webhook arrives

- GIVEN `payment_intent.succeeded` webhook with `payment_intent.id = pi_legacy123`
- AND no metadata for `shipment_id` (legacy format)
- WHEN `stripe-webhooks` processes event
- THEN the system calls `fn_create_order_from_payment` with wallet writes enabled
- AND creates order with `orders.stripe_payment_intent_id = pi_legacy123`

#### Scenario: Connect multi-PI webhook arrives

- GIVEN `payment_intent.succeeded` webhook with metadata `{ order_id, shipment_id, seller_id }`
- WHEN `stripe-webhooks` processes event
- THEN the system updates `shipments.stripe_payment_intent_id = pi_connect456`
- AND does NOT write to `wallets`
- AND upserts order if first PI, or updates existing order if subsequent PI

#### Scenario: Dual-path period with mixed order types

- GIVEN 10 legacy orders in `preparing` status (pre-cutover)
- AND 5 new Connect orders in `paid` status (post-cutover)
- WHEN webhooks arrive for both types
- THEN the system correctly routes each based on `created_at` timestamp and `shipment_id` presence
- AND does NOT apply Connect logic to legacy orders
- AND does NOT apply wallet logic to Connect orders

---

## CON-008: Order Lifecycle Without Wallet Escrow Release

**Status**: MODIFIED  
**Domain**: `order-lifecycle`  
(Previously: `delivered → completed` transition released `pending_balance → available_balance`)

### Requirement: Order completion MUST NOT trigger wallet fund release for Connect-era orders

The system SHALL transition shipments from `delivered` to `completed` without calling `fn_release_shipment_funds` when `shipments.stripe_payment_intent_id` is present.

#### Scenario: Connect-era shipment completes after 48h

- GIVEN shipment with `status = 'delivered'` and `delivered_at = NOW() - 48 hours`
- AND `stripe_payment_intent_id` is present (Connect order)
- WHEN `fn_derive_order_status` trigger fires
- THEN the system updates `shipments.status = 'completed'`
- AND does NOT call `fn_release_shipment_funds`
- AND does NOT write to `wallet_transactions`
- AND Stripe handles payout on its automatic daily schedule

#### Scenario: Legacy shipment completes with wallet release

- GIVEN shipment with `status = 'delivered'` and no `stripe_payment_intent_id` (legacy order)
- WHEN 48h grace period expires
- THEN the system calls `fn_release_shipment_funds`
- AND moves `pending_balance → available_balance` in `wallets`
- AND writes to `wallet_transactions` with `type = 'release'`

#### Scenario: Order with mixed legacy and Connect shipments (impossible edge case)

- GIVEN order created during cutover with 1 legacy shipment and 1 Connect shipment (should never happen due to atomic cart grouping)
- WHEN each shipment reaches `delivered`
- THEN the system applies correct logic per shipment based on `stripe_payment_intent_id` presence
- AND legacy shipment triggers wallet release
- AND Connect shipment skips wallet release

---

## CON-009: Dispute Resolution with Connect Refunds

**Status**: MODIFIED  
**Domain**: `dispute-resolution`  
(Previously: Dispute refunds rolled back `wallet_transactions` and created Stripe refund)

### Requirement: Dispute verdicts MUST trigger Stripe reverse-transfer refunds instead of wallet adjustments

The system SHALL use `reverse_transfer: true` for Connect-era dispute refunds and skip wallet rollback when buyer wins.

#### Scenario: Buyer-wins dispute triggers Connect refund

- GIVEN dispute with `status = 'return_delivered'`
- AND admin clicks "Refund Buyer"
- WHEN `resolve-dispute-refund` is called
- THEN the system creates Stripe refund with `reverse_transfer: true`, `amount = shipment.total_cents`, `payment_intent = shipment.stripe_payment_intent_id`
- AND does NOT call `fn_complete_shipment_refund` (wallet rollback)
- AND updates `shipments.status = 'refunded'`
- AND writes audit to `admin_audit_logs` with `action = 'dispute_refund_connect'`

#### Scenario: Seller-wins dispute (no refund)

- GIVEN admin rules in seller's favor
- WHEN `resolve-dispute` sets `status = 'resolved_seller_wins'`
- THEN the system closes dispute without financial action
- AND does NOT create Stripe refund
- AND does NOT reverse transfers

#### Scenario: Legacy dispute refund with wallet rollback

- GIVEN dispute for order created before Connect cutover (no `stripe_payment_intent_id` on shipment)
- WHEN admin triggers refund
- THEN the system creates Stripe refund AND calls `fn_complete_shipment_refund`
- AND rolls back `wallet_transactions` for that shipment
- AND updates seller's `wallets.available_balance -= refund_amount`

---

## Coverage Summary

| Domain | Requirements | Scenarios | Edge Cases Covered |
|--------|--------------|-----------|-------------------|
| `connect-onboarding` | 1 | 4 | KYC rejection, first-sale gate |
| `multi-seller-checkout-connect` | 1 | 4 | Partial PI failure, seller not onboarded, per-seller breakdown |
| `connect-refund` | 1 | 3 | Insufficient seller balance, legacy fallback |
| `connect-return-label` | 1 | 3 | Payment failure, tracking delivery |
| `legacy-wallet-drain` | 1 | 3 | Zero balance skip, Transfer failure |
| `order-creation` | 1 | 3 | Multi-PI webhook sequencing |
| `webhook-routing` | 1 | 3 | Dual-path mixed orders |
| `order-lifecycle` | 1 | 3 | Legacy wallet release preserved |
| `dispute-resolution` | 1 | 3 | Legacy wallet rollback fallback |

**Total**: 9 requirements, 29 scenarios
