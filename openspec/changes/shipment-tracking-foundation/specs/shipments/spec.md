# Delta for Shipments

## ADDED Requirements
### Requirement: Tracking-Driven Shipment Status Transitions
The system MUST advance `shipments.status` only monotonically and only in response to carrier events that prove custody or delivery.
#### Scenario: Carrier custody advances preparing to shipped
- GIVEN a shipment in `preparing` with a valid tracking number
- WHEN a canonical custody event is recorded
- THEN the status transitions to `shipped` atomically
#### Scenario: Delivered advances shipped to delivered
- GIVEN a shipment in `shipped`
- WHEN a `delivered` event is recorded
- THEN the status transitions to `delivered` atomically
#### Scenario: Cancelled shipment cannot regress
- GIVEN a shipment in `cancelled`
- WHEN any carrier event is recorded
- THEN the status MUST remain `cancelled` and the event is appended to the ledger only

### Requirement: Shipment Tracking Visibility
The system MUST expose tracking events to the shipment buyer, seller, and admins; other users MUST NOT see them.

### Requirement: Carrier-Time Semantics
The system MUST use the carrier-reported `event_at` for lifecycle timestamps and the system `received_at` for audit.

### Requirement: External Tracking URL
The system MUST generate Envia tracking links that point to the public rastreo page matching the active Envia mode.
