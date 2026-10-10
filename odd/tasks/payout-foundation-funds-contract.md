# Payout Foundation & Funds Contract

## Goal
Close Phase 1 by defining the authoritative Selene payout operating model before runtime implementation.

## Scope

### In scope
- Stripe Transfer vs Payout money location and ownership.
- Admin release semantics.
- Payout lifecycle states and allowed transitions.
- Late `paid` to `failed` reconciliation.
- Finality, reversal, and retry rules.
- Official Stripe scenario matrix.
- Mapping lifecycle states to admin operational buckets.
- Deployment prerequisites and bounded Phase 2 handoff.

### Out of scope
- Runtime code and database migrations.
- Admin dashboard implementation.
- Cancellation, refund, and dispute behavior.
- Remote SQL, Edge Function deployment, secrets, cron, or webhook configuration.
- Runtime tests and manual E2E.

## Tasks

- [x] **1. Define money movement, release semantics, and lifecycle state machine**
  - Defined platform balance → per-shipment Transfer → connected-account balance → Payout → seller bank.
  - Defined one manual admin authorization with automated continuation after connected funds become available.
  - Defined explicit Selene stages separately from Stripe payout states.

- [x] **2. Define finality, reversal, retry policy, and official Stripe scenario matrix**
  - Permitted Stripe-documented late `paid` to `failed` transitions.
  - Separated append-only evidence from mutable aggregate state.
  - Restricted payout retries to authoritative failed outcomes with returned funds.
  - Added a 16-row scenario matrix covering duplicate, delayed, ambiguous, and out-of-order events.

- [x] **3. Align canonical payout contracts and admin bucket mapping**
  - Updated payout release and reconciliation contracts.
  - Defined Ready to release, Processing, Action required, and History membership.
  - Kept cancellation, refund, and dispute implementation explicitly separate.

- [x] **4. Perform structural readback and prepare Phase 2 slices**
  - Confirmed terminology and transitions agree across canonical contracts.
  - Recorded no unresolved Phase 1 product decision.
  - Defined bounded Phase 2 slices 2A–2D with focused TDD and manual E2E boundaries.

## Verification
- Documentation-only Phase 1 has no meaningful runtime RED/GREEN cycle.
- Read back every modified contract in full.
- Search for contradictory terminal-`paid` and retry language in canonical payout specs.
- Confirm no runtime, migration, frontend, generated type, deployment, or configuration file changed.

## Evidence
- Engram mirror: `odd/payout-foundation-funds-contract/tasks`.
- Writer self-verification completed for all three canonical specs.
- Independent verification: PASS; Phase 1 contract may close.
- `git diff --check` passed with only existing LF→CRLF warnings.
- Scope remained documentation-only across the four tracked Phase 1 paths.
- Runtime RED/GREEN: not applicable for contract-only documentation; Phase 2 slices carry focused TDD requirements.
