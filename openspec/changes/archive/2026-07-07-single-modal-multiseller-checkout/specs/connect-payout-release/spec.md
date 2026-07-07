# Delta for Connect Payout Release

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Per-Seller Destination-Charge Payout

(Reason: The checkout no longer creates per-seller PaymentIntents/destination charges; funds are held on the platform account and moved to the seller Connect account during manual release.)
(Migration: Update release logic to create a Stripe Transfer from the platform charge before creating the payout; use `shipments.stripe_transfer_id` to avoid duplicates.)

## Acceptance Criteria

- Release action remains admin-only and manual.
- Eligibility gate blocks releases that lack allocation or `transfer_group`.
- Payout amount is derived from shipment allocation and idempotent.
- Transfer creation is idempotent per shipment and precedes the payout.
