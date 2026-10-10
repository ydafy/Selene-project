# Payout dashboard observability

## Objective
Redesign the admin Payments dashboard so an operator can understand the full payout-release lifecycle without changing money movement, Stripe behavior, database schema, or deployment configuration.

## Problem
The current queue only renders release-ready shipment batches, retryable failed runs, and canceled manual-review runs. It silently drops payout runs in `pending_reconciliation`, `reconciliation_needed`, and `paid`, so it cannot explain an authorized payout that is processing or show a trustworthy payout history.

## Scope
- Admin-only UI under `apps/admin-web`.
- Four presentation buckets: Ready to release, Processing, Action required, and History.
- Presentation-only grouping of rows already returned by `admin_connect_payout_release_view`.
- Preserve existing manual release and failed-retry actions.
- Add focused mapper/hook/component tests.

## Constraints
- Do not alter Stripe calls, money calculations, Edge Functions, SQL, migrations, generated types, remote configuration, secrets, cron, or E2E.
- Do not change unrelated legacy payment UI in this task.
- The current view does not expose `release_stage`, so Processing copy must remain generic and must not claim a specific awaiting-balance stage.
- UI copy follows the existing Spanish admin context; no i18n work is included.
- Preserve existing unrelated worktree changes.

## Delivery
- Route: delegated direct.
- Trigger: multi-file UI implementation after a mandatory four-file map.
- Forecast: approximately 350 authored changed lines, excluding tests already present and generated artifacts.
- Strategy: ask-on-risk; no commit or PR is authorized.

## Tasks

- [x] PD-01 Define the presentation bucket model in the queue mapper so every returned payout row is represented exactly once. Route: delegated direct. Evidence: mapper RED then GREEN; focused mapper/hook run passed 18 tests with 48 expectations.
- [x] PD-02 Redesign `PaymentsPage` navigation and summary context around Ready, Processing, Action required, and History while preserving the existing financial summary and refresh behavior. Route: delegated direct. Evidence: four-bucket navigation keeps cards, refresh, selection, search, and legacy PaymentIntent history.
- [x] PD-03 Create focused bucket components for read-only Processing, Action required, and History, while keeping only Ready able to release shipments and only a retryable failure able to retry. Route: delegated direct. Evidence: source readback confirms Processing/History have no payout mutation; Action required renders retry only when `canRetry` is true.
- [x] PD-04 Run the scoped admin verification, inspect the diff for financial-scope violations, and record results. Route: delegated verification. Evidence: after PD-05, independent re-verification found no findings; mapper/hook tests passed 21/21 and admin typecheck passed.
- [x] PD-05 Correct global payout-run classification/deduplication without expanding financial scope. Route: delegated direct. Evidence: missing-seller rows remain visible; a global rank-based map makes contradictory duplicates choose exactly one conservative bucket. Focused tests passed; independent re-verification remains required for PD-04.
- [x] PD-06 Refine the dashboard visual system and use a shared payout-run presentation primitive across read-only buckets. Route: delegated direct. Evidence: shared row/empty-state primitive supplies consistent lifecycle tones and removes repeated card markup without mapper changes.
- [x] PD-07 Restructure History as one ledger with explicit sibling views for paid payouts and Connect charges; retain and restyle, rather than delete, the PaymentIntent ledger. Route: delegated direct. Evidence: one History frame names both data axes, removes duplicate titles, and puts a truthful count at each axis.
- [x] PD-08 Verify the UX refinement and inspect scope. Route: delegated verification. Evidence: after PD-09, independent re-verification found no findings; focused tests passed 23/23 and typecheck passed.
- [x] PD-09 Correct History navigation count semantics without expanding scope. Route: inline mechanical correction. Evidence: History nav aggregate count removed; each explicitly named axis retains its own accurate count; independent re-verification passed.

## Acceptance criteria
- Every queue row is placed in one operator-visible bucket; no `pending_reconciliation`, `reconciliation_needed`, or `paid` row is dropped.
- Ready keeps the existing server-authoritative release selection/action.
- Processing and History are read-only.
- Action required distinguishes retryable failed payouts from manual-review outcomes without inventing new retry authority.
- The page matches the existing dark dashboard theme and remains responsive.
- History explains the distinction between seller payout runs and buyer Connect charges, without duplicate headings or mixed unlabelled designs.
- No financial behavior or database contract changes.

## Progress
- 2026-09-21: User authorized the admin payout-dashboard redesign. Read-only mapping confirmed that the existing mapper drops Processing, reconciliation-needed, and History rows.
- 2026-09-21: Delegated PD-01 through PD-03. The mapper now classifies and deduplicates every payout run into Ready, Processing, Action required, or History; the page and new read-only bucket components render those buckets without changing money behavior.
- 2026-09-21: Native assessment returned `unassessable` because native command output was empty. Under RDD-off policy this is treated as high risk.
- 2026-09-21: Independent verifier blocked PD-04: runs with `payout_run_id` but missing `seller_id` are silently dropped, and independent bucket maps permit contradictory duplicate rows to occupy more than one bucket. No approval was claimed.
- 2026-09-21: PD-05 corrected both findings with global rank-based classification: `actionRequired` wins over Processing/History under contradictory data, and seller identity may be null without suppressing the run.
- 2026-09-21: Independent re-verification passed with no findings. No E2E, deployment, or remote validation was run because this scope is presentation-only.
- 2026-09-21: User authorized a second UI-quality pass. Exploration found the History tab mixes a payout-run card list with a buyer-charge table under duplicate headings. Decision: retain the useful Connect charge ledger but place it as an explicitly named sibling view under one History frame; do not delete financial observability.
- 2026-09-21: Delegated PD-06 and PD-07. Shared payout-run cards now unify the read-only buckets, while History separates paid seller dispersions from buyer Connect charges. Native assessment remained unassessable.
- 2026-09-21: Independent PD-08 verification found one Medium UI defect: the History navigation badge shows only payout-run count while the tab contains payout runs and buyer charges. PD-09 is required; no approval is claimed.
- 2026-09-21: PD-09 removed the misleading aggregate History nav count. Per-axis counts remain inside the explicit History sibling views.
- 2026-09-21: Independent re-verification passed with no findings. The dashboard UI work is complete; no commit, deployment, or financial-runtime action was performed.

## Verification evidence
- RED: `bun test src/lib/connectPayoutReleaseQueue.test.ts` before implementation: 8 new bucket tests failed, with the absent `processingRuns` shape and expected bucket mismatches.
- GREEN: `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts apps/admin-web/src/hooks/useConnectPayoutReleaseQueue.test.ts` — 18 pass, 0 fail, 48 expectations.
- Typecheck: `cd apps/admin-web && bunx tsc -b` — exit 0, no output.
- PD-05 RED: `bun test src/lib/connectPayoutReleaseQueue.test.ts` — 13 pass, 2 fail for the exact missing-seller and contradictory-duplicate cases.
- PD-05 GREEN: `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts apps/admin-web/src/hooks/useConnectPayoutReleaseQueue.test.ts` — 21 pass, 0 fail, 58 expectations; `cd apps/admin-web && bunx tsc -b` — exit 0.
- Independent re-verification: PASS. `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts apps/admin-web/src/hooks/useConnectPayoutReleaseQueue.test.ts` — 21 pass, 0 fail, 58 expectations; `cd apps/admin-web && bunx tsc -b` — exit 0.
- PD-06/PD-07 validation: `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts apps/admin-web/src/hooks/useConnectPayoutReleaseQueue.test.ts apps/admin-web/src/lib/connectEarnings.test.ts` — 23 pass, 0 fail, 60 expectations; `cd apps/admin-web && bunx tsc -b` — exit 0.
- Independent UX verification: failed acceptance despite 23 focused tests and typecheck passing. Finding: misleading History navigation count.
- PD-09 independent re-verification: PASS. `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts apps/admin-web/src/hooks/useConnectPayoutReleaseQueue.test.ts apps/admin-web/src/lib/connectEarnings.test.ts` — 23 pass, 0 fail, 60 expectations; `cd apps/admin-web && bunx tsc -b` — exit 0.

## Next step
- Await user review; no commit, deployment, or financial-runtime action is authorized.
