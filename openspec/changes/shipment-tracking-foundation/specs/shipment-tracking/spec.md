# Spec: Shipment Tracking

## Purpose
Define the carrier tracking event pipeline: signed Envia webhook ingestion, idempotent delivery ledger, polling reconciliation, normalized event storage, and return attribution.

## Requirements
### Requirement: Signed Webhook Ingestion
The system MUST verify every Envia `tracking.simple` webhook using HMAC-SHA256 before processing its payload.
#### Scenario: Valid signature accepted
- GIVEN an Envia webhook with a valid `X-Webhook-Signature`
- WHEN the receiver computes the HMAC over `${timestamp}.${event}.${rawBody}` using `ENVIA_WEBHOOK_SECRET`
- THEN the payload is accepted and processed
#### Scenario: Missing or invalid signature rejected
- GIVEN a webhook without `X-Webhook-Signature` or with an invalid signature
- WHEN the receiver validates
- THEN it returns 401 and MUST NOT record a tracking event

### Requirement: Webhook Idempotency and Replay Protection
The system MUST deduplicate webhook deliveries by provider and `X-Webhook-Id`, and MUST reject replays outside the allowed timestamp window.
#### Scenario: Duplicate delivery ID
- GIVEN a webhook with a previously recorded `X-Webhook-Id`
- WHEN the receiver ingests it again
- THEN it returns 200 with a deduplication indicator and MUST NOT append a duplicate event

### Requirement: Carrier Event Normalization
The system MUST map each Envia status to a canonical Selene event type and permitted shipment transition.
#### Scenario: Physical custody event advances to shipped
- GIVEN a shipment in `preparing` and an Envia status of `Picked Up`, `In Transit`, `Out for Delivery`, or `Out for Pickup`
- WHEN the event is recorded
- THEN the shipment status transitions atomically to `shipped` and `shipped_at` is set to the carrier `event_at`
#### Scenario: Delivered event advances to delivered
- GIVEN a shipment in `shipped` and an Envia status of `Delivered`
- WHEN the event is recorded
- THEN the shipment status transitions atomically to `delivered` and `delivered_at` is set to the carrier `event_at`

### Requirement: Append-Only Tracking Event Ledger
The system MUST store every carrier event in `shipment_tracking_events` with carrier time, received time, raw status, and normalized event type.

### Requirement: Return Tracking Attribution
The system MUST attribute return tracking events to the source dispute when the tracking number matches `disputes.return_tracking_number`.
