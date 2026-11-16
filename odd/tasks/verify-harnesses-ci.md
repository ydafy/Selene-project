# Run the verify harnesses automatically

Roadmap #623, item 3 (#626). The harnesses in `scripts/verify/` are cited as evidence in `odd/tasks/` and `docs/specs/` but only run by hand. This feature runs them in CI and makes sure no harness can stay unrun.

## Specs

- S1. A runner, `scripts/verify/run-harnesses.ts`, runs one group of harnesses in sequence, one `bun` process at a time, never in parallel (the harnesses share fixed ids such as admin `…0001`, seller `…0002`, buyer `…0003`). It prints each harness with its duration and result, a summary, and exits non-zero when any harness fails. Groups:
  - `pr`: the harnesses that need only the `supabase start` Postgres: `test-shipment-cancellation-refund-events`, `test-shipment-cancellation-refund-status`, `test-shipment-cancellation-refund-resolution`, `test-shipment-refund-problems`, `test-shipment-cancellation-summary`, `test-shipment-carrier-cancellation`, `test-shipment-carrier-review`, `test-tracking-cancelled-shipment`, `test-shipment-tracking-during-cancellation`, `test-shipment-label-reconciliation`, `test-cron-health`, `test-auto-cancel-lease`, `test-checkout-recovery-lease`.
  - `weekly`: the harnesses that also need `supabase functions serve` (`test-auto-cancel-paid-timeout`, `test-account-closure-cleanup`, `verify-stripe-fee-lease-recovery`) or the docker-compose Postgres of `db:test:up` (`postgres-smoke`, `test-shipment-cancellation-coordination`, `test-shipment-transfer-coordination`).
- S2. Every file in `scripts/verify/` is listed exactly once: in a runner group, or in a manual list with a one-line reason (`confirm-shipment-delivery-harness`: needs deployed fixtures and a bearer token; `schema-fingerprint.sql`: compares against the remote project; `declarative-schema-check`: already runs in `db-test`; `verify-payout-recovery-adapters`: offline, `bun test` covers it), or as a helper of another harness (`*.probes.ts`, `*.test.ts`). A guard test fails on a file that is in no list, and on a listed file that no longer exists.
- S3. The `db-test` job in `.github/workflows/ci.yml` runs the `pr` group after `supabase test db`, against the stack it already started. The pull request run of `db-test` grows by at most about 3 minutes; if the `pr` group takes longer, the slow harnesses move to `weekly`.
- S4. A new workflow runs the `weekly` group on a weekly `schedule` and on `workflow_dispatch`. It starts the stack, serves the Edge Functions with a `CRON_SECRET` generated in the job (no repository secret), and starts the docker-compose Postgres.
- S5. Before CI gates on a harness, it passes on a fresh `supabase db reset` of `main` locally. A harness that fails is fixed if the harness is stale, or reported as a Finding if the SQL is wrong; it is never weakened to pass.
- S6. Docs say how harnesses run: `docs/conventions.md` ("Repository scripts" no longer says "No CI job runs them"), and the runner usage.

## Tasks

- [ ] T1 (S1, S2): runner and guard test, test-first. Route: worker. Commit: -
- [x] T2 (S5): run the `pr` group locally on a fresh stack, measure the duration, fix stale harnesses. Route: parent (needs Docker; coordinate with the `supabase-health` session first). Commit: see L4
- [ ] T3 (S3, S6): `db-test` step and docs. Route: inline. Commit: -
- [ ] T4 (S4, S5): weekly workflow; run the `weekly` group locally first. Route: inline or worker. Commit: -

## Log

- L1. Maintainer approval (2026-11-15) of the design proposed in this session: group A (13 SQL harnesses) in every pull request inside `db-test`, groups B and D weekly, a guard so no harness stays unrun, manual ones listed with a reason. Verbatim: "apruebo todo, y si, me parece bien el gurpo, tu eres el que decide esas cosas, si cres qeu e sla mejor ocpion yo te apoyo."
- L2. Inventory (read-only explorer, 2026-11-15): no harness reaches Stripe or Envia; groups A (13), B (3), D (3), manual (2), plus `declarative-schema-check` (already in CI) and `verify-payout-recovery-adapters` (covered by `bun test`). `db-test` uses Supabase CLI 3.1.0, 20-minute timeout, no `functions serve`, Bun set up after pgTAP. #349 (two harnesses failing on `main`) is closed.
- L3. The `supabase-health` session agreed to the local run ("Go. ... our stacks are independent, so that is fine.") and will message before starting a native review.
- L4. T2 evidence (2026-11-16, fresh `supabase start` of `origin/main` in this worktree, 15 s): the 13 `pr` harnesses ran in sequence in about 18 s in total (1-2 s each). 12 passed. `test-shipment-cancellation-refund-events.ts` failed V8 (21 pass, 1 fail): it read the notification catalogue from the newest migration matching an old regex, so it missed `shipment.payout_blocked` added by `20261114013132_held_payout_seller_notice.sql` (pg-delta quotes the constraint name). Third time this case went stale (#20, #349). Fix: read the catalogue from the declarative schema `supabase/schemas/public/tables/notifications.sql`; the assertion stays an exact comparison with the live constraint. Rerun: 22 pass, 0 fail. The `pr` group fits S3 with a wide margin.
