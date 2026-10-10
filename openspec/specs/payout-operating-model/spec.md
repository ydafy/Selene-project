# Payout Operating Model Specification

## Purpose

Define Selene's authoritative operating model for seller payouts on Stripe Connect: terminology, fund locations, release semantics, lifecycle states, finality and reversal, retry rules, evidence, and the admin surface mapping. Runtime-specific behavior lives in `connect-payout-release` and `connect-payout-reconciliation`; those capabilities MUST NOT contradict this model.

## Requirements

### Requirement: Safety-First Manual Release After Shipment Completion

The system MUST move seller funds to their bank only through manual Stripe Connect payouts, and only after the governing shipment has completed. The system MUST NOT use automatic or scheduled payouts as the fund-release mechanism.

(Previously: payout automation and timing were not centrally specified.)

#### Scenario: Shipment not completed

- GIVEN a shipment is not completed
- WHEN a payout release is requested for that shipment
- THEN the system SHALL reject the release and MUST NOT create a Stripe Transfer or Payout for it

#### Scenario: Completed shipment awaiting admin action

- GIVEN a shipment is completed and eligible
- WHEN no admin release has been accepted
- THEN the funds remain in Selene-controlled locations and no Payout to the seller bank is created

### Requirement: Single-Modal Funds Path

The system MUST move funds through exactly one path per shipment: platform Stripe balance → per-shipment Stripe Transfer → connected-account balance → Stripe Payout → seller bank. Selene's database records reflect this path; they are never the money itself.

#### Scenario: Funds move for one shipment

- GIVEN a completed eligible shipment with a computed net release amount
- WHEN the release executes
- THEN one Stripe Transfer for that shipment moves funds from the platform balance to the connected-account balance
- AND the Stripe Payout for that seller moves connected-account funds to the seller bank
- AND no funds bypass the connected-account balance

#### Scenario: Multi-shipment seller batch

- GIVEN one release run covers several shipments of the same seller
- WHEN the run executes
- THEN each shipment keeps its own Transfer, and the Payout amount equals the sum of the included shipment net amounts only

### Requirement: Release Semantics — Initiation, Not Guaranteed Bank Receipt

Admin release MUST mean Selene accepted and initiated payout processing. It MUST NOT be presented, stored, or interpreted as guaranteed permanent receipt in the seller's bank. Standard manual payouts typically take 1–4 business days; these timings are operational expectations, not contractual guarantees. Mexico is not listed for Instant Payouts, and the system MUST NOT promise or depend on Instant Payouts.

#### Scenario: Admin accepts a release

- GIVEN an admin confirms a release for eligible shipments
- WHEN the acceptance is recorded
- THEN the outcome is payout processing initiated, not funds-arrived-in-bank

#### Scenario: Buyer- or seller-facing wording

- GIVEN any status is surfaced about a released payout
- WHEN it is rendered or reported
- THEN it describes the current payout state and never asserts permanent bank receipt before an observed, still-valid `paid` outcome

### Requirement: Payout Lifecycle States and Transitions

The system MUST model Stripe payout states `pending`, `in_transit`, `paid`, `failed`, and `canceled`, and MUST keep Selene aggregate state in sync with authoritative Stripe state. Allowed transitions include `pending → in_transit → paid`, `pending → failed`, `in_transit → paid`, `in_transit → failed`, and `paid → failed` (late reversal). `canceled` is reachable from pending/in-transit states through cancellation.

#### Scenario: Payout advances through transit

- GIVEN a payout was created for a released run
- WHEN Stripe reports `pending` then `in_transit` then `paid`
- THEN Selene aggregate state follows each observed Stripe state in order

#### Scenario: Payout fails before arrival

- GIVEN a payout is `pending` or `in_transit`
- WHEN Stripe reports `failed`
- THEN Selene aggregate state becomes failed and the run enters Action required

#### Scenario: Payout is canceled

- GIVEN a payout is `pending` or `in_transit`
- WHEN Stripe reports `canceled`
- THEN Selene aggregate state becomes canceled and the run enters Action required

### Requirement: Selene Aggregate Release Stages

The system MUST track each release run with explicit Selene aggregate stages, distinct from Stripe payout states: `ready` (awaiting admin decision), `release_accepted` (admin accepted; Transfers not yet created), `transfer_created` (shipment Transfers created), `awaiting_connected_balance` (Transfers created; transferred funds not yet available on the connected-account balance), `payout_pending` (Stripe Payout created; Stripe state `pending`), `payout_in_transit` (Stripe `in_transit`), `paid_observed` (Stripe `paid`), `payout_failed` (Stripe `failed`, including late paid→failed), `payout_canceled` (Stripe `canceled`), and `action_required` (ambiguous outcome, reconciliation needed, pre-payout blockers such as a disabled external account or pending fee reconciliation, or a failure/cancellation awaiting admin decision). Stripe payout state MUST be treated as null until Payout creation — before that point no Stripe Payout object exists, and the run's state is only a Selene aggregate stage. The admin release acceptance is the single manual gate; automated continuation of an already-authorized run (creating the Payout once transferred funds become available, and reconciling observed outcomes) MUST NOT require a second admin decision.

#### Scenario: No Stripe payout state before Payout creation

- GIVEN a run is in `transfer_created` or `awaiting_connected_balance`
- WHEN any consumer reads the Stripe payout state for that run
- THEN no Stripe Payout state exists yet, and the run's reported state is its Selene aggregate stage alone

#### Scenario: Automated continuation once funds become available

- GIVEN a run is in `awaiting_connected_balance` with Transfers created and the release already authorized by an admin
- WHEN the transferred funds become available on the connected-account balance
- THEN the run continues to Payout creation automatically
- AND the system MUST NOT require a second admin decision for that continuation

#### Scenario: Outcome stages map to Stripe states

- GIVEN a run has a Stripe Payout
- WHEN Stripe reports `pending`, `in_transit`, `paid`, `failed`, or `canceled`
- THEN the Selene aggregate stage follows as `payout_pending`, `payout_in_transit`, `paid_observed`, `payout_failed`, or `payout_canceled` respectively

### Requirement: Business Finality and Late paid→failed Reversal

The observed Stripe state `paid` MUST be treated as an observed state, not immutable business finality. Stripe documents that some payouts initially show `paid` and later become `failed` within five business days; on failure, `failure_balance_transaction` returns the payout funds to the Stripe balance. The system MUST support this late reversal: when authoritative Stripe state changes `paid → failed`, Selene aggregate state and shipment release state MUST be downgraded accordingly and the outcome MUST require admin action. Aggregate current state MAY change at any time; only append-only event/audit evidence is immutable.

#### Scenario: Late paid→failed transition

- GIVEN a payout run reached observed `paid` and shipments were marked released
- WHEN authoritative Stripe state confirms the payout later failed within five business days
- THEN the run aggregate state is downgraded to failed, the shipment release state reflects the reversal, and the run enters Action required

#### Scenario: Returned funds are recorded

- GIVEN a payout failed after being marked `paid`
- WHEN the failure is reconciled
- THEN the `failure_balance_transaction` is recorded as the evidence that funds returned to the Stripe balance

### Requirement: Retry Rules

The system MUST retry a payout only when authoritative Stripe state confirms failure AND the returned funds (via `failure_balance_transaction`) are back on the safe source balance. The system MUST NOT automatically retry ambiguous outcomes, `pending` or `in_transit` payouts, or `canceled` payouts. A failed-payout retry is a child run that reuses the existing per-shipment Transfers; it MUST NOT create duplicate Transfers.

#### Scenario: Confirmed failure with returned funds

- GIVEN authoritative Stripe state is `failed` and the failure balance transaction has returned the funds
- WHEN a retry is executed
- THEN a child payout run is created that reuses the existing shipment Transfers and creates only a new Stripe Payout

#### Scenario: Ambiguous outcome

- GIVEN a payout outcome is unknown or not confirmed by authoritative Stripe state
- WHEN retry is considered
- THEN the system MUST NOT retry and the run remains in Action required

#### Scenario: Pending or in-transit payout

- GIVEN a payout is `pending` or `in_transit`
- WHEN retry is considered
- THEN the system MUST NOT retry while that state holds

#### Scenario: Canceled payout

- GIVEN a payout is `canceled`
- WHEN retry is considered
- THEN the system MUST NOT automatically retry; any new payout requires an explicit new admin decision

#### Scenario: Failed retry is a child run

- GIVEN a payout run previously failed after payout creation
- WHEN the retry executes
- THEN the child run references the original run, reuses its `transfer_group` and shipment Transfers, and never duplicates Transfers

### Requirement: Append-Only Evidence and Event Idempotency

The system MUST keep Stripe payout event and audit evidence append-only and immutable, keyed by event identity, and idempotent against duplicate delivery. Aggregate current state is a mutable projection of that evidence; when they conflict, reconciliation resolves in favor of the evidence plus authoritative Stripe state, and evidence is never rewritten or deleted.

#### Scenario: Duplicate event delivery

- GIVEN the same Stripe payout event is delivered twice
- WHEN both deliveries are processed
- THEN exactly one evidence record is stored and downstream state changes are applied at most once

#### Scenario: Aggregate state conflicts with evidence

- GIVEN aggregate run status and append-only evidence disagree
- WHEN reconciliation runs
- THEN the aggregate is rebuilt from evidence and authoritative Stripe state, and the evidence history remains intact

### Requirement: Admin Bucket Mapping

The system MUST map payout states into four admin buckets — Ready to release, Processing, Action required, and History — with the semantics below. A run MUST be movable between buckets as authoritative Stripe state changes, including out of History on a late paid→failed reversal.

| Selene aggregate stage(s) | Bucket | Meaning |
| --- | --- | --- |
| `ready` (completed, eligible, no release accepted) | Ready to release | Awaiting admin decision |
| `release_accepted`, `transfer_created`, `awaiting_connected_balance` | Processing | Release authorized; Transfers and available balance in progress, no Stripe Payout yet |
| `payout_pending`, `payout_in_transit` | Processing | Stripe Payout created, awaiting observed outcome |
| `payout_failed`, `payout_canceled`, `action_required` (ambiguous outcome, late paid→failed, reconciliation needed) | Action required | Admin decision needed |
| `paid_observed` | History | Completed history, still reversible on late failure |

#### Scenario: Ready to release

- GIVEN a completed eligible shipment with no accepted release
- WHEN the admin queue renders
- THEN the shipment appears under Ready to release

#### Scenario: Processing covers pre-payout and in-flight stages

- GIVEN a run is in `release_accepted`, `transfer_created`, `awaiting_connected_balance`, `payout_pending`, or `payout_in_transit`
- WHEN the admin queue renders
- THEN the run appears under Processing, not History

#### Scenario: Action required

- GIVEN a payout is `failed`, `canceled`, or its outcome is ambiguous
- WHEN the admin queue renders
- THEN the run appears under Action required

#### Scenario: History with late reversal

- GIVEN a run is in History under observed `paid`
- WHEN authoritative Stripe state confirms a later failure
- THEN the run moves out of History into Action required

### Requirement: Official Payout Scenario Matrix

The system MUST satisfy the official scenario matrix below as the consolidated reference for payout behavior. Each row names the authoritative evidence or Stripe state, the Selene aggregate stage, the admin bucket, the retry policy, and the Phase 2 test/evidence that proves it. The distributed GIVEN/WHEN/THEN scenarios in this and the runtime capabilities remain the behavioral contracts; this matrix is the at-a-glance cross-check that no state, reversal, or failure class is left unmapped.

| Scenario | Authoritative evidence/state | Selene stage | Admin bucket | Retry policy | Phase 2 test/evidence |
| --- | --- | --- | --- | --- | --- |
| Eligible manual release | Admin authorization + run ledger record; no Stripe Payout yet | `ready` → `release_accepted` | Ready to release → Processing | N/A — admin decision is the manual gate | 2B stage-transition test with actor authorization recorded |
| Transfer creation | Stripe Transfer object; returned `transfer_id` stored per shipment | `transfer_created` | Processing | N/A — reuse existing transfer idempotently | 2B idempotency test: one Transfer per shipment across repeated runs |
| Connected balance unavailable | Connected-account available balance below release amount (Stripe balance source) | `awaiting_connected_balance` | Processing | Not a failure — automated continuation only, no second admin gate | 2B executor test: Payout creation deferred, then continues when funds become available |
| Payout creation pending | `payout.created` event; Stripe payout state `pending` | `payout_pending` | Processing | Prohibited while state holds | 2A event-ledger ingestion test for `payout.created` |
| In transit | `payout.updated` event; Stripe payout state `in_transit` | `payout_in_transit` | Processing | Prohibited while state holds | 2A ordering test: aggregate follows Stripe states in occurrence order |
| Paid observed | `payout.paid` event; Stripe payout state `paid` | `paid_observed` | History | N/A — not finality; monitored for late failure | 2A test: shipments marked released at most once; History entry created |
| Failed before paid | `payout.failed` event; `failure_balance_transaction` credited | `payout_failed` | Action required | Allowed only after confirmed failure AND returned funds (child run) | 2A downgrade test: aggregate and shipment release state updated; funds evidence recorded |
| Late paid→failed | `payout.failed` after earlier `payout.paid`, within five business days | `paid_observed` → `payout_failed` | History → Action required | Same as failed-before-paid, after authoritative confirmation | 2A late-reversal test: run moves out of History; `failure_balance_transaction` recorded |
| Canceled | `payout.canceled` event | `payout_canceled` | Action required | Prohibited automatic retry; new payout requires a new admin decision | 2A test: cancellation evidence stored; no automatic retry triggered |
| Ambiguous create outcome | No authoritative payout state (timeout, unknown result) | `action_required` | Action required | Prohibited until authoritative state is known | 2A ambiguity test: no retry, no duplicate Payout; run awaits confirmation |
| Duplicate event | Same Stripe event identity delivered more than once | unchanged | unchanged | N/A — idempotent by event identity | 2A idempotency test: one evidence row, one state change |
| Out-of-order event | `payout.paid` delivered before `payout.failed`; Stripe event timestamps are authoritative for occurrence order | resolves to `payout_failed` via authoritative Stripe state | Action required | Allowed only after authoritative confirmation of failure | 2A ordering test: resolve by event timestamps plus authoritative payout state, not arrival order |
| DB sync failure | Run ledger reconciliation-needed entry; Stripe state remains authoritative | `action_required` | Action required | Recovery allowed without duplicate money movement | 2A recovery test: reconciliation converges; no duplicate payout or transfer |
| External account disabled | `account.external_account.updated` with disabled/inactive bank account | `action_required` (Payout creation blocked) | Action required | N/A — Payout MUST NOT be created while the account is not actionable | 2A gating test: payout creation blocked; run surfaces in Action required |
| Confirmed failed retry | Authoritative `failed` state + `failure_balance_transaction` funds returned | child run: `transfer_created` → `payout_pending` | Processing | Allowed — child run reusing existing Transfers | 2B child-run test: reuses `transfer_group` and shipment Transfers; no duplicates |
| Deferred Stripe fee unavailable | Authoritative Stripe fee data not retrievable for the settled payout | `action_required` (fee reconciliation pending) | Action required | Payout retry prohibited; fee-worker lease/recovery retries the job; fees are never fabricated from estimates | 2C fee-worker lease/recovery test: job retried safely, no invented fee data, no payout money movement |

#### Scenario: Matrix stays consistent with the behavioral contracts

- GIVEN any row of the official scenario matrix
- WHEN it is compared against the distributed scenarios of this spec and the runtime capabilities
- THEN evidence, stage, bucket, and retry policy agree with the behavioral contracts and no row permits retrying ambiguous, `pending`/`in_transit`, or `canceled` payouts

### Requirement: Production Prerequisites

Payout release MUST be gated on the following being in place: connected accounts configured with manual payout schedules so funds leave only on explicit Payout creation; a webhook subscription covering the required Connect payout and account events with authenticated, idempotent, retry-safe processing; and reconciliation that can recover from partial failures without duplicate money movement.

#### Scenario: Manual payout schedule enforced

- GIVEN a connected account is used for seller payouts
- WHEN payout behavior is evaluated
- THEN no automatic Stripe payout schedule drains connected funds before an explicit Payout creation

#### Scenario: Event ingestion is retry-safe

- GIVEN a Connect payout or account event is delivered more than once or out of order
- WHEN ingestion executes
- THEN evidence stays idempotent by event identity and aggregate state converges to authoritative Stripe state

## Non-Goals

- Automatic, scheduled, or rule-based payout execution. Release is always a manual admin decision.
- Guaranteed bank-arrival dates. 1–4 business days is an expectation, not a contract.
- Instant Payouts support for Mexico.
- Cancellation, refund, and dispute money movement. These are separate capabilities and MUST NOT be implemented inside payout release/reconciliation.
- Rewriting or deleting payout event/audit evidence.
- Prescribing storage schemas or concrete webhook code here; those belong to their own capabilities and migrations.

## Phase 2 Handoff

Phase 2 implementation is split into small, independently testable slices. Each slice MUST NOT contradict this operating model, lands with focused tests, and excludes cancellation, refund, and dispute money movement entirely.

### Slice 2A — Event Ledger and Late Failure

Build the append-only Connect payout event evidence store keyed by event identity (idempotent against duplicate delivery), the aggregate-status projection rebuilt from evidence plus authoritative Stripe state, and the late `paid → failed` downgrade including `failure_balance_transaction` evidence. Independent tests: duplicate delivery idempotency, out-of-order paid→failed resolution, downgrade of aggregate and shipment release state, and DB-sync-failure recovery without duplicate money movement.

### Slice 2B — Explicit Release Stages and Awaiting-Balance Executor

Implement the Selene aggregate stages (`ready` through `paid_observed`, `payout_failed`, `payout_canceled`, `action_required`), the stage-aware admin bucket mapping, and the executor that continues already-authorized runs from `transfer_created` through `awaiting_connected_balance` to Payout creation without a second admin gate. Includes failed-retry child runs that reuse existing `transfer_group` and shipment Transfers. Independent tests: stage transitions, no Stripe payout state before Payout creation, automated continuation once funds become available, and child-run transfer reuse.

### Slice 2C — Fee-Worker Lease/Recovery

Implement the deferred Stripe fee reconciliation worker with lease-based execution and crash-safe recovery. It uses only authoritative Stripe fee data, retries safely under lease loss, and never fabricates fees from estimates. It performs no payout money movement and does not alter payout states. Independent tests: lease acquisition/recovery, retry-safe idempotent writes, and unavailable-fee handling that parks the payout in fee reconciliation without blocking refund-free release flows.

### Slice 2D — Deployment Verification and Manual E2E Gate

Verify the deployment path per repository policy: repository artifacts first, then maintainer-applied SQL, Edge Function deployment, required secrets/webhook configuration, `bun db:types` regeneration only after remote confirmation, and focused test runs. Finish with a manual end-to-end payout verification in the Stripe test environment (release → Transfer → connected balance → Payout → observed outcome, including one forced failure and retry) and an explicit admin sign-off gate before production use. This slice is a human gate, not automated.

## Acceptance Criteria

- Manual release after shipment completion is the only path from platform balance to a seller bank.
- Every funds movement follows the single-modal path through the connected-account balance.
- Release semantics distinguish initiation from guaranteed bank receipt.
- `paid` is an observed state; late `paid → failed` reversal is supported end to end.
- Retry happens only on confirmed failure with returned funds, as a child run reusing existing Transfers.
- Event/audit evidence is append-only, immutable, and idempotent by event identity.
- Admin buckets map all payout states, including reversals out of History.
- Production prerequisites are explicit and enforced before payout processing is trusted.
