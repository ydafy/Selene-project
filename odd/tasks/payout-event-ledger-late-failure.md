# Payout Event Ledger and Late Failure

## Goal
Implement only Phase 2A: append-only Stripe payout evidence and reconciliation of late `paid_observed` to `payout_failed`.

## Scope

### In scope
- Minimal database evidence ledger, constraints, RLS, grants, and indexes.
- Idempotent Stripe event ingestion keyed by Stripe event identity.
- Aggregate payout-run projection and shipment release-state downgrade for late `paid → failed`.
- `failure_balance_transaction` evidence.
- Duplicate, delayed, out-of-order, and DB-sync-failure reconciliation behavior.
- Focused strict TDD and deployment handoff.

### Out of scope
- Phase 2B: explicit release-stage persistence and awaiting-balance executor.
- Phase 2C: fee-worker lease/recovery.
- Phase 2D: remote deployment, webhook configuration, scheduler work, and manual E2E execution.
- Admin UI/API pagination and bulk operations.
- Cancellation, refund, and dispute behavior.

## Tasks

- [x] **1. Map current reconciliation and derive minimal contract**
  - Mapped current payout run/mapping schema, webhook reconciliation, focused tests, and pre-existing terminal-`paid` assertions.
  - Derived minimal surfaces: payout event-ledger migration + guard test, webhook reconciliation module/test, and webhook wiring.
  - Preserved pre-existing worktree changes; generated types remain unchanged until maintainer-applied SQL is confirmed.
  - **Decision:** on conflicting or out-of-order evidence, retrieve the Stripe Payout from the relevant connected account; Stripe decides the mutable aggregate projection.
  - `account.external_account.updated` handling is deferred to 2B account-health gating.

- [x] **2. Add RED coverage for Phase 2A invariants**
  - Duplicate Stripe event identity stores one evidence record and applies projection at most once.
  - Late `payout.failed` after observed `paid` downgrades run and shipment release state.
  - Out-of-order events resolve against Stripe authority rather than arrival order.
  - DB projection failure retains evidence and enters recovery without duplicate money movement.
  - RED observed: `bun test` on the two focused files ran 31 tests with 25 failures before implementation (empty ledger migration + old reconciliation interface).

- [x] **3. Implement ledger and reconciliation**
  - **Verification blockers (remediated and independently verified):** both blockers were corrected under focused strict TDD on 2026-09-20:
    - Duplicate evidence replay: `reconcileConnectPayoutEvent` no longer short-circuits a duplicate event when the run is `reconciliation_needed`; `replayProjectionForDuplicate` rebuilds the projection from the same event with no second evidence insert. Safety derivation uses `run.paid_at`, which persists after a run leaves paid: a replayed paid event never releases shipments (`already_reconciled` when paid_at set; `reconciliation_needed` when absent, so a possible recorded failure is never re-released), and a replayed downgrade re-runs the same terminal paid-run gates (occurrence order, then Stripe authority) as the first attempt. Runs that never reached paid replay forward via `applyProjection(downgrade: false)` without touching release markings. Replay failures re-mark `reconciliation_needed`; duplicate no-op for completed projections is unchanged.
    - Ledger grants: migration now `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on the table and grants **no** direct table privileges to any role (matching the repo SECURITY DEFINER pattern, e.g. `fn_reconcile_connect_payments`): the definer append RPC runs with its owner's privileges, service_role keeps only `GRANT EXECUTE` on `fn_append_connect_payout_event` (still service_role-only). Direct UPDATE/DELETE/TRUNCATE/INSERT cannot be granted through this migration; static guard tests assert the revocations and the absence of any table grant.
    - Explicit service_role table revoke (2026-09-20 correction): independent verification flagged that absence of a `GRANT` does not prove direct privileges are absent. Migration now adds `REVOKE ALL ON public.connect_payout_events FROM service_role;` after the PUBLIC/anon revoke and before the RPC EXECUTE grant; SECURITY DEFINER append RPC and service_role EXECUTE-only RPC access are unchanged. Guard tests now require the explicit revoke, its ordering (after the PUBLIC revoke, before the RPC grant), and explicitly prove no direct `GRANT ... TO service_role` on the table. RED observed (1 new test fail); GREEN observed 11/11 migration tests and 37/37 across the two focused files; `git diff --check` clean.

- [x] **3a. Initial implementation evidence (superseded by verification blockers)**
  - Migration `supabase/migrations/20260919023427_connect_payout_event_ledger.sql` (created via `supabase migration new connect_payout_event_ledger`): service-role-only `connect_payout_events` table keyed by `stripe_event_id` UNIQUE, Stripe occurrence time `stripe_created` (`event.created`) + `received_at`, `observed_payout_status`, `failure_code`/`failure_message`/`failure_balance_transaction`, indexes on `(stripe_payout_id, stripe_created)`, `connect_payout_run_id`, `event_type`, append-only mutation-blocking trigger, RLS enabled, REVOKE from anon/authenticated/PUBLIC, `fn_append_connect_payout_event` SECURITY DEFINER RPC (`ON CONFLICT DO NOTHING`, returns inserted-vs-duplicate) granted only to `service_role`.
  - Reconciliation module redesigned: evidence appended before projection; duplicate event identity short-circuits projection; `paid → failed` downgrade (occurrence-ordered, or Stripe-confirmed when out of order) downgrades run and mapping and clears `shipments.stripe_payout_id` only where it equals the failed payout id; `failure_balance_transaction` carried in evidence and run failure reason; older paid events never re-release shipments; projection failures retain evidence and mark `reconciliation_needed`; `payout.created` and non-terminal `payout.updated` states are evidence-only (no 2B stage persistence).
  - Webhook wiring (`stripe-webhooks/index.ts`): all five payout event types pass `event.id` and `event.created`; evidence persisted via the narrowly-granted RPC (`as never` typed-RPC compatibility pattern; no new table named in typed client code); on conflict/out-of-order the Stripe Payout is retrieved with the connected account derived server-side from the run seller (`profiles_private.stripe_account_id`); missing payout-id metadata recovery and webhook DLQ behavior preserved; cancellation/refund/dispute logic untouched.
  - GREEN observed: same focused command, 31/31 pass.

- [x] **4. Verify and prepare deployment/E2E handoff**
  - The separate payout-release SQL guard work unit corrected the three stale guards without changing SQL. Final independent verification passed: focused Phase 2A 37/37, restored broad gate 101/101 (520 assertions), eslint clean, and the 22-column view guard rejects a 23-column mutation. The maintainer-owned deployment/E2E sequence below remains unexecuted.

- [x] **4b. Remediation evidence for the two verified Phase 2A defects**
  - RED observed (`bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_event_ledger.test.ts`): 6 new tests failing (4 duplicate-recovery replay tests + 2 grant guard tests), 30 pre-existing tests passing.
  - GREEN observed (same command): 36/36 pass, 184 assertions.
  - Triangulation command: 95 pass / 3 fail; the 3 failures are the same verified baseline set (2 `connectMoneyFlowGuards.test.ts` admin-view assertions + 1 `payout-release-amount-contract.test.ts` operational-SQL copy), all reading the pre-existing worktree-modified `supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql` and its untracked migration counterpart — files outside this change's edit surfaces; untouched.
  - `bunx eslint supabase/functions/stripe-webhooks --ext .ts`: clean (exit 0).
  - Wiring note (out of scope, for review): `supabase/functions/stripe-webhooks/index.ts` `findConnectPayoutRun` selects `id, status, stripe_payout_id, seller_id, paid_at` — no wiring change is needed for replay correctness (replay derives prior state from persistent `paid_at`), but the production webhook must surface the duplicate-recovery `reconciliation_needed` path unchanged; remote SQL and deploy remain maintainer-owned.

- [x] **4a. Initial verification evidence (superseded by verification blockers)**
  - Focused GREEN command: 31/31 pass.
  - Triangulation command: 90 pass / 3 fail — the 3 failures (`connectMoneyFlowGuards.test.ts` admin-view assertions, `payout-release-amount-contract.test.ts` operational-SQL copy) read pre-existing worktree-modified files outside this change's edit surfaces and are verified baseline failures, not change-caused.
  - `bunx eslint supabase/functions/stripe-webhooks --ext .ts`: clean (exit 0).
  - Deployment handoff recorded below; SQL/deploy/E2E not executed.

## Verification
- Strict TDD: observe focused RED before implementation, then GREEN and triangulation.
- Run focused Bun tests for changed payout migration, reconciliation, and webhook paths.
- Run targeted type checks only if changed surfaces provide a stable command.
- Do not apply SQL, deploy functions, configure Stripe webhooks, rotate secrets, or execute E2E.

## Evidence
- Engram mirror: `odd/payout-event-ledger-late-failure/tasks`.
- Strict TDD RED observed before implementation; GREEN observed after; triangulation and eslint evidence recorded in task 4.
- Independent final verification: PASS for Phase 2A functionality; direct ledger privileges are revoked from PUBLIC, anon, authenticated, and service_role, while service_role retains only append-RPC EXECUTE.
- Restored broad verification after the separate guard repair: 101/101 pass (520 assertions); the former three stale query guards no longer block closure.
- Maintainer-confirmed deployment: migration applied remotely, `stripe-webhooks` deployed, and `bun db:types` run. Generated types were verified to contain `connect_payout_events` and `fn_append_connect_payout_event` with the expected arguments/boolean return.
- Not executed: Stripe webhook subscription confirmation and the specified Stripe test-mode E2E.

## Maintainer deployment handoff (do in this order)
1. Apply migration `supabase/migrations/20260919023427_connect_payout_event_ledger.sql` in the Supabase Dashboard (single transaction; after existing migrations in file order).
2. Deploy Edge Function `stripe-webhooks` (contains reconciliation + wiring changes).
3. Stripe Dashboard: ensure the webhook subscription covers `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled` (Connect/account webhook endpoint for connected-account payout events). `account.external_account.updated` is intentionally NOT required in 2A.
4. Secrets: no new secrets required (existing `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
5. Only after remote SQL confirmation: run `bun db:types`, then verify `connect_payout_events`/`fn_append_connect_payout_event` appear as expected in generated types before relying on them.
6. Smallest 2A-only Stripe test-mode E2E: release one eligible shipment → payout created → force payout failure (`in_transit → failed`) in test mode → confirm run/mapping downgrade to failed, shipment `stripe_payout_id` cleared, `connect_payout_events` rows for both events, and duplicate redelivery produces one evidence row per event id; repeat a `paid → failed` late reversal with Stripe's test clock/manual state if available.
