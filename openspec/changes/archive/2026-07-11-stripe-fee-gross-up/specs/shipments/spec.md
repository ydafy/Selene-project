# Delta for Shipments

## MODIFIED Requirements

### Requirement: Stripe Shipment Refund Safety

The system MUST issue Stripe refunds shipment-only with explicit partial amount equal to the shipment subtotal plus that shipment's proportional share of the grossed-up buyer-paid fee, and MUST persist the platform's proportional share of `orders.actual_stripe_fee_cents` as `orders.cancellation_loss_cents`. It MUST block or alert if `stripe_transfer_id` exists. Refund metadata MUST include `shipment_id`, `order_id`, caller role, reason, and `seguro_share_cents`.
(Previously: refund amount used the legacy ungrossed buyer-paid fee and did not persist Stripe loss.)

#### Scenario: Partial refund amount

- GIVEN a `paid` shipment
- WHEN the refund is created
- THEN the amount equals the shipment subtotal plus its proportional share of the grossed-up buyer-paid fee
- AND it never includes seller-paid shipping
- AND a single-shipment cancellation equals the original charge amount
- AND `cancellation_loss_cents` is set to the proportional actual fee share when available
- AND the idempotency key is `cancel_shipment_{shipmentId}`

#### Scenario: Remaining refundable cap

- GIVEN a payment with a known remaining refundable amount
- WHEN the computed refund would exceed that cap
- THEN the endpoint rejects before Stripe is called with a clear refund-cap error

#### Scenario: Transfer already exists

- GIVEN a shipment with `stripe_transfer_id IS NOT NULL`
- WHEN cancellation is requested
- THEN the system logs a CRITICAL alert and refuses the refund

#### Scenario: Refund metadata

- GIVEN a valid shipment cancellation refund
- WHEN the refund is created
- THEN metadata includes `shipment_id`, `order_id`, caller role, reason, and `seguro_share_cents`

### Requirement: Shipment-Scoped Cron Regression

The `auto-cancel-orders` and `auto-cancel-preparing` crons MUST remain shipment-scoped, continue using `order_expiration_hours` and `preparing_expiration_hours`, and MUST compute refund amount from the grossed-up buyer-paid fee while persisting cancellation loss when reconciled.
(Previously: cron refund amount was computed from the legacy fee and did not persist loss.)

#### Scenario: Cron processes one shipment

- GIVEN a multi-shipment order where one shipment times out
- WHEN the cron runs
- THEN only the timed-out shipment is cancelled and refunded
- AND the refund amount uses the grossed-up buyer-paid fee
- AND `cancellation_loss_cents` is set when the actual fee is reconciled

## ADDED Requirements

### Requirement: Cancellation Loss Persistence

The system MUST compute and persist `orders.cancellation_loss_cents` as the cancelling shipment's proportional share of `orders.actual_stripe_fee_cents`. If `actual_stripe_fee_cents` is NULL, the loss MUST be NULL.

#### Scenario: Reconciled actual fee

- GIVEN an order with two equal shipments and `actual_stripe_fee_cents` of 20,000
- WHEN one shipment is cancelled
- THEN `cancellation_loss_cents` is set to 10,000

#### Scenario: Unreconciled actual fee

- GIVEN an order with `actual_stripe_fee_cents` NULL
- WHEN a shipment is cancelled
- THEN `cancellation_loss_cents` is NULL
- AND the buyer refund is still issued in full

## Acceptance Criteria

- Manual and auto-cancel remain shipment-scoped.
- Buyer receives full refund of shipment subtotal plus grossed-up fee share.
- `cancellation_loss_cents` reflects proportional actual Stripe fee when reconciled.
- Refund metadata includes `seguro_share_cents`.
- Transfer-already-exists guard remains in place.
