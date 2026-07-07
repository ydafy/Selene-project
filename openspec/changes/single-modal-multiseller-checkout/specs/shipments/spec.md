# Delta for Shipments

## ADDED Requirements

### Requirement: Shipment Records Stripe Settlement References

The system MUST persist Stripe settlement references on each shipment for single-charge multi-seller checkout and future refund/dispute/release flows.

#### Scenario: Shipment created from platform payment success

- GIVEN a successful single-charge PaymentIntent for an order with two sellers
- WHEN shipments are created
- THEN each shipment stores the platform `stripe_payment_intent_id`
- AND `stripe_transfer_id` remains null until the admin release creates the transfer

#### Scenario: Shipment receives transfer on manual release

- GIVEN a completed shipment without `stripe_transfer_id`
- WHEN admin release creates the seller transfer
- THEN the shipment stores the returned `stripe_transfer_id`
- AND the transfer is grouped under the order-level `transfer_group`

### Requirement: Shipments Expose Allocation Correlation Fields

The system MUST store per-shipment allocation fields that correlate the shipment to the order-level charge and seller settlement.

#### Scenario: Shipment allocation is persisted at payment success

- GIVEN shipments are created from a single-charge order
- WHEN allocation is computed
- THEN each shipment stores `shipping_cost` and links to order_items with `commission_amount`, `shipping_amount`, `shipping_payer`, and `net_payout`
- AND the shipment transitions to `paid` only after allocation persistence succeeds

## Acceptance Criteria

- Shipments capture the platform `stripe_payment_intent_id` and `stripe_transfer_id`.
- Allocation correlation fields are present before marking the shipment `paid`.
- `stripe_transfer_id` is written exactly once during admin release.
