# Payout failed retry recovery

## Goal
Allow an administrator to retry a Stripe Connect payout attempt only after it reaches `failed`, while keeping `canceled`, `paid`, and ambiguous states terminal or manually reviewed.

## Approved policy
- `failed`: explicit admin retry allowed.
- `canceled`: terminal and manual-review only.
- `paid`: terminal.
- `pending_reconciliation` and `reconciliation_needed`: never retryable.

## Invariants
- A retry is a child payout run; the failed parent remains immutable evidence.
- The server derives seller, shipments, amount, transfer, and Stripe idempotency key.
- One failed parent has at most one child retry run.
- Retrying never creates a second transfer.
- Stripe must create a payout before its child run records the payout ID.
- Every terminal run remains immutable under late webhook delivery.

## Tasks

- [x] **1. Define retry persistence and queue contract (RED)**
  - Added migration and admin queue contract coverage for child-run identity, one-child-per-parent, failed retry candidates, and canceled manual review.
  - Evidence: `bun test supabase/migrations/__tests__/connect_manual_payout_release.test.ts` failed as expected (6 passed, 2 failed); `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts` failed as expected (4 passed, 5 failed).

- [x] **2. Implement and deploy the database contract**
  - Implemented and remotely applied `supabase/migrations/20260917032655_add_connect_payout_failed_retry_contract.sql`; aligned the canonical operational SQL.
  - Evidence: `bun test supabase/migrations/__tests__/connect_manual_payout_release.test.ts` passed: 8 tests, 0 failures.
  - Maintainer confirmed remote application and regenerated types. Verified `retry_of_run_id` on `connect_payout_runs` and retry/manual-review fields on `admin_connect_payout_release_view` in `packages/types/src/database.types.ts`.

- [x] **3. Implement server-side failed retry execution (TDD)**
  - Implemented server-derived retry requests, failed-parent validation, child create/reuse, amount/eligibility drift protection, transfer reuse, and retry-aware logging.
  - Evidence: `bun test supabase/functions/release-connect-payout/release-connect-payout.test.ts` passed: 33 tests, 0 failures; webhook isolation suite passed: 15 tests, 0 failures.

- [x] **4. Implement admin retry and terminal-state UX (TDD)**
  - Implemented run-scoped failed retry mapping, retry mutation/feedback/cache invalidation, and canceled manual-review UI.
  - Kept failed retry actions isolated from ordinary seller release batches.
  - Evidence: `bun test apps/admin-web/src/lib/connectPayoutReleaseQueue.test.ts apps/admin-web/src/hooks/useConnectPayoutReleaseQueue.test.ts` passed: 15 tests, 0 failures, 38 assertions.

- [x] **5. Verify and hand off deployment**
  - Focused verification passed: migration 8/8, release function 33/33, webhook reconciliation 15/15, and admin queue/hook 15/15.
  - Resolved the environment-only typecheck block by materializing the existing lockfile with `bun install --frozen-lockfile`; no package, lockfile, or configuration change was made.
  - Independent admin typecheck passed: `cd apps/admin-web && bunx tsc -b`.
  - Deployment handoff: deploy `get-connect-payout-release-queue`, then `release-connect-payout`, then `stripe-webhooks`, then admin web. Do not reapply the already-confirmed migration. Verify in Stripe test mode: one failed payout creates one retry child and fresh payout; repeated retry reuses that child; canceled stays manual-review-only; late parent webhooks cannot alter the child.
