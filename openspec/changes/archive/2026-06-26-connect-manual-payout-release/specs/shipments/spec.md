# Delta for Shipments

## ADDED Requirements

### Requirement: Shipment-Scoped Dispute and Report Context

The system MUST preserve `shipment_id` through order/report navigation and dispute creation flows for multi-seller safety.

#### Scenario: Buyer opens dispute from shipment context

- GIVEN an order with multiple seller shipments
- WHEN buyer starts dispute/report from a shipment action
- THEN the request includes `order_id` and `shipment_id`

#### Scenario: Missing shipment context

- GIVEN dispute/report request contains only `order_id`
- WHEN validation executes
- THEN the system SHALL reject the request as invalid context

### Requirement: Seller Resolution Uses Shipment Ownership

The system MUST derive dispute seller context from `shipments.seller_id` for the provided `shipment_id` and MUST NOT infer seller from `order.items[0]`.

#### Scenario: Correct seller is selected in multi-seller order

- GIVEN one order containing shipments from seller A and seller B
- WHEN a dispute is created for seller B shipment
- THEN seller B is recorded as dispute seller

#### Scenario: Shipment does not belong to order

- GIVEN `shipment_id` does not belong to the provided `order_id`
- WHEN dispute creation is requested
- THEN the system SHALL reject creation and MUST NOT persist dispute data

## Acceptance Criteria

- `openDispute` contract includes `shipment_id`.
- Report and dispute routes reject missing/invalid shipment scope.
- Dispute seller mapping is shipment-based, not order-first-item based.
