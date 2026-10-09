# Concurrent payout terminal events

## Objective
Prevent same-payout, same-status concurrent Stripe webhook deliveries from parking a successfully paid run as `reconciliation_needed` while preserving true payout identity conflicts, late paid→failed reversals, immutable event evidence, and atomic shipment projections.

## Evidence
Case 1 order `9ad52fd5-10e7-5461-8c28-1fbcf48d658f`, run `7b4f3387-9d9c-44ac-a11c-0c898eb57ff3`, payout `po_1UIdbUAFDkRfE2hSQSjCqgtQ`: `paid_at` set, mapping `paid`, shipment payout ID set, but run parked `reconciliation_needed` with `PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT`. Four signed payout events reached webhook within one second with observed status `paid`; exact interleaving remains unproven. Historical account balance does not explain this run-local projection conflict.

## Scope
- Read and test the webhook reconciliation and atomic terminal projection contracts first.
- Change only the narrow local source/test/SQL artifacts required by a demonstrated root cause. Existing unrelated worktree changes must be preserved.
- Do not mutate Stripe, SQL remote, Edge deployments, cron, secrets, generated types, or financial data. No manual retry/release or live-data repair in this work unit.
- A provider-paid payout with inconsistent local projection is not a completed E2E sign-off.

## Tasks
- [x] T1 Diagnose exact conflict path and write a failing concurrency/idempotency regression.
- [x] T2 Apply bounded fix without masking different payout IDs or paid→failed reversals.
- [ ] T3 Independently verify focused and broader tests and provide maintainer-only deployment and separate recovery handoff (blocked by broader-suite import failure; maintainer decision pending).

## Current pause / handoff
- Two `gentle-ai-explore` launches failed at subagent initialization (`assistant reported an error`). No executor or verification subagent was launched; no source code, tests, SQL, or remote state changed for this defect.
- Read-only source inspection: `connect-payout-reconciliation.ts` calls the atomic terminal RPC for each new paid-observed event; the SQL terminal UPDATE refuses an already-`paid` run and returns FALSE; `index.ts` converts FALSE to `PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT`, and the reconciliation catch parks the run through `fn_mark_payout_run_reconciliation_needed`, which is allowed to overwrite a terminal `paid` status while preserving `paid_at`. Four distinct signed events for the same payout arrived within one second; this is a strong candidate for stale-read/concurrent same-status projection, but exact transaction ordering is unproven.
- Hypothesis for scoped remediation: make the terminal RPC treat only an equivalent already-applied same-payout/same-status paid projection as idempotent after verifying mapping and shipment invariants; never mask payout-ID mismatch, paid→failed reversal, or incomplete dependent effects. Add regression coverage and a new additive migration rather than editing previously deployed migration; independently verify when subagents work. No repair/deploy of the existing inconsistent live run without separate maintainer decision.
- Stripe's official docs distinguish platform balance top-ups and Dashboard connected-account Add funds (a separate transfer) from Selene's `source_transaction` Transfer. Preloaded available balance can test payout creation/event handling but cannot prove this purchase's pending→available settlement; it also conflicts with the original no-direct-balance-mutation test constraint unless the maintainer explicitly changes that criterion.

## T1 RED evidence
- A deterministic webhook test models two distinct paid event identities for the same payout, both using a stale pre-terminal lookup. Its sequential terminal-RPC double applies the first paid projection, refuses the second against the now-paid durable status, and models the existing reconciliation park overwriting paid while retaining paid_at. This is not a live PostgreSQL concurrency test and does not establish the actual Case 1 interleaving.
- `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts`: 92 passed, 1 failed at the new behavior assertion: expected `already_reconciled`, received `reconciliation_needed`. The previously deployed migration was inspected, not edited. T2 must address the real terminal RPC's already-applied equivalence checks without weakening mismatch or late-reversal handling.

## T2 verification
- Added an additive terminal RPC replacement and SQL guard tests; the stale-snapshot webhook mock models the RPC's equivalent paid no-op. The canonical operational SQL ends with the exact replacement function from the additive migration, while retaining the original stage-fencing definitions for historical operational use.
- New SQL tests initially failed: the canonical function differed from the migration, and a negative guard assertion needed correction for the nested no-op branch. After the canonical override and test correction, `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts` passed: 96 tests, 0 failures, 491 assertions.
- These tests inspect SQL text and exercise a deterministic webhook mock; they do not execute SQL on PostgreSQL or prove a live concurrency interleaving. No remote SQL, Stripe mutation, generated types, or deployment occurred. The canonical file contains the historical function followed by the matching override; its final function is identical to the additive migration. T3 independent validation and maintainer-only deployment/recovery remain pending.

## T2 independent-verifier correction
- RED: focused `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts` observed 94 pass, 3 fail on SQL guards for nullable stage, uncleared executor claims, and missing/terminal mappings.
- GREEN: same command observed 97 pass, 0 fail, 499 assertions. The additive replacement and canonical final definition match. Paid equivalence rejects NULL stage or held token/lease; initial paid checks every mapping and shipment after conditional writes and raises on incompleteness, rolling back the RPC transaction. Conflicting payout IDs and paid→failed paths remain intact.
- SQL-text guards and mocked webhook tests do not execute PostgreSQL or prove live concurrency. No remote deployment, live repair, generated types, Stripe mutation, or commit occurred. T3 remains pending.

## T2 webhook paid-equivalence correction
- RED: `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts` observed 97 pass, 1 fail: freshly read `paid` returned `already_reconciled` despite a simulated SQL refusal of incomplete mapping/shipment equivalence; no atomic RPC was called.
- GREEN: same command observed 98 pass, 0 fail, 504 assertions. Fresh paid + paid evidence now invokes the atomic terminal RPC before reporting `already_reconciled`; FALSE parks with `PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT`. Accepted equivalence makes no additional money movement in the SQL contract. Duplicate paid evidence on a `reconciliation_needed` run remains no-op because `paid_at` can persist after failure; it cannot safely re-release. No live PostgreSQL execution or deployment was performed.

## T2 final scoped defects
- RED: focused `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts` observed 97 pass, 2 fail: duplicate paid evidence on a parked run with retained paid_at incorrectly reported already_reconciled; the additive SQL lacked a locked timestamp guard for stale failed evidence.
- GREEN: same command observed 99 pass, 0 fail, 510 assertions. Duplicate paid evidence leaves a parked run reconciliation_needed without another release; the additive terminal RPC (and identical final canonical definition) refuses failed evidence older than the locked paid_at, and refuses missing occurrence/paid timestamps on that branch. Refusal follows existing conflict escalation; genuinely later failure remains eligible.
- SQL guards are text checks, not PostgreSQL execution or proof of a live interleaving. No remote deployment, live repair, generated types, Stripe mutation, or commit occurred.

## Maintainer handoff (limited; not E2E sign-off)
- Decision: deliver a limited handoff despite the broader-suite import failure; do not alter dependency or test configuration to bypass it. T3 remains open.
- Repository SQL deployment source: `supabase/migrations/20260923000000_idempotent_connect_payout_terminal_projection.sql`, after previously deployed `20260919090000_connect_payout_stage_fencing.sql` (and any intervening prerequisite migrations in sequence). `supabase/queries/payments/connect_payout_stage_fencing.sql` is the canonical operational copy, not a second migration to apply.
- Affected Edge Function: `stripe-webhooks` (`connect-payout-reconciliation.ts` bundled via `index.ts`); deploy only after maintainer-controlled SQL application. No new secrets, cron, or webhook subscriptions are introduced by this patch; retain and check the existing signed Connect payout webhook configuration.
- After the maintainer separately confirms remote SQL application, run `bun db:types` and verify the generated RPC signature and schema, then re-run focused checks and a controlled signed-event replay/observation against the patched Edge Function. Confirm run, mapping, shipment, and append-only event evidence agree; explicitly test a true late failure separately in sandbox before sign-off. SQL syntax/transaction semantics and actual concurrent delivery remain unverified locally.
- Recovery of existing run `7b4f3387-9d9c-44ac-a11c-0c898eb57ff3` is a distinct maintainer decision and requires authoritative Stripe-state and audit review. This migration alone does not repair that row. Do not invoke payout Retry or a second release.
- Maintainer authorized a new MX sandbox Dashboard Add funds test **only** as accelerated payout creation/reconciliation evidence. It is a separate balance transfer, not evidence of the purchase-specific pending-to-available settlement; it does not replace full E2E, authorize a mutation by this agent, or open Case 2/retry.

## Verification / commit
- Independent focused verification: `bun test supabase/functions/stripe-webhooks/connect-payout-reconciliation.test.ts supabase/migrations/__tests__/connect_payout_stage_fencing.test.ts` — 99 passed, 0 failed, 510 assertions. This does not execute SQL in PostgreSQL or prove live concurrency.
- Broader relevant suite: `bun test supabase/functions/stripe-webhooks supabase/migrations/__tests__` — exit 1, 274 passed, 1 failed, 1 error across 275 tests / 18 files. `supabase/migrations/__tests__/post-purchase-label-generation-remediation.test.ts` fails at import: Bun cannot find `npm:zod@4.1.12` from `supabase/functions/_shared/zod-runtime.ts`. Its baseline is unknown. Per repository policy, stop for maintainer decision; do not change dependencies or test configuration to bypass it.
- No commit requested. T3 and any PostgreSQL runtime verification, maintainer-only SQL/Edge deployment, and separate recovery of the already-parked run remain pending. Case 1 E2E is not signed off.

## Key Learnings
- Nullable release_stage requires `IS DISTINCT FROM` for paid equivalence; checking `<>` silently yields unknown.
- The paid run alone is insufficient evidence: executor claim fields, every mapping status, and every shipment payout identity must agree before a benign replay.
- A guarded mapping UPDATE may leave failed/canceled or orphaned mappings unchanged; the RPC must raise to roll back the already-written run rather than silently report paid.
- A freshly read `paid` run is not proof of mapping/shipment equivalence: only a TRUE result from the locked atomic terminal RPC can justify `already_reconciled` for newly appended paid evidence.
- `paid_at` is retained when reconciliation parks a run or a late failure occurs; duplicate paid evidence must not infer completed reconciliation from that timestamp.
- A pre-lock TypeScript snapshot cannot decide occurrence ordering after a concurrent paid projection: the SQL run lock must compare the failed event with locked paid_at and refuse stale or undated downgrades.
