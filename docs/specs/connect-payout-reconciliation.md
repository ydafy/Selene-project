# Connect Payout Reconciliation Specification

## Purpose

Track payout runs to observed outcomes, keep immutable append-only event/audit evidence, and recover from partial failures — including the late `paid → failed` reversal documented by Stripe.

## Requirements

### Requirement: Persisted Payout Run Ledger

The system MUST persist each payout run with seller ID, shipment IDs, amount, actor, Stripe payout ID, idempotency key, and reconciliation status. The run's pre-outcome state MUST be an explicit Selene release stage as defined by `payout-operating-model` (such as `release_accepted`, `transfer_created`, or `awaiting_connected_balance`) — not a coarse `pending` status — so the ledger distinguishes where the authorized run is before any Stripe payout outcome exists.

#### Scenario: Payout run is recorded before outcome

- GIVEN admin starts a valid payout release
- WHEN the run is created
- THEN the ledger stores run metadata and marks it in the explicit pre-outcome release stage for that release progress
- AND no Stripe payout status is recorded because no Stripe Payout exists yet

#### Scenario: Duplicate idempotency key submitted

- GIVEN an existing payout run for the same idempotency key
- WHEN another create is attempted
- THEN the system SHALL reuse the existing run and return its current status

### Requirement: Immutable Append-Only Evidence

The system MUST record Connect payout events (including `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, and `account.updated`, `account.external_account.created`, `account.external_account.updated`, and `account.external_account.deleted` where account or bank changes affect actionability) as append-only, immutable evidence keyed by event identity, idempotent against duplicate delivery. The system MUST distinguish this evidence from the mutable aggregate run status: the aggregate is a projection, and reconciliation MUST rebuild it from evidence plus authoritative Stripe state rather than rewriting evidence.

(Previously: Reconciliation tracked only coarse outcomes and did not separate immutable evidence from aggregate status.)

#### Scenario: Duplicate event delivery

- GIVEN the same Stripe payout event is delivered twice
- WHEN both deliveries are processed
- THEN exactly one evidence record is stored and downstream state changes apply at most once

#### Scenario: Aggregate status is a projection

- GIVEN aggregate run status and append-only evidence disagree
- WHEN reconciliation runs
- THEN the aggregate is rebuilt from evidence and authoritative Stripe state
- AND the evidence history remains intact and unmodified

#### Scenario: Required event types are covered

- GIVEN Stripe emits `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, or `payout.canceled` for a reconciled payout
- WHEN the event is ingested
- THEN it is stored as evidence by event identity
- AND `account.updated`, `account.external_account.created`, `account.external_account.updated`, and `account.external_account.deleted` are handled where account or bank changes affect whether the payout is actionable

### Requirement: Current Connected-Account Payout Actionability

The system MUST preserve signed account events as historical evidence, distinct from current payout actionability. For every supported account event, including duplicate delivery, it MUST append evidence idempotently, acquire and commit a positive per-account refresh generation before network retrieval, retrieve the bound connected account and all paginated bank accounts, and commit a validated current snapshot only for the still-pending generation and matching trigger identity. No database transaction SHALL span network retrieval. Historical event timestamps or historical bank health MUST NOT determine current destination health or suppress a refresh.

Actionability MUST require an explicit current `payouts_enabled = true` and exactly one current MXN default bank with status `new`, `validated`, or `verified`. Explicit false takes precedence as `payouts_disabled`; a uniquely selected bank with `errored`, `verification_failed`, or `tokenized_account_number_deactivated` blocks with that reason; all remaining unknown, missing, or ambiguous states block as `destination_undetermined`. The system MUST validate signed account identity and retrieved account/bank ownership, enumerate every bank page, and reject malformed or non-progressing pagination rather than accepting a partial healthy list.

Refresh acquisition MUST immediately fail closed as `account_refresh_pending`. Retrieval or validation failure MUST propagate for webhook retry and leave the acquired generation pending. A superseded commit MUST be observable as `ACCOUNT_REFRESH_SUPERSEDED`, not success, and MUST NOT clear another generation's pending flag. Generations order Selene writes, not Stripe events or mutations; Stripe may change between retrieval and snapshot acceptance. Trigger identity and occurrence time MUST remain separate from current bank identity and snapshot receipt time. Existing no-evidence compatibility MUST remain unchanged; previously blocked accounts MUST NOT be bulk-enabled.

#### Scenario: Historical errored bank and current healthy destination

- GIVEN a signed event concerns an old errored or non-default bank
- WHEN the bound account currently has payouts explicitly enabled and exactly one healthy MXN default bank
- THEN the accepted current snapshot is actionable regardless of the historical bank's status or event timestamp
- AND the signed evidence remains immutable and distinct from the current destination

#### Scenario: Duplicate delivery retries current reconciliation

- GIVEN an account event already has immutable evidence and an earlier retrieval failed
- WHEN the same event is delivered again
- THEN no duplicate evidence is inserted, but a new generation and authoritative retrieval still occur
- AND current state, not the duplicate event's historical fields, determines the accepted gate

#### Scenario: Strict flags, statuses, and destination selection

- GIVEN current payouts are false, unknown, or the unique MXN default bank has a blocked or unknown status
- WHEN current actionability is reconstructed
- THEN the gate is blocked with the specified precedence and never infers true from missing fields
- AND zero or multiple MXN default banks remain blocked; other currencies and non-default banks cannot supply a healthy destination

#### Scenario: Complete pagination and bound identity

- GIVEN the current destination may be on a later bank page
- WHEN reconciliation retrieves current state
- THEN all pages are enumerated and every retrieved bank belongs to the signed connected account
- AND identity mismatch, malformed pages, repeated cursors, or page errors prevent snapshot acceptance and propagate for retry

#### Scenario: Pending refresh and superseded response

- GIVEN a refresh has been acquired and a newer generation is acquired before its response commits
- WHEN the older response attempts acceptance
- THEN it is refused observably without clearing the newer pending gate
- AND only an accepted matching current-generation snapshot can clear pending

#### Scenario: Bounded run recovery without Retry

- GIVEN a healthy snapshot is accepted
- WHEN eligible pre-payout runs parked specifically for `account_not_actionable` are projected
- THEN only those parks may resume toward `awaiting_connected_balance`
- AND failed parents and unrelated blockers remain unchanged, `payout_create_in_progress` is never webhook-demoted, and no automatic Retry, duplicate Transfer, or historical run repair occurs

### Requirement: Outcome Reconciliation Including Late paid→failed Reversal

The system MUST reconcile Stripe payout lifecycle outcomes (`pending`, `in_transit`, `paid`, `failed`, `canceled`) and update shipment release state at most once per state change. The observed state `paid` MUST NOT be treated as immutable business finality: Stripe documents that some payouts initially show `paid` and later become `failed` within five business days, with `failure_balance_transaction` returning the funds to the Stripe balance. Reconciliation MUST support the `paid → failed` transition by downgrading aggregate status and shipment release state, recording the returned funds, and moving the run to Action required.

(Previously: Reconciliation assumed a single terminal status and did not model a late failure after `paid`.)

#### Scenario: Stripe confirms paid

- GIVEN a run in a pre-outcome release stage receives `payout.paid`
- WHEN reconciliation executes
- THEN aggregate status reflects the observed `paid` state and linked shipments are marked released at most once

#### Scenario: Late paid→failed reversal

- GIVEN a run reached observed `paid` and shipments were marked released
- WHEN `payout.failed` is later received or authoritative Stripe state confirms failure within five business days
- THEN aggregate status is downgraded to failed, the shipment release state reflects the reversal, and the run enters Action required
- AND the `failure_balance_transaction` is recorded as evidence that funds returned to the Stripe balance

#### Scenario: Retry follows retry rules

- GIVEN a run failed (including after a late paid→failed reversal)
- WHEN a retry is executed
- THEN it follows the retry rules in `payout-operating-model`: only after authoritative failure confirmation with returned funds, as a child run reusing the existing Transfers
- AND the system MUST NOT automatically retry ambiguous outcomes, `pending` or `in_transit` payouts, or `canceled` payouts

#### Scenario: Stripe succeeds but DB update fails

- GIVEN Stripe payout is created but shipment updates fail
- WHEN reconciliation retry runs
- THEN the run SHALL move to reconciliation-needed and MUST become recoverable without duplicate payout

### Requirement: Event Ordering and Timestamps

The system MUST order payout evidence by Stripe event timestamps and event identity, and MUST NOT assume webhook arrival order matches occurrence order. When events arrive out of order or conflict, reconciliation MUST resolve aggregate status against authoritative Stripe payout state instead of last-arrival-wins, and MUST apply a later failure even when an earlier `paid` event exists.

#### Scenario: Out-of-order delivery

- GIVEN `payout.paid` is delivered before `payout.failed` for the same payout
- WHEN both are processed
- THEN evidence is recorded with Stripe event timestamps in occurrence order
- AND aggregate status resolves to the authoritative Stripe state (failed), not to the first-arriving event

#### Scenario: Conflicting reports

- GIVEN evidence events conflict about the payout state
- WHEN reconciliation runs
- THEN the system consults authoritative Stripe payout state to decide the aggregate status
- AND the conflicting evidence is preserved, never rewritten

## Acceptance Criteria

- Every run is auditable end-to-end with append-only, idempotent event evidence.
- Aggregate status is a rebuildable projection, never confused with immutable evidence.
- `paid` is an observed state; late `paid → failed` is supported and moves runs to Action required.
- Shipment release state updates are at-most-once per state change.
- Event timestamps and ordering come from Stripe occurrence order, not arrival order.
- Required Connect events include `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `account.updated`, and `account.external_account.created`/`updated`/`deleted` where relevant.
- Account actionability uses a generation-fenced current MXN default bank snapshot, not historical bank-event health; duplicates refresh and failures remain fail-closed.
- Payout evidence timestamp ordering remains unchanged and separate from account-refresh generation ordering.
