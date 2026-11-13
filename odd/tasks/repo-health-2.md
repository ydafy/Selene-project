# Repo health 2: CI checks, a reliable local Bruno run, and test hygiene

Worktree `School-portal-worktrees/repo-hygiene`, branch `chore/repo-health-2` from `main` c475c8f1. Scope chosen by the maintainer after roadmap #272 closed: eight tooling issues, no app or admin-web logic. One small PR per task.

## Specs

- S1 (#201): "a skipped run is invisible: the audit only emails on failure, so a skipped audit looks the same as a clean one". "Still open: whether to detect a missed run automatically (for example, a check that the report issue was updated in the last 8 days, or a second cron as a fallback)."
- S2 (#118): "The full Bruno collection (`bun run api:test`) passes only on its first run after `supabase db reset`. Every later run fails `functions/account-closure-cleanup-empty`."
- S3 (#492): "`supabase/tests/database/account_closure_cleanup.test.sql` (test 19) fails when `bun run test:db` runs right after a full Bruno run without a `supabase db reset` in between." Fix: "Either make the test claim only closures it created (filter by its own user ids, or isolate with a claim limit over its fixtures), or have the Bruno requests clean up their closures."
- S4 (#58): "Each cron processes every eligible dispute in the database, not only the fixtures the request created." "Possible approach: assert that a run changes nothing outside the fixture ids, or run each cron test after `supabase db reset`."
- S5 (#451): "`bun run api:test` fails 3 of 682 requests, all in the dispatch-push chain". "Next step: call `dispatch-push` with the cron secret on a fresh local stack and read the 500 body and the function log."
- S6 (#279): "Sort `readdirSync` results, or assert exactly one match, before a test reads `files[0]`." "fix only the sites that remain."
- S7 (#345): "Add `forbidOnly: !!process.env.CI` to `playwright.config.ts`, so a committed `test.only` fails CI instead of silently skipping the rest of the suite." "Upload the Playwright report when the run had flaky tests too, not only on failure."
- S8 (#169): "The Playwright spec `closed account detail shows the deleted label and no status actions` failed once: it waited for the text "Cuenta eliminada" on `/users/<closedId>` and timed out after about 8 seconds."
- S9 (maintainer, L1): "la idea de este owktree era el tema de salud del repo, o life quiality chagnes del repo, osea, tocar codigo o logica por asi decirlo de la app o admin web quedaba fuera"
- S10 (maintainer, L5): "no lo quiero hacer yo manual eso seria ineficiente, lo mejor seria que el agente apagara cunado ya no lo use y lo prenda cunado lo quiera usar"

## Tasks

- [x] T1 (S1, S9): detect a missed weekly dependency run (#201)
- [ ] T2 (S2, S3, S9): close-account Bruno requests stop leaking pending closures into later runs and pgTAP (#118, #492)
- [ ] T3 (S4, S9): isolate the dispute cron Bruno requests (#58)
- [ ] T4 (S5, S9): find and fix the dispatch-push 500 on the local stack (#451)
- [x] T5 (S6): sort or assert `readdirSync` matches before `files[0]` (#279)
- [x] T6 (S7): Playwright `forbidOnly` on CI and a report on flaky runs (#345)
- [x] T7 (S8): deflake the closed account e2e spec (#169)
- [x] T8 (S10): the agent starts the local stack when a check needs it and stops it, with the processes it started, when the work is done or paused

## Log

- L1: Maintainer, 2026-11-13: "okey empecemos por esos que comentas #201, #118, #58, #492 y #451 y #279 y 345 y #169. Ese sera como el scoop de este woktre." Earlier: "esq, la idea de este owktree era el tema de salud del repo, o life quiality chagnes del repo, osea, tocar codigo o logica por asi decirlo de la app o admin web quedaba fuera". Findings #522-#527 and private advisory GHSA-v5g4-vvrr-hprp are app logic and stay out of this worktree. Supabase schema and table work stays out too.
- L2: Maintainer chose for #201 "Cron de respaldo (recomendado)": a second cron hours later runs the audit and the report only when the morning run did not run that week. For #345: "Sí, dale" (both config changes approved: `forbidOnly` and uploading the report on flaky runs).
- L3 (T5, worker): no change needed. The five remaining sites that read `[0]` of a filtered `readdirSync` result (`scripts/verify/test-shipment-cancellation-coordination.test.ts` lines 9, 67, 84; `scripts/verify/test-shipment-transfer-coordination.test.ts` lines 44, 63) assert `toHaveLength(1)` first; every other site sorts or only lists offenders that must be empty. #279 closed with that evidence. A guard for the pattern was judged overengineering (zero sites).
- L4 (T1, worker): both weekly workflows get a backup cron about six hours later (audit `23 20 * * 1`, report `53 20 * * 1`). A first job `should-run` runs `scripts/ci/scheduled-backup.ts`: every trigger except the backup cron runs; the backup runs only when no other scheduled run of the workflow started in the last 24 hours (any conclusion), and runs anyway when `gh run list` fails. 9 tests (RED on a stub, then GREEN); `bun test scripts/ci` 153 pass; both YAML files parse with `Bun.YAML.parse`. Not exercised on GitHub yet: the first Monday after merge proves it (check that the 20:23 and 20:53 runs show the main job skipped).
- L5: Maintainer, 2026-11-13, after Docker stopped answering with three worktrees in heavy phases at once: "okeyu, si, eso de apagarlo es lo mejor, peor no lo quiero hacer yo manual eso seria ineficiente, lo mejor seria que el agente apagara cunado ya no lo use y lo prenda cunado lo quiera usar no cres?" `verify-selene` already said `supabase stop` when finished, but agents (this session included: a `stripe:listen` left running since the previous evening) did not do it, so the rule moved into `supabase/AGENTS.md`, "Local stack", which every Supabase task reads (agent-mistake #530).
- L6 (T6, T7, worker): `playwright.config.ts` sets `forbidOnly: !!process.env.CI` and, on CI, adds a JSON reporter (`test-results/results.json`); the CI e2e job reads `.stats.flaky` and uploads the report also when a test was flaky, so the failed first attempt keeps its trace. Proved with scratch specs: `test.only` fails under `CI=1`; a fail-once spec gives `flaky: 1` and `found=true`. #169 did not reproduce (90/90 before the fix, cold Vite runs, a 12-worker stress run, and no flaky e2e result in the last 199 CI runs); the spec now waits for the closed account's profile response before its first assertion, which removes the only unawaited window, but the root cause is not proven. Hypothesis to check with the first uploaded flaky trace: a stale Vite dependency cache needed a reload that the specs' blanket `routeWebSocket` close blocks. #169 stays open until such a trace exists. `bun run test:e2e` 28 passed, with and without `CI=1`.
