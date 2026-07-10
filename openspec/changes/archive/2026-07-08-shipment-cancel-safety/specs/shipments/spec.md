# Delta for Shipments

## ADDED Requirements

### Requirement: Manual Cancellation is Shipment-Scoped

The Edge Function `cancel-order` is a legacy name. Manual cancellation MUST be shipment-scoped and MUST NOT be whole-order.

#### Scenario: Buyer cancels from shipment detail

- GIVEN a `paid` shipment at `/profile/orders/[id]?shipment_id=shp_123`
- WHEN the buyer confirms cancellation
- THEN the payload includes `orderId` and `shipmentId`
- AND only the referenced shipment is cancelled and refunded

#### Scenario: Missing shipment scope

- GIVEN a manual request with `orderId` but no `shipmentId`
- WHEN the backend validates
- THEN it rejects with 422 and performs no cancellation or refund

### Requirement: Manual Cancellation Eligibility

The system MUST allow buyer manual cancellation only for `paid` shipments. The system MUST allow seller manual cancellation only for the seller's own `paid` shipment. `preparing` cancellation MUST remain cron-only by `preparing_expiration_hours` timeout.

#### Scenario: Paid shipment cancels

- GIVEN a shipment with `status='paid'`
- WHEN the buyer triggers manual cancel
- THEN the shipment is cancelled and a partial refund is issued

#### Scenario: Non-cancelable shipment states

- GIVEN a shipment in `preparing`, `shipped`, `delivered`, `completed`, or dispute/refunded state
- WHEN the buyer triggers manual cancel
- THEN the request is rejected and routed to dispute/support

#### Scenario: Seller cancels own paid shipment

- GIVEN a seller views their own `paid` shipment
- WHEN the seller confirms cancellation
- THEN the shipment is cancelled and refunded

#### Scenario: Seller attempts cancel on non-owned or non-paid shipment

- GIVEN a seller views a shipment they do not own, or a shipment not in `paid`
- WHEN the seller attempts to trigger cancel
- THEN the CTA is hidden and any direct request is rejected

### Requirement: Stripe Shipment Refund Safety

The system MUST issue Stripe refunds shipment-only with explicit partial amount, per-shipment idempotency key, and metadata including `shipment_id`, `order_id`, caller role, and reason. It MUST block or alert if `stripe_transfer_id` exists.

#### Scenario: Partial refund amount

- GIVEN a `paid` shipment
- WHEN the refund is created
- THEN the amount equals the shipment subtotal plus that shipment's proportional share of the buyer-paid fee
- AND it never includes seller-paid shipping_amount
- AND a single-shipment cancellation equals the original charge amount
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
- THEN metadata includes `shipment_id`, `order_id`, caller role, and reason

### Requirement: Emergency Maintenance Stop

The system MUST block the manual cancellation endpoint when `system_settings.is_maintenance` is true, before any mutation.

#### Scenario: Maintenance mode

- GIVEN `system_settings.is_maintenance = true`
- WHEN a buyer submits a manual cancellation request
- THEN the endpoint returns a maintenance error and performs no mutation

### Requirement: Settings-Driven SLA Copy

SLA notices MUST read `order_expiration_hours` and `preparing_expiration_hours` from `system_settings` via `useSystemConfig`; only fallback values may be hardcoded. The unboxing/video notice MUST remain visible when eligible.

#### Scenario: SLA timer uses live settings

- GIVEN the buyer views the order detail SLA notice
- WHEN `useSystemConfig` returns configured hours
- THEN the notice uses those values

#### Scenario: Unboxing notice remains

- GIVEN the buyer is eligible for the unboxing/video safety notice
- WHEN the SLA notice is rendered
- THEN the unboxing notice remains visible and is not replaced

### Requirement: Shipment-Scoped Cron Regression

The `auto-cancel-orders` and `auto-cancel-preparing` crons MUST remain shipment-scoped and continue using `order_expiration_hours` and `preparing_expiration_hours`.

#### Scenario: Cron processes one shipment

- GIVEN a multi-shipment order where one shipment times out
- WHEN the cron runs
- THEN only the timed-out shipment is cancelled and refunded

### Requirement: Cancellation Verification

Tests MUST verify frontend scope wiring, backend unsafe state rejection, Stripe refund behavior, settings-driven SLA copy, and no cross-shipment mutation.

#### Scenario: Unsafe state rejection

- GIVEN a request to cancel a `shipped` shipment
- WHEN the backend validates
- THEN it returns 422 and makes no Stripe refund

## REMOVED Requirements

### Requirement: Whole-Order Cancellation Eligibility

(Reason: Whole-order cancellation is deprecated for manual flows.)
(Migration: Use shipment-scoped requests with explicit `shipmentId`.)

### Requirement: Legacy Single-Seller Cancellation Compatibility

(Reason: Whole-order cancellation is deprecated.)
(Migration: Use shipment-scoped cancellation.)
