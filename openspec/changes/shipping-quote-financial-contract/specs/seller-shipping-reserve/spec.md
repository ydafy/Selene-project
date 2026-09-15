# Seller Shipping Reserve Specification

## Purpose

Define the deterministic shipping reserve and publication-time seller economics snapshot that fixes checkout allocation and seller net payout.

## Requirements

### Requirement: Deterministic Paquetexpress Ground Quote

The system MUST provide exactly one Paquetexpress Ground MXN rate per seller's real valid Mexican origin ZIP, preset dimensions, and declared value. The listing reference destination defaults to ZIP `06500`. It MUST reject other carriers, services, and `ground_do`/`ground_od`.

#### Scenario: Single matching rate

- GIVEN a seller listing with real origin ZIP `64000` and no destination ZIP
- WHEN the quote is requested
- THEN exactly one Paquetexpress Ground MXN option is returned
- AND no `ground_do`, `ground_od`, or other service is included
- AND the listing reference destination defaults to ZIP `06500`

#### Scenario: Non-matching rate rejected

- GIVEN an Envia response contains a non-Paquetexpress or non-Ground rate
- WHEN the quote filter runs
- THEN the system SHALL reject the quote and surface an error

### Requirement: Reserve Formula

The system MUST compute `estimated_seller_shipping_deduction_cents` as `Q + buffer + insurance`, where `Q` is the selected quote in cents, `buffer` is the configured buffer in cents, and `insurance = ceil(product_price_cents * insurance_rate)`.

#### Scenario: Reserve calculation

- GIVEN quote `Q` `15,000` cents, buffer `2,000` cents, price `100,000` cents, and insurance rate `0.012`
- WHEN the reserve is computed
- THEN insurance is `1,200` cents and the reserve is `18,200` cents

### Requirement: Publication-Time Economics Snapshot and Checkout Reuse

The system MUST persist, at listing publication, the accepted shipping reserve in integer cents, the accepted commission-rate input, and the accepted insurance-rate input as a snapshot bound to the published product. The snapshot MUST NOT be mutated by later settings changes. Checkout allocation MUST read reserve, commission, and insurance from this snapshot and MUST NOT use current settings for a published product that has a snapshot.

#### Scenario: Publication persists snapshot

- GIVEN a seller publishes a listing with reserve `18,200` cents, commission rate `0.08`, and insurance rate `0.012`
- WHEN publication succeeds
- THEN the listing stores the shipping reserve, commission rate, and insurance rate

#### Scenario: Allocation from snapshot

- GIVEN a sold item with snapshot reserve `18,200` cents and snapshot commission `8,000` cents
- WHEN allocation is persisted
- THEN `net_payout` is `73,800` cents and `shipping_payer` is `seller`

#### Scenario: Legacy listing fallback

- GIVEN a checkout includes a product published before the snapshot schema
- WHEN allocation is computed
- THEN the system falls back to current configured settings
- AND the product snapshot is backfilled for subsequent orders

### Requirement: Cents and Decimal-Peso Separation

The system MUST store shipment-level shipping cost in integer cents and order-item-level shipping amount in decimal MXN pesos.

#### Scenario: Unit separation

- GIVEN a reserve of `18,200` cents
- WHEN allocation persists
- THEN `shipments.shipping_cost` is `18200` cents
- AND `order_items.shipping_amount` is `182.00` pesos

### Requirement: Manual Supabase Deployment and Type-Regeneration Gate

The snapshot schema migration MUST remain repository-only until the maintainer applies it remotely. `bun db:types` MUST run only after maintainer confirmation, and generated types MUST contain the expected snapshot columns before code relies on them.

#### Scenario: Repository-only migration and type gate

- GIVEN the migration file is created in `supabase/migrations/`
- WHEN the change is prepared
- THEN no agent applies remote SQL
- AND `bun db:types` runs only after maintainer confirmation of remote SQL
- AND generated types include the publication snapshot columns before code relies on them

## Acceptance Criteria

- Quote determinism pinned by green tests for `selectPaquetexpressGroundRate`.
- Reserve formula and snapshot persistence pinned by green tests for `calculateEstimatedSellerShippingDeductionCents` and snapshot write/read.
- Checkout allocation reuse and legacy fallback pinned by `calculateCheckoutAllocation`.
- Notice/guidance copy exists in `en` and `es`; branch-admission proof recorded before rollout.
- Types regenerated only after remote SQL confirmation.
