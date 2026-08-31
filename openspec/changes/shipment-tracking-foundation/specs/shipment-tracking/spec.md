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

#### Scenario: Replay outside the window

- GIVEN a webhook with a timestamp older than 5 minutes
- WHEN the receiver validates
- THEN it returns 401 and MUST NOT process the payload

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

#### Scenario: Non-transition event is logged only

- GIVEN an Envia status of `Created`, `Pending`, `Information`, `N/A`, or an exception status
- WHEN the event is recorded
- THEN the system appends the event to the ledger without changing shipment status

### Requirement: Polling Reconciliation

The system MUST reconcile tracking events via polling for all trackable shipments, deduplicating against the webhook-fed ledger.

#### Scenario: Backfill missed intermediate events

- GIVEN a shipment whose webhook delivered only the latest status
- WHEN the polling cron queries Envia `/ship/generaltrack/`
- THEN it persists any events not already present, keyed by `(shipment_id, raw_status, event_at, location)`

#### Scenario: Polling finds no new events

- GIVEN a shipment whose ledger already contains the latest Envia events
- WHEN polling runs
- THEN it advances `last_tracked_at` without creating duplicate events

### Requirement: Append-Only Tracking Event Ledger

The system MUST store every carrier event in `shipment_tracking_events` with carrier time, received time, raw status, and normalized event type.

#### Scenario: Event append

- GIVEN a validated tracking event for a shipment
- WHEN the system records it
- THEN `shipment_tracking_events` contains a row with `event_at`, `received_at`, `raw_status`, `event_type`, `location`, and `status_description`

### Requirement: Return Tracking Attribution

The system MUST attribute return tracking events to the source dispute when the tracking number matches `disputes.return_tracking_number`.

#### Scenario: Return event linked to dispute

- GIVEN a webhook or polling event whose tracking number matches a dispute return label
- WHEN the event is recorded
- THEN `shipment_tracking_events.dispute_id` is set to that dispute and the shipment status remains unchanged
