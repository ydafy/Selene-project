# Late payout progress after terminal outcome

## Objective
Keep signed `payout.created`/`payout.updated(in_transit)` evidence without parking a complete, same-payout terminal run when the progress event arrives after the observed outcome. Preserve genuine payout identity/stage conflicts, incomplete projections, and late `paid → failed` reversals.

## Evidence and boundaries
Run `68004cdf-5af5-4a41-8f3f-00ebda274914` / payout `po_1UIgl2PFiXn3mvQJzDKCyThp`: Stripe reports paid; Selene has `paid_at=2026-09-23 03:22:08+00`, but status `reconciliation_needed`, stage `action_required`, reason `PAYOUT_STAGE_PROJECTION_CONFLICT`. Later signed created/updated/paid deliveries returned reconciliation_needed. The stage RPC returns FALSE for terminal or mismatched run; the webhook adapter turns any FALSE into an exception and the handler parks. Exact live interleaving is not proven.

No remote SQL, deploy, Stripe mutation, generated types, repair of either existing run, retry, second release, cron, secrets, or Case 2. Preserve all existing worktree changes. No commit without maintainer approval. Dashboard redesign is out of scope. Fresh E2E remains open.

## TDD and route
Strict TDD on: `openspec/config.yaml` (`testing.strict_tdd: true`); focused runner `bun test`. T1/T2 delegated: four or more files to understand, multi-file SQL/test implementation. T3 independent verification. Forecast ~200-350 authored changed lines; no delivery/commit until authorized.

## Tasks
- [x] T1 Add observed RED regression for late progress behind a paid run and for a real refusal still escalating. Behavior-level signed-event inputs exercise distinct created/updated evidence and paid-state preservation with the proposed SQL acceptance response; an incomplete terminal state is refused by the mock. The SQL-text contract is intentionally RED until T2 adds a new locked stage-RPC override. This is not a live DB or Stripe-signature verification: the production adapter currently throws on FALSE, and only the new SQL guard can make complete matching paid states return TRUE. Focused command: 101 pass, 1 intentional RED (new additive migration absent).
- [x] T2 Added `20260923010000_late_payout_progress_after_paid.sql` and matching canonical final function. Locked, complete same-payout paid runs accept late progress without writes; mismatches/incomplete states still refuse. Stage false remains an adapter error; terminal paid→failed remains separate. SQL-text tests assert canonical equality and refusal guards. Focused GREEN: 103 pass, 0 fail.
- [ ] T3 Independently verify focused checks and provide manual-only SQL/Edge deployment handoff. Focused independent check passed (103/103); broader suite remains blocked by the previously observed import failure with unknown baseline, and PostgreSQL execution remains pending.

## Verification and delivery
T1 observed RED: 101 pass, 1 intentional failure (migration absent). T2 GREEN and independent T3 focused verification: `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts` — 103 pass, 0 fail. These mock and SQL-text checks do not execute PostgreSQL or prove the live event ordering. The unchanged production adapter still throws on a genuine FALSE; the SQL guard returns TRUE only for a complete matching paid projection.

Maintainer-only order: confirm `20260923000000_idempotent_connect_payout_terminal_projection.sql` was applied, then apply exactly `supabase/migrations/20260923010000_late_payout_progress_after_paid.sql`. `supabase/queries/payments/connect_payout_stage_fencing.sql` is the canonical copy, not a second SQL migration. No Edge Function source changed in this slice; confirm that `stripe-webhooks` with the previously updated terminal webhook code is already deployed before a fresh test. No new secret, cron, or webhook setting is required by this patch. After maintainer confirmation of remote SQL application, run `bun db:types` and verify the RPC signature, then validate service_role-only EXECUTE, one fresh controlled complete-paid progress sequence, and one real refusal without hiding payout identity or incomplete projections. Inspect run status/stage, mappings, shipment payout ID, stage version, and append-only event evidence. The migration does not repair the already-parked runs; recovery is a separate decision. Do not retry or release those runs again.

The broader relevant suite previously exited 1 (274 pass, 1 fail, 1 error) on missing `npm:zod@4.1.12` during a label-generation test; baseline unknown and no tooling workaround authorized. SQL has not been executed on PostgreSQL or deployed by this session. Case 1 E2E remains open; no commit requested.
