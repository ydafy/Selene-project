# Single-Modal Multi-Seller Checkout Specification

## Purpose

One buyer-facing Stripe PaymentSheet and one platform charge for multi-seller orders, with internal seller-scoped settlement allocation.

## Requirements

### Requirement: One PaymentSheet Modal Per Checkout

The system MUST present exactly one Stripe PaymentSheet modal per checkout, regardless of seller count.

#### Scenario: Multi-seller checkout

- GIVEN a cart with items from two sellers
- WHEN the buyer reaches the payment step
- THEN `initPaymentSheet` runs once and the buyer authorizes one charge for the full order total

### Requirement: Buyer Summary Hides Seller Settlement Split

The system MUST render the checkout summary with `SummaryBreakdown` and MUST NOT display per-seller net, commission, or shipping split to the buyer.

#### Scenario: Payment screen

- GIVEN a multi-seller order total
- WHEN the payment screen renders
- THEN `SummaryBreakdown` is shown and `SellerPaymentBreakdown` is absent

### Requirement: Single Platform PaymentIntent

The system MUST create one platform-account PaymentIntent in MXN for the buyer-visible total and MUST NOT create per-seller PaymentIntents.

#### Scenario: Create checkout intent

- GIVEN a reserved cart grouped by seller
- WHEN `create-connect-payment` runs
- THEN it returns one `clientSecret`, one `transferGroup`, and the buyer-visible total
- AND the PaymentIntent omits `transfer_data.destination` and `application_fee_amount`

#### Scenario: Seller-paid shipping

- GIVEN items with seller-paid shipping costs
- WHEN the PaymentIntent amount is computed
- THEN the buyer total excludes shipping costs

### Requirement: Durable Per-Shipment Allocation

The system MUST persist per-shipment/per-item allocation before marking the order `paid`, including gross amount, service fee, seller-paid shipping, seller net, `payment_intent_id`, and `transfer_group`.

#### Scenario: Payment succeeds

- GIVEN the platform PaymentIntent succeeds
- WHEN the order and shipments are created
- THEN each `order_item` stores `commission_amount`, `shipping_amount`, `shipping_payer='seller'`, and `net_payout`
- AND each `shipment` stores the platform `stripe_payment_intent_id`

#### Scenario: Allocation write fails

- GIVEN the PaymentIntent succeeds but allocation persistence fails
- WHEN the failure is detected
- THEN the order stays in `payment_processing` and is surfaced to admin/ops recovery without becoming `paid`

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
- No buyer-facing seller payment breakdown.
- Allocation records are persisted before `paid`; failures remain in `payment_processing`.
- Stripe identifiers (`payment_intent_id`, `charge_id`, `transfer_group`) are captured for future flows.

## Non-Goals

- Automatic seller payout at payment success.
- Full cancel/refund/dispute implementation.
- Buyer-visible shipping cost split.
