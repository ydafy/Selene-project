# Connect Payout Release Specification

## Purpose

Define admin-controlled, shipment-safe Stripe Connect payout release.

## Requirements

### Requirement: Manual Admin Release Gate

The system MUST release seller funds only through an authenticated admin action, never through automatic Stripe payout scheduling.

#### Scenario: Admin releases eligible seller shipments

- GIVEN shipments are `completed`, have no active dispute/refund, and seller payout readiness is true
- WHEN admin triggers release for that seller batch
- THEN one payout run is created with the selected shipment IDs and total release amount

#### Scenario: Ineligible shipment is requested

- GIVEN at least one requested shipment fails eligibility gates
- WHEN admin submits a payout release
- THEN the system SHALL reject the run and MUST NOT create a Stripe payout

### Requirement: Shipment-Scoped Amount and Idempotency

The system MUST compute payout amount from the included shipment records and MUST NOT use seller full available Stripe balance.

#### Scenario: Payout amount equals shipment batch amount

- GIVEN three eligible shipments for one seller with computed net release amounts
- WHEN a payout run is executed
- THEN Stripe payout amount equals the sum of those shipment amounts only

#### Scenario: Idempotent retry

- GIVEN a release request with an idempotency key already used by a completed run
- WHEN the same request is retried
- THEN the system SHALL return the existing run and MUST NOT create a second payout

## Acceptance Criteria

- Release action is admin-only and manual.
- Eligibility gate blocks non-completed/disputed/refund-pending/not-ready sellers.
- Payout amount is shipment/batch-scoped and idempotent.
