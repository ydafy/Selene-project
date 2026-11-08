# One home for runbooks and deployment notes (#282)

Item 4b of roadmap #228: move the runbooks, inventories, and decision records scattered next to code into `docs/`, delete the deployment notes whose deployment is done, and guard the placement with a test. Worktree `repo-hygiene`, branch `docs/runbooks-home`.

## Specs

- S1. "Read each file and sort it: a runbook someone will run again, a one-off deployment note whose deployment is done, a deployed-state inventory, or a decision record." Done or pending is decided from the Supabase MCP, not by asking the maintainer; the maintainer is asked only what the MCP cannot see (L2).
- S2. "Delete one-off notes whose deployment is done; Git history keeps them." The four deployment notes are deleted (L3): `apps/admin-web/docs/payments-history-deployment.md`, `apps/admin-web/docs/payments-pagination-deployment.md`, `supabase/queries/payments/connect_account_current_state_deployment.md`, `supabase/queries/payments/stripe_fee_reconciliation_leases_deployment.md`.
- S3. "Move the living runbooks and inventories to `docs/runbooks/`". The folder stays flat, without an index, and moved files get kebab-case names (L2). `docs/runbooks/checkout-deterministic-uuid-cutover.md` stays where it is. `supabase/queries/runbooks/prelaunch-test-data-reset-and-sql-retry.md` is deleted (L4).
- S4. Decision records go to `docs/decision-log.md` (`CARD_LIST_DECISION.md`), and the product doc `apps/admin-web/docs/payments-workbench.md` goes to `docs/specs/` (L2).
- S5. Move `docs/auth.md` to `docs/specs/`. Move `docs/shipment-cancellation-coordination.md` to `docs/specs/` only if B1-B6 are closed; otherwise it stays (L2).
- S6. "Fix every citation and every test that reads a moved file (fix the path; do not convert the test, roadmap #272 does that). Lower `SOURCE_TEXT_TEST_COUNTS` only if a test is deleted."
- S7. "Say in `docs/conventions.md` where operational docs live." A test fails when a tracked Markdown file sits outside `docs/`, `odd/`, `design/`, `.agents/`, `.github/`, an `AGENTS.md`, a `README.md`, or the root `DESIGN.md` and `SECURITY.md` (L2).
- S8. "Out of scope: moving `scripts/` (item 5), rewriting the content of the runbooks."
- S9. "The cited-path check (extended to `docs/` in #250) passes." and "CI is green."

## Tasks

- T1 | S1-S2, S6 | inline | delete the four done deployment notes and fix their citations (only `payments-workbench.md` linked them outside `odd/`) | commit: f1e22385 (done); slice note: its 470 changed lines are almost all deleted notes
- T2 | S3, S6 | inline | move `DEPLOYED_HARNESS.md` and the three inventories to `docs/runbooks/`; delete the prelaunch retry runbook (L4); fix the `auth_deployed_inventory.test.ts` path and two relative citations | commit: this commit (done)
- T3 | S4, S6 | inline | `payments-workbench.md` to `docs/specs/admin-payments-workbench.md` (cited from `DESIGN.md`; its `cd apps/admin-web && bun run` commands became `bun run --filter admin-web`), `CARD_LIST_DECISION.md` to a 2026-05-28 decision-log entry | commit: this commit (done)
- T4 | S5, S6 | inline | `docs/auth.md` to `docs/specs/`; check B1-B6 for the coordination doc | commit: pending
- T5 | S7, S9 | inline | Markdown placement test and the `docs/conventions.md` rule | commit: pending

## Log

- L1. User (2026-11-07): "Seguimos con el roadmap #228: toca #282 (4b, un solo lugar para runbooks y notas de deploy). Cargá Engram: roadmap/repo-layout-228, odd/stale-files/tasks y preference/repo-structure-before-production. Traé lo último de main en este worktree (repo-hygiene), en una rama nueva. Antes de arrancar, revisá que el issue siga vigente y decime si cambiarías algo., Traite main para que estes en lo ultimo y actualziado antes de empezar."
- L2. Audit (2026-11-07): the 11 Markdown files outside the allowed places are exactly the issue's list. They are not all runbooks: 2 living runbooks, 4 deployment notes, 3 inventories or preflights, 1 decision record, 1 product doc. Tests that read Markdown: `supabase/functions/create-connect-payment/deterministic-uuid-cutover.contract.test.ts` (stays) and `supabase/queries/auth/__tests__/auth_deployed_inventory.test.ts`. The maintainer approved: decide done or pending with the Supabase MCP, kebab-case names, a flat `docs/runbooks/`, a placement test, and moving `docs/auth.md` plus reviewing the coordination doc.
- L3. Supabase MCP (2026-11-07): the remote has only the baseline `20261020100000_remote_schema_baseline` and three follow-ups. The notes' migrations are in `supabase/migrations/archive/` and folded into the baseline. The remote has the lease columns (`claim_token`, `claim_expires_at`), `paid_at`, and the paginated `fn_get_admin_payout_queue`; `reconcile-stripe-fees`, `stripe-webhooks`, and `get-connect-payout-release-queue` are deployed. The "current-candidate review remains pending" in the connect-account note is about a candidate that has since merged. The maintainer chose to delete all four notes.
- L4. Cited-path check after the move (2026-11-07): the prelaunch runbook's "Exact SQL retry order" reapplies four migrations now in `supabase/migrations/archive/`, superseded by the October baseline (07377920). Following it today would reapply archived SQL. The maintainer chose to delete it.
