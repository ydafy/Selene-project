# Connect Payout Release Specification

## Purpose

Define admin-controlled, shipment-safe Stripe Connect payout release with explicit three-stage semantics: Transfer creation, waiting for connected available balance, and Payout creation.

## Requirements

### Requirement: Manual Admin Release Gate

The system MUST release seller funds only through an authenticated admin action. For single-charge multi-seller orders, the release MUST verify the shipment has a durable allocation record and a valid `transfer_group` before creating a seller transfer.

(Previously: The gate only checked completion, dispute/refund state, and seller payout readiness.)

#### Scenario: Admin releases eligible shipments

- GIVEN shipments are `completed`, have no active dispute/refund, and seller payout readiness is true
- WHEN admin triggers release for that seller batch
- THEN one payout run is created with the selected shipment IDs

#### Scenario: Ineligible shipment is requested

- GIVEN at least one requested shipment fails eligibility gates
- WHEN admin submits a payout release
- THEN the system SHALL reject the run and MUST NOT create a Stripe payout or transfer

#### Scenario: Missing settlement context

- GIVEN a shipment lacks allocation or `transfer_group`
- WHEN admin triggers release
- THEN the system SHALL reject the run and MUST NOT create a Stripe transfer or payout

### Requirement: Shipment-Scoped Amount, Transfer, and Idempotency

The system MUST compute payout amount from the included shipment allocation records, create a Stripe Transfer per shipment to the seller Connect account grouped by `transfer_group`, and MUST NOT use the seller full available Stripe balance.

(Previously: The amount was computed from shipment records and did not include a platform-to-seller Transfer step.)

#### Scenario: Payout amount equals allocation

- GIVEN three eligible shipments for one seller with computed net release amounts
- WHEN a payout run is executed
- THEN the Stripe payout amount equals the sum of those shipment net amounts only

#### Scenario: Transfer is created before payout

- GIVEN an eligible completed shipment in a single-charge order
- WHEN the release run executes
- THEN the system creates one Stripe Transfer to the seller Connect account for the shipment net amount
- AND stores the returned `transfer_id` on the shipment before creating the Stripe Payout

#### Scenario: Idempotent retry

- GIVEN a release request with an idempotency key already used by a completed run
- WHEN the same request is retried
- THEN the system SHALL return the existing run and MUST NOT create a second payout or transfer

#### Scenario: Transfer already exists for shipment

- GIVEN a shipment already has `stripe_transfer_id` populated
- WHEN release runs for that shipment
- THEN the system MUST reuse the existing transfer and MUST NOT duplicate it

### Requirement: Three-Stage Release Semantics

The system MUST treat a release run as progressing through three distinct stages: (1) Stripe Transfer creation to the connected account, (2) waiting until the transferred funds are available on the connected-account balance, and (3) Stripe Payout creation from the connected account. The system MUST NOT collapse these stages into one coarse pending state, and MUST NOT report success as bank receipt: a successful Payout creation means payout processing was initiated, and the final outcome is reconciled per `connect-payout-reconciliation`.

(Previously: Release semantics implied a single pending step between transfer and payout and did not guard against reading success as funds received.)

#### Scenario: Stages execute in order

- GIVEN a release run with eligible shipments
- WHEN the run executes
- THEN it first creates the shipment Transfers, then waits for those funds to become available on the connected-account balance, and only then creates the Stripe Payout
- AND the run status reflects which stage it is in

#### Scenario: Payout creation waits for available balance

- GIVEN Transfers were created but the transferred funds are not yet available on the connected-account balance
- WHEN the run attempts payout creation
- THEN the system SHALL defer the Payout creation and keep the run in a waiting/processing stage
- AND the system MUST NOT create the Payout while the required funds are not available on the connected-account balance

#### Scenario: Payout creation success is not bank receipt

- GIVEN the Stripe Payout was created successfully
- WHEN the run outcome is reported
- THEN the status reflects payout initiated and awaiting reconciliation
- AND the system MUST NOT mark shipments as funds-arrived-in-bank at this point

#### Scenario: Failure after payout creation

- GIVEN the Payout was created but authoritative Stripe state later reports it failed or canceled
- WHEN the outcome is reconciled
- THEN the run enters Action required per the retry rules in `payout-operating-model`
- AND the existing shipment Transfers are reused by any child retry run

## Acceptance Criteria

- Release action remains admin-only and manual.
- Eligibility gate blocks releases that lack allocation or `transfer_group`.
- Payout amount is derived from shipment allocation and idempotent.
- Transfer creation is idempotent per shipment and precedes the payout.
- Release semantics distinguish Transfer creation, waiting for connected available balance, and Payout creation.
- Payout creation success means processing initiated, never guaranteed bank receipt.
- Run status exposes distinct stages instead of one coarse pending state.
