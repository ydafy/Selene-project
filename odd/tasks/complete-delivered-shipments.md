# complete-delivered-shipments: stop the permanent 500 (BL14)

The auto-completion cron answers 500 on every 5-minute run because one delivered shipment with an open dispute is treated as an internal error; the function also never reports to Sentry.
Branch `fix/complete-delivered-shipments-observability` (first attempt: `fix/complete-delivered-shipments`, not merged, L8), worktree `School-portal-worktrees/complete-delivered`. Source: `cross-module-backlog.md` BL14 ("The 500 is still open").

## Specs

- S1 (BL14): "one 500 `{"success":false,"attempted":1,"completed":0,"idempotent":0,"failed":1}` ... the 500 body matches `complete-delivered-shipments`. Map each response to its job and fix."
- S2 (maintainer choice, L8, replaces the first S2 "Completo: clasificar + filtrar en SQL"): "Construir sobre #22, sin migración (recomendado)": "Rebaseo sobre main, descarto mi migración/RPC y me quedo sólo con lo que #22 no tiene: withSentry, saltear las otras dos negativas esperadas, loguear el código real de la RPC, y los fixtures + requests de Bruno. Vos sólo deployás la función; no hay SQL que aplicar." Narrowed in L9: the other two refusals stay failures.
- S3 (`supabase/functions/AGENTS.md`): "Wrap every handler: `serve(withSentry('<folder-name>', handler))` from `_shared/sentry.ts`."

## Tasks

Route: inline.

- [x] T1 (first S2): migration + RPC `fn_list_due_auto_completion_shipments` on `fix/complete-delivered-shipments` (40c0f95, 9c2b77e). Dropped by L8: #22 already excludes active disputes in the query.
- [x] T2 (S1, S2, S3) (d8f8eca): on top of #22: `withSentry`, a coded RPC refusal fails with its own code instead of `INTERNAL_ERROR`, dedicated-account seed fixtures and two Bruno requests.
- [x] T3: backlog (BL14 done, BL35-BL37).
- [x] T4: verification (L10).

## Log

- L1: "okey, si" (start BL14, after the ranked backlog), then the S2 choice.
- L2 (remote, read-only MCP, 2026-10-25): every run since at least 22:50 UTC logs `Delivered shipment completion failed` with `code: INTERNAL_ERROR` for shipment `20423c69-f4ef-5b3f-9d40-174cd2b4642c`, then `BATCH_PARTIAL_FAILURE`, HTTP 500. That shipment is `delivered` (delivered 2026-10-07), its order is `dispute`, and dispute `64f4be78-e086-4a9d-8758-445dbb8cf1ea` is `open` (with `resolved_by` set, an inconsistent test row; not touched). Deployed `fn_confirm_shipment_delivery` equals the repository: it returns `success=false, error='SHIPMENT_HAS_ACTIVE_DISPUTE'` for a dispute outside `resolved`/`rejected`; `mapAutoCompletionRpcResult` turns any `success=false` into `INTERNAL_ERROR`, so the batch fails forever. Sentry has no issue for this function: its handler is `serve(async ...)` without `withSentry` (28 of 39 functions are unwrapped).
- L3: Candidates are the 100 oldest due shipments (`.limit(MAX_AUTO_COMPLETION_BATCH_SIZE)`), so skipping alone would let 100+ disputed shipments starve healthy ones; PostgREST cannot express "no active dispute", hence the RPC (S2).
- L4 (T1): RED `supabase/migrations/__tests__/due_auto_completion_shipments.test.ts` (no migration), GREEN after `20261025235303_due_auto_completion_shipments.sql` + canonical `supabase/queries/shipments/fn_list_due_auto_completion_shipments.sql`. `supabase db reset` applies it. Seed fixtures (order `...f0`): f1 due, f2 due with an open dispute, f3 due with a resolved dispute, f4 delivered 1 hour ago. `fn_notify_dispute_opened` only accepts service-role inserts of open disputes, so the seed sets `request.jwt.claims` for that block and resolves f3's dispute afterwards. Bruno: service role lists f1 and f3 only (oldest first); buyer 403 and anon 401, both `42501`.
- L5 (repro, T2): with the old function on the local stack, `complete-delivered-shipments-skips-disputed` got 500 with f2 logged as `INTERNAL_ERROR` and `BATCH_PARTIAL_FAILURE`, the same signature as production (L2). RED unit tests: 7 failing (skip codes, real RPC codes, `skipped` count, RPC wiring, two Sentry wiring checks). GREEN: 26/26; `deno check` clean. Live: 200 `BATCH_COMPLETED`, f1 and f3 completed, f2 and f4 still `delivered`; a second run is a 200 no-op.
- L6: The first full Bruno run failed `delete-account-blocked` (`active_orders` instead of `pending_payouts`): the fixtures used the shared seeded buyer and seller. They now belong to dedicated `fixture-seller@selene.local` / `fixture-buyer@selene.local` accounts. Prettier: the three existing function files were already unformatted on `main`; only the new test file was formatted.
- L7 (T4): full Bruno collection on a fresh `db reset` 114/114; `bun test` 3343 pass / 0 fail; ESLint clean on the touched files. The pre-commit hook did not run in this worktree (`core.hooksPath = .husky/_`, a generated folder absent here), so the suite was run by hand. Remote advisors not run: the migration is not applied remotely yet. Backlog: BL14 DONE; BL35 (27 functions without `withSentry`), BL36 (deprecated wallet branch in `fn_confirm_shipment_delivery`), BL37 (inconsistent remote dispute) added.
- L8: Before pushing, `main` had PR #22 (`fix/auto-completion-disputes`, another session, e70aa91): the same fix without SQL. It reads active disputes first and leaves those shipment ids out of the candidate query, and counts a `SHIPMENT_HAS_ACTIVE_DISPUTE` race as skipped. Merged but not deployed: remote still answered 500 at 2026-10-26 00:05 UTC. Maintainer chose: "Construir sobre #22, sin migración (recomendado)".
- L9: #22 pins in a test that `SHIPMENT_NOT_IN_CONFIRMABLE_STATE` is not a skip (`isActiveDisputeRefusal(...)` false). That decision is kept: those refusals are transient races and still fail, now with their own code in the log and, through `withSentry`, a Sentry event. Only the dispute refusal is skipped.
- L10 (T4): RED 3 (coded refusal, two Sentry wiring checks), GREEN 28/28; `deno check` clean. Local stack, fresh `db reset`, `functions:serve` + `bun run api:test` 111/111: f1 and f3 completed, f2 (open dispute) and f4 (not due) stay `delivered`, batch 200 `BATCH_COMPLETED`. `bun test` 3344 pass / 0 fail (run by hand: the pre-commit hook does not run in this worktree, `core.hooksPath = .husky/_` is absent). Stack stopped.
