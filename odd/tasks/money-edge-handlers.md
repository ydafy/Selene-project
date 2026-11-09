# Test the money Edge Functions by calling them (#274)

Roadmap #272, item 2. Replace the source-text tests of the money Edge Functions with tests that call their handlers or adapters, starting with the four tests #274 lists. Also fixes Finding #253.
Branch `test/money-edge-handlers`, worktree `School-portal-worktrees/repo-hygiene`. One small PR per task (T2-T5). Related: #257 (event list of `stripe-webhooks`, not in scope), #332 (Bruno for four other money functions), #318.

## Specs

- S1 (#274, Scope): "Make the `index.ts` of these functions one line that serves a handler built from its real dependencies, and test the handler by calling it."
- S2 (#274, Scope): "In the money function tests, drop the text assertions that a behavior test already covers. Mark the ones that remain as contracts."
- S3 (#274, Scope): "Lower the item 1 count for `supabase/functions`."
- S4 (#274, Scope): "Load `selene-engineering-principles` and follow `supabase/functions/AGENTS.md` (Bruno collection, local payments loop) for the changed functions."
- S5 (#274, Done when): "Each listed function has a behavior test that fails when the wiring it replaced is broken (prove one with a probe)."
- S6 (#274, Done when): "`deno check --frozen */index.ts`, `bun test`, and the Bruno requests for the changed functions pass."
- S7 (#274): "**Out of scope:** non-money functions (item 6), SQL (items 3 to 5)."
- S8 (#253, What happens): "`packages/types/src/__tests__/singleModalCheckoutContracts.test.ts` declares the functions `validateSingleSecretResponse` and `validateReleaseSuccess` inside the test file and then tests those copies. The production types it imports are only touched through `void` assignments, which check that the types compile and nothing else. The tests pass whatever the production code does."

## Tasks

- [x] T1 (S1-S8): re-check #274 and plan the slices (L2)
- [x] T2 (S1, S2, S3, S5): `stripe-webhooks` payout attach and terminal adapters: move them out of `index.ts` into a module, test them with a fake client, delete `connect-payout-attach-adapter.test.ts` and `connect-payout-terminal-adapter.test.ts` text reads; payments loop for the payout events (e079989d; loop not run, L3)
- [ ] T3 (S1, S2, S5): `complete-delivered-shipments`: `handler.ts` with injected data access, behavior tests for the dispute exclusion, Connect-only filter, cron secret before any query, and the active-cancellation skip; `index.ts` one line; Bruno
- [ ] T4 (S1, S2, S5): `create-dispute`: `handler.ts`, behavior tests for auth before evidence ownership before the RPC, and RPC-only writes; `index.ts` one line; Bruno
- [ ] T5 (S2, S8): drop covered text assertions or mark contracts in `stripe-webhooks/signature.test.ts`, `create-connect-payment/allocation-validation-wiring.test.ts`, `resume-pending-payouts/resume-pending-payouts-type-contract.test.ts`; fix #253 by testing the production validators
- [ ] T6 (S3, S6): lower `SOURCE_TEXT_TEST_COUNTS['supabase/functions']` in each slice; final `deno check --frozen */index.ts`, `bun test`, Bruno for the changed functions

## Log

- L1: Maintainer, 2026-11-09: "si maser dale con el 274 y la protecion de main porfa."
- L2 (T1): #274 still holds at 02c4d002. The four listed tests still read source text: `stripe-webhooks/connect-payout-attach-adapter.test.ts:7` and `connect-payout-terminal-adapter.test.ts:8,24` read `index.ts`; `complete-delivered-shipments.test.ts` at 223, 237, 336, 373; `create-dispute.test.ts` moved to 161 and 174. No money function has a separate handler: each `index.ts` has an inline `Deno.serve` (`stripe-webhooks` 641, `complete-delivered-shipments` 37, `create-dispute` 32), and importing it starts a server. Pattern to copy: `envia-webhook/handler.ts` exports `createEnviaWebhookHandler(deps)`, tested under `bun:test` with plain async stubs. `SOURCE_TEXT_TEST_COUNTS['supabase/functions']` is 62. Slice order: adapters first (smallest seam, payout core), then `complete-delivered-shipments`, then `create-dispute`, then T5. The `stripe-webhooks` entrypoint, `create-connect-payment` and `release-connect-payout` handler extractions are larger and stay for a later decision.
- L3 (T2): `stripe-webhooks/connect-payout-adapters.ts` holds `attachConnectPayoutRunPayoutId`, `markConnectPayoutRunStatus`, `appendConnectPayoutEventEvidence` and `RECOVERABLE_MISSING_PAYOUT_ID_STATUSES`, moved unchanged (the removed `index.ts` lines match the module except imports). `connect-payout-adapters.test.ts`: 21 tests with a fake client; RED `Cannot find module './connect-payout-adapters.ts'`, then GREEN. Probe: removing `.is('stripe_payout_id', null)` fails the test at line 90. Two covered text assertions in `connect-payout-reconciliation.test.ts` dropped; its negative "no separate shipment or mapping write" scans of `index.ts` stay until T5 decides whether they are contracts. Count 62 to 60. Checks: `bun test supabase/functions/stripe-webhooks scripts/guards` 359 pass; `deno check --frozen` on both files; lint 0 errors; format and typecheck clean. Payments loop not run: the local stack was down and the Stripe CLI cannot trigger payout events (`odd/tasks/bruno-money-functions.md` L2). Slice boundary: T2 is one PR.
