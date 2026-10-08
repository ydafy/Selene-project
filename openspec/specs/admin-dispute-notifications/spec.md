# Admin Dispute Notifications Specification

## Purpose

A dispute verdict is a trusted business transition, not an admin-browser insert. See `notification-events/spec.md` for event identity, recipients, and destination.

## Requirements

### Requirement: Committed verdict produces one notice per affected recipient (CONF-012)

After a final verdict is committed, the trusted resolution boundary SHALL derive the affected buyer and shipment seller from the dispute and emit `dispute.verdict` for each with the same stable source-event key and distinct recipient identity. A retry of the same verdict revision SHALL NOT duplicate a recipient row; a genuinely new committed revision MAY produce a new event without deleting the historical one. The admin web client SHALL NOT insert directly into `notifications`. Messaging SHALL distinguish verdict from eventual refund or payout; use `/profile/orders/{orderId}` as validated destination.

#### Scenario: Repeated resolution request
- GIVEN the same committed verdict revision is processed twice
- WHEN the producer retries
- THEN each affected recipient has one row for that source event

#### Scenario: Buyer verdict before refund
- GIVEN a verdict favors the buyer but a refund is not confirmed
- WHEN the verdict notice is authored
- THEN it reports the verdict without claiming a refund has succeeded
