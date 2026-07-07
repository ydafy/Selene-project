# Delta for shipments

## ADDED Requirements

### Requirement: Verified Review Identity Contract

The system MUST preserve shipment-safe review identity as `(reviewer_id, shipment_id, product_id)`. A valid verified-purchase attribution MUST reference a product that belongs to the shipment being reviewed.

#### Scenario: Shipment-safe identity for a completed purchase

- GIVEN a buyer completed delivery for a shipment item
- WHEN a review is created for that item
- THEN review identity is represented by `(reviewer_id, shipment_id, product_id)`
- AND verified attribution is tied to that shipment-product linkage

#### Scenario: Invalid or missing linkage

- GIVEN a review record lacks valid shipment-product linkage
- WHEN profile trust badges are evaluated
- THEN the record MUST NOT be treated as a verified purchase

### Requirement: Public-Profile Dependency and Eligibility Guard

Shipment-level `canReview` remains the eligibility source for buyer review flows. Until the separate orders/multi-seller review-creation fix is complete, consumers SHOULD treat this identity contract as the target dependency and MUST NOT introduce fallback attribution logic that can mis-assign seller trust signals.

#### Scenario: Current dependency state

- GIVEN the orders/multi-seller creation fix is not yet complete
- WHEN a capability documents verified-purchase behavior
- THEN it references shipment-level `canReview` and the target identity tuple as the contract-safe dependency

#### Scenario: Unsafe fallback attempt

- GIVEN an implementation attempts order-first fallback attribution
- WHEN shipment-safe linkage cannot be proven
- THEN the behavior is rejected for verified-purchase trust signaling

### Requirement: V1 Shipment-Scoped Identity vs V2 Per-Product Reviews

The current V1 implementation ships ONE review per shipment, scoped to the shipment's first product (`currentShipment.items[0].product_id`). This is intentionally narrower than the long-term V2 contract, which will allow ONE review per product within a shipment. Both versions MUST preserve the `(reviewer_id, shipment_id, product_id)` identity tuple and MUST NOT fall back to `order.items[0]` attribution, which is the multi-seller mis-assignment bug.

#### Scenario: V1 single review per shipment

- GIVEN a completed shipment with one or more products
- WHEN the buyer submits a review from the order detail
- THEN the review is scoped to `currentShipment.id` and `currentShipment.items[0].product_id`
- AND only ONE review may be created per shipment for that buyer

#### Scenario: V2 one review per product within a shipment

- GIVEN the per-product review expansion is delivered
- WHEN a shipment contains multiple products
- THEN the buyer may submit one review per `(shipment_id, product_id)` pair
- AND the verified-purchase badge continues to require the full identity tuple

#### Scenario: No order-first fallback

- GIVEN any review-creation flow (V1 or V2)
- WHEN shipment-safe product identity is unavailable
- THEN the implementation MUST NOT substitute `order.items[0]` and MUST leave `shipment_id`/`product_id` null
