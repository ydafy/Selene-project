# Payout release self-blocking fence

## Objective
Repair the deployed payout-release regression where a new manual release creates its own shipment mapping and Transfer, then the fence-time eligibility re-read treats that same mapping as a prior release (`already_released`) and marks the run failed before Stripe Payout creation.

## Authorized scope
- `supabase/functions/release-connect-payout/release-connect-payout.ts`
- `supabase/functions/release-connect-payout/release-connect-payout.test.ts`
- This ODD task record

## Constraints
- Preserve all financial safety gates, durable fencing, idempotency, and no-duplicate Transfer/Payout behavior.
- The `already_released` exception must be owner-scoped to the current run; it must never admit a mapping owned by another run.
- No remote SQL, deployment, cron, secrets, types regeneration, database mutation, or commit.
- After the correction, rerun Case 1 only with a fresh isolated sandbox purchase; do not retry run `7b3ce005-53af-4066-8bcf-887477be7ca4` as happy-path evidence.

## Tasks

- [x] **T1 — Capture owner-scoped regression contract**
  - Prove a newly created run may pass its own fence-time revalidation despite its own active mapping.
  - Prove a different run's active mapping remains blocked.
  - Evidence: two focused regression tests added; on pre-fix code the self-mapping case rejected with `already_released` and the foreign-mapping case surfaced the wrong error (`already_released` instead of `PAYOUT_RELEASE_ALREADY_ACTIVE`).

- [x] **T2 — Repair the fence-time eligibility path**
  - Carry the current run identity into the post-transfer revalidation only.
  - Preserve every initial-release, resumed-run, retry, and conflict rule.
  - Repair: the in-fence try block re-reads `findActiveShipmentMappings`; any mapping owned by a run other than the fenced one throws `PAYOUT_RELEASE_ALREADY_ACTIVE` (409), and only when the fenced run owns an active mapping is `already_released` appended to the tolerated ineligible reasons. Initial-read, resumed-run, and retry allowances are unchanged.

- [x] **T3 — Independently verify focused behavior**
  - Run the focused release function suite and report exact outcomes.
  - Evidence: `bun test supabase/functions/release-connect-payout/release-connect-payout.test.ts` → 52 pass, 0 fail (pre-fix baseline on same suite: 50 pass, 2 fail).

## Correction 2 — per-shipment already_released tolerance (verified qualification)

Independent verification flagged that the first repair was batch-global: `some` self mapping admitted `already_released` for every row. Tightened (same files):

- `assertEligibleRows` accepts an optional per-shipment override `allowedIneligibleReasonsForShipment` (falls back to the global list when absent; all other call sites unchanged).
- Fence-time revalidation now tolerates `already_released` only for shipments whose active mapping belongs to the fenced run; every other row keeps its queue verdict (the base `already_released` allowance is filtered out per row at fence time). Foreign active mappings stay rejected with `PAYOUT_RELEASE_ALREADY_ACTIVE` before Stripe.
- New multi-shipment regression test: self-mapped `shipment-1` cannot authorize unmapped `shipment-2`'s `already_released` marker; fence exits failed with reason `already_released`.
- Evidence: RED observed (batch-global code admitted the run), then GREEN — `bun test supabase/functions/release-connect-payout/release-connect-payout.test.ts` → 53 pass, 0 fail.

## Live incident evidence
- Order: `a411e8ae-816a-5425-91ae-7bda6b37ad1f`
- Shipment: `f69663d6-69df-569d-a11a-849630692e0a`
- Run: `7b3ce005-53af-4066-8bcf-887477be7ca4`
- Transfer: `tr_3UIJSyACloWdhaxv1OloK7jT`
- Observed: Transfer succeeded; run failed at `payout_failed` with `failure_reason=already_released`; no Stripe Payout and no payout events.
