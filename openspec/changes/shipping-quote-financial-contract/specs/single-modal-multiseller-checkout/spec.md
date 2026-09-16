# Delta for Single-Modal Multi-Seller Checkout

## MODIFIED Requirements

### Requirement: Durable Per-Product Shipment Allocation

The system MUST persist one allocation row, one deterministic shipment ID, and one `order_item` per purchased product/listing before marking the order `paid`. The shipment ID MUST be a namespace-based UUID v5 derived from one fixed namespace UUID and a canonical name that includes the idempotency key and `productId`, not seller identity. Its version nibble MUST be `5` and its variant bits MUST match RFC 4122. Allocation MUST source the seller-paid shipping reserve, commission amount, and insurance amount from the product publication snapshot; if the snapshot is absent for a legacy listing, allocation MUST fall back to current configured settings and SHOULD backfill the snapshot. Each row includes gross amount, service fee, seller-paid shipping, seller net, the product shipment's share of the grossed-up buyer fee (`seguro_cents`), `payment_intent_id`, and `transfer_group`.
(Previously: allocation reconstructed reserve/commission from current settings without a publication snapshot or legacy fallback.)

#### Scenario: Payment succeeds with snapshot

- GIVEN the platform PaymentIntent succeeds for two products with publication snapshots
- WHEN the order and shipments are created
- THEN each `order_item` stores amounts computed from the product snapshot
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

#### Scenario: Legacy listing fallback

- GIVEN a checkout includes a product published before the snapshot schema
- WHEN allocation is computed
- THEN the system falls back to current configured settings
- AND the product snapshot is backfilled for subsequent orders

## Acceptance Criteria

- Allocation records include per-product-shipment `seguro_cents`.
- Allocation sources reserve/commission/insurance from the product publication snapshot.
- Legacy listings fall back to current settings and are backfilled.
- Repeated identical inputs yield byte-identical PaymentIntent parameters post-cutover.
