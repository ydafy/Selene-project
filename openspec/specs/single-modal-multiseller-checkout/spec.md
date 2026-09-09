# Single-Modal Multi-Seller Checkout Specification

## Purpose

One buyer-facing Stripe PaymentSheet and one platform charge for multi-seller orders, with internal product-shipment-scoped settlement allocation.

## Requirements

### Requirement: One PaymentSheet Modal Per Checkout

The system MUST present exactly one Stripe PaymentSheet modal per checkout, regardless of seller count.

#### Scenario: Multi-seller checkout

- GIVEN a cart with items from two sellers
- WHEN the buyer reaches the payment step
- THEN `initPaymentSheet` runs once and the buyer authorizes one charge for the full order total

### Requirement: Buyer Summary Hides Seller Settlement Split

The system MUST render the checkout summary with `SummaryBreakdown`, MUST NOT display per-seller net, commission, or shipping split, and MUST display the grossed-up buyer processing line computed by the shared helper.
(Previously: summary did not include a grossed-up processing line.)

#### Scenario: Payment screen

- GIVEN a multi-seller order subtotal
- WHEN the payment screen renders
- THEN `SummaryBreakdown` shows the grossed-up processing line and total
- AND `SellerPaymentBreakdown` is absent

#### Scenario: Backend/frontend agreement

- GIVEN a reserved cart grouped by seller
- WHEN the frontend summary and backend PaymentIntent are computed
- THEN both totals match within 1 cent

### Requirement: Single Platform PaymentIntent

The system MUST create one platform-account PaymentIntent in MXN for the grossed-up buyer-visible total and MUST NOT create per-seller PaymentIntents. The PaymentIntent amount MUST equal the shared helper output for the order subtotal plus buyer-paid shipping. The PaymentIntent metadata MUST include `grossed_up_total_cents` and `domestic_seguro_cents`.
(Previously: PaymentIntent amount was derived from the legacy `seguro` formula.)

#### Scenario: Create checkout intent

- GIVEN a reserved cart grouped by seller
- WHEN `create-connect-payment` runs
- THEN it returns one `clientSecret`, one `transferGroup`, and the grossed-up buyer-visible total
- AND the PaymentIntent omits `transfer_data.destination` and `application_fee_amount`

#### Scenario: Seller-paid shipping

- GIVEN items with seller-paid shipping costs
- WHEN the PaymentIntent amount is computed
- THEN the buyer total excludes shipping costs
- AND the gross-up applies only to the subtotal plus buyer-paid shipping

#### Scenario: Multi-seller total

- GIVEN a cart with items from two sellers and buyer-paid shipping
- WHEN the PaymentIntent is created
- THEN the amount equals the grossed-up total of the combined item subtotal and buyer-paid shipping

### Requirement: Durable Per-Product Shipment Allocation

The system MUST persist one allocation row, one deterministic shipment ID, and one `order_item` per purchased product/listing before marking the order `paid`. The shipment ID MUST be a namespace-based UUID v5 derived from one fixed namespace UUID and a canonical name that includes the idempotency key and `productId`, not seller identity. Its version nibble MUST be `5` and its variant bits MUST match RFC 4122. Each row includes gross amount, service fee, seller-paid shipping, seller net, the product shipment's share of the grossed-up buyer fee (`seguro_cents`), `payment_intent_id`, and `transfer_group`.
(Previously: shipment IDs were raw SHA-256 digests formatted as UUIDs, so version/variant bits violated RFC 4122.)

#### Scenario: Payment succeeds

- GIVEN the platform PaymentIntent succeeds for two products from the same seller
- WHEN the order and shipments are created
- THEN two distinct product shipments and two 1:1 linked `order_items` are created
- AND each `order_item` stores `commission_amount`, `shipping_amount`, `shipping_payer='seller'`, and `net_payout`
- AND each `shipment` stores the platform `stripe_payment_intent_id` and its own `seguro_cents`

#### Scenario: Payment webhook retry

- GIVEN a retry for the same PaymentIntent and idempotency key
- WHEN settlement runs again
- THEN the shipment IDs and order items are reused
- AND no duplicate product shipment or order item is created

#### Scenario: Allocation write fails

- GIVEN the PaymentIntent succeeds but allocation persistence fails
- WHEN the failure is detected
- THEN the order stays in `payment_processing` and is surfaced to admin/ops recovery without becoming `paid`

#### Scenario: Shipment identifier is true UUID v5

- GIVEN a checkout with one product
- WHEN the shipment ID is derived
- THEN it passes Zod `.uuid()` and the strict UUID regex
- AND its version nibble is `5` with RFC 4122 variant bits

## ADDED Requirements

### Requirement: Deterministic Checkout Identity

The system MUST derive the order group / `transfer_group` identifier as a namespace-based UUID v5 from the same fixed namespace and a canonical name that includes the idempotency key, and MUST produce byte-identical PaymentIntent parameters when re-invoked after cutover.

#### Scenario: Order group is stable across recovery

- GIVEN an incomplete checkout
- WHEN the buyer recovers it with the same idempotency key
- THEN the order group identifier matches the earlier attempt

#### Scenario: Repeated checkout produces identical PaymentIntent parameters

- GIVEN the same cart and idempotency key
- WHEN `create-connect-payment` is re-invoked post-cutover
- THEN the generated PaymentIntent parameters are byte-identical across invocations
- AND no duplicate PaymentIntent is created

### Requirement: Producer-to-Consumer Identifier Acceptance

The producer (`create-connect-payment`) MUST generate identifiers accepted by confirmation and webhook settlement consumers without UUID validation errors.

#### Scenario: Consumers accept producer shipment ID

- GIVEN a shipment ID from `create-connect-payment`
- WHEN `confirm-shipment-delivery` and `stripe-webhooks` settlement receive it
- THEN both validate it and process the request without UUID errors

### Requirement: Identifier Compatibility and Cutover Contract

The fixed namespace UUID, canonical name templates, and UUID v5 algorithm are an externally significant compatibility contract. They MUST NOT change without an explicit breaking migration and maintainer-run cutover. Pre-cutover PaymentIntents and identifiers MUST NOT be assumed compatible with the v5 algorithm; agents MUST NOT execute remote deployment, truncation, or production operations.

#### Scenario: Algorithm or cutover change requires explicit migration

- GIVEN a proposal to change the namespace, canonical name, or algorithm
- WHEN the spec phase is reviewed
- THEN it is classified as a breaking migration requiring a new proposal and cutover runbook
- AND no agent performs remote operations

### Requirement: Shared Gross-Up Helper

The system MUST use a single shared integer-cents helper for frontend summary, backend PaymentIntent amount, and per-shipment allocation. The helper MUST be pure and side-effect-free.

#### Scenario: Helper consistency

- GIVEN any domestic MX cart subtotal
- WHEN the helper is called from frontend, backend, and allocation
- THEN all three callers receive the same integer-cents result

### Requirement: Settlement Identifiers for Future Reversal

The system MUST store Stripe identifiers needed for future refund, dispute, cancel, and release flows.

#### Scenario: Persist charge identifiers

- GIVEN a successful platform PaymentIntent
- WHEN the order is persisted
- THEN `orders.stripe_payment_intent_id`, `orders.stripe_charge_id`, and `orders.stripe_transfer_group` are stored

## REMOVED Requirements

### Requirement: Per-Seller PaymentSheet Loop

(Reason: Checkout now uses a single platform PaymentIntent.)
(Migration: Remove the per-seller `clientSecrets` array and loop from checkout; use a single client secret.)

## Acceptance Criteria

- One PaymentSheet modal and one platform charge for any checkout.
- Buyer summary displays the grossed-up processing line.
- Backend and frontend totals agree within 1 cent.
- Allocation records include per-product-shipment `seguro_cents`.
- `service_fee_amount` remains seller commission only.
- Order-group and shipment IDs are true UUID v5 with correct version/variant bits.
- Confirmation and settlement consumers accept producer-generated IDs.
- Repeated identical inputs yield byte-identical PaymentIntent parameters post-cutover.
- Contract tests cover producer→confirmation and producer→settlement round-trips.
- Sandbox smoke checkout succeeds after maintainer-run cutover.

## Non-Goals

- Automatic seller payout at payment success.
- Full cancel/refund/dispute implementation.
- Buyer-visible shipping cost split.
