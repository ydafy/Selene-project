# Connect Payout Reconciliation Specification

## Purpose

Track payout runs to final outcome and recover from partial failures.

## Requirements

### Requirement: Persisted Payout Run Ledger

The system MUST persist each payout run with seller ID, shipment IDs, amount, actor, Stripe payout ID, idempotency key, and reconciliation status.

#### Scenario: Payout run is recorded before outcome

- GIVEN admin starts a valid payout release
- WHEN the run is created
- THEN the ledger stores run metadata and marks status as pending reconciliation

#### Scenario: Duplicate idempotency key submitted

- GIVEN an existing payout run for the same idempotency key
- WHEN another create is attempted
- THEN the system SHALL reuse the existing run and return its current status

### Requirement: Outcome Reconciliation and Recovery

The system MUST reconcile Stripe payout lifecycle outcomes (`paid`, `failed`, `canceled`) and update shipment release state exactly once.

#### Scenario: Stripe confirms paid

- GIVEN a pending payout run receives a `payout.paid` event
- WHEN reconciliation executes
- THEN run status becomes paid and linked shipments are marked released once

#### Scenario: Stripe succeeds but DB update fails

- GIVEN Stripe payout is created but shipment updates fail
- WHEN reconciliation retry runs
- THEN the run SHALL move to reconciliation-needed and MUST become recoverable without duplicate payout

## Acceptance Criteria

- Every run is auditable end-to-end.
- Webhook/retry path converges to one terminal status.
- Shipment state updates are exactly-once per run.