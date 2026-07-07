# Delta for Connect Checkout

## ADDED Requirements

### Requirement: CON-002 — Per-Seller PaymentIntent Orchestration

The system MUST create one `PaymentIntent` per seller in a multi-seller order, each with `transfer_data.destination = seller.stripe_account_id` and `application_fee_amount = 6% of seller subtotal`. The `create-connect-payment` edge function MUST return `{ orderId, paymentIntents: [{ sellerId, shipmentId, clientSecret, amount }] }`. If any PI fails post-confirmation, the system MUST refund successful siblings and release product reservations.

#### Scenario: Buyer checks out with items from two sellers

- GIVEN a cart with products from seller A ($500) and seller B ($300)
- WHEN the buyer confirms checkout
- THEN the system creates two PIs: PI_A with `application_fee_amount = 3000` (6% of $500) and PI_B with `application_fee_amount = 1800` (6% of $300), each with correct `transfer_data.destination`

#### Scenario: One of three PaymentIntents fails post-confirmation

- GIVEN a 3-seller order where PI_A and PI_B succeeded but PI_C fails
- WHEN the orchestrator detects PI_C failure
- THEN the system refunds PI_A and PI_B with idempotency keys `checkout_rollback_{orderId}_{piId}`, releases all product reservations, and returns `PARTIAL_PAYMENT_ROLLED_BACK`

#### Scenario: Seller not onboarded blocks their cart items

- GIVEN a cart contains items from a seller with `stripe_onboarding_status != 'complete'`
- WHEN the buyer attempts checkout
- THEN the system blocks checkout and displays an onboarding-required message for that seller's items

#### Scenario: Buyer sees per-seller charge breakdown

- GIVEN a multi-seller checkout
- WHEN the payment screen renders
- THEN the UI displays a breakdown showing each seller's subtotal, 6% commission, and shipping cost separately

### Requirement: CON-007 — Dual-Path Webhook Routing

The `stripe-webhooks` edge function MUST route events by `metadata.seller_id` presence: if present, route to Connect path (`fn_create_shipment_from_payment`); if absent, route to legacy path (`fn_create_order_from_payment`). Failed events MUST be stored in `webhook_dlq` with retry capability.

#### Scenario: Connect multi-PI webhook arrives

- GIVEN a `payment_intent.succeeded` event with `metadata.seller_id` present
- WHEN the webhook handler processes the event
- THEN it routes to the Connect path, calls `fn_create_shipment_from_payment`, and marks the shipment as paid

#### Scenario: Legacy single-PI webhook arrives

- GIVEN a `payment_intent.succeeded` event without `metadata.seller_id`
- WHEN the webhook handler processes the event
- THEN it routes to the legacy path and calls `fn_create_order_from_payment`

### Requirement: CON-008 — Connect-Aware Order Lifecycle

The system MUST skip wallet release operations for Connect-era shipments identified by `shipments.stripe_payment_intent_id IS NOT NULL`. The `fn_release_shipment_funds` and `fn_cron_release_shipment_funds` functions MUST include a guard: `WHERE stripe_payment_intent_id IS NULL`.

#### Scenario: Connect-era shipment completes after 48h

- GIVEN a shipment with `stripe_payment_intent_id` set and status `delivered` for 48h
- WHEN `fn_cron_release_shipment_funds` executes
- THEN the shipment is skipped and no wallet writes occur

#### Scenario: Legacy shipment completes with wallet release

- GIVEN a shipment with `stripe_payment_intent_id IS NULL` and status `delivered` for 48h
- WHEN `fn_cron_release_shipment_funds` executes
- THEN the system calls `fn_release_shipment_funds` and moves pending balance to available

### Requirement: CON-011 — Connect Payment Reconciliation

The system MUST provide a `reconcile-connect-payments` edge function that scans pending draft shipments and matches them against Stripe PIs by metadata (`order_id`, `shipment_id`), then calls `fn_create_shipment_from_payment` for unmatched successes.

#### Scenario: Missed webhook is reconciled

- GIVEN a Connect PI succeeded but webhook never fired, leaving shipment in `draft` status
- WHEN `reconcile-connect-payments` runs
- THEN it finds the matching Stripe PI, calls `fn_create_shipment_from_payment`, and updates shipment status to `paid`
