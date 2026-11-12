# Test the remaining Edge Function wiring by calling the handlers (#278)

Roadmap #272, item 6. Every remaining `index.ts` serves a handler in one line, and the per-function source-text tests become handler calls or marked contracts.
Branch `test/edge-wiring-handlers` (one commit per slice, pushed as `<sha>:refs/heads/<slice-branch>`), worktree `School-portal-worktrees/repo-hygiene`. Method: `odd/tasks/money-edge-handlers.md` (#274). Out of investment: wallet (legacy, deleted) and dispute functions (rewritten in #261).

## Specs

- S1 (#278, Scope): "Make every remaining `index.ts` one line that serves its handler, and test the handlers by calling them."
- S2 (#278, Scope): "Replace the per-function entrypoint text checks with one general check, if that still holds."
- S3 (#278, Scope): "Drop the text assertions that behavior already covers. Mark the contracts."
- S4 (#278, Scope): "Lower the item 1 count. Split by function group if this item clearly exceeds one commit of about 400 lines."
- S5 (#278, Done when): "`deno check --frozen */index.ts`, `bun test`, and the Bruno requests for the changed functions pass."
- S6 (maintainer, L1): "lo de wallet y disputas es legacy o se rehace aparte en #261, así que no inviertas ahí"
- S7 (maintainer, L1): "Todo contra el stack local, PRs chicos, y vos encargate de los merge cuando el CI esté en verde. Si alguna migración entra a main, pedime luz verde para aplicarla."
- S8 (maintainer, L1): "fijate en supabase/functions/release-connect-payout/atomic-resume-wiring.test.ts, que quedó ahí para que este ítem lo reemplace."

## Tasks

- [x] T1 (S1-S8): re-check #278 and plan the slices (L2, L3)
- [ ] T2 (S2, S3, S4): mark the repository-wide checks in `_shared/__tests__` as contracts (`sentry-wiring`, `no-url-imports`, `no-legacy-wallet`, `sentry-sdk-install`, `types-import-contract`)
- [ ] T3 (S1, S3, S4, S5): functions that already have `handler.ts` (7 admin shipment handlers, `acknowledge-shipment-late-carrier-activity`, `account-closure-cleanup`, `delete-account`, `dispatch-push`): replace their `index.ts`/`handler.ts` text reads with handler calls or contracts
- [ ] T4 (S1, S3, S4, S5): non-money request handlers: `confirm-shipment-delivery`, `get-shipping-quote`, `resolve-shipment-tracking-url`, `track-shipments`
- [ ] T5 (S1, S3, S4, S5): Stripe account and payment-method handlers: `create-connect-account`, `manage-payment-methods`, `get-seller-onboarding`, `refresh-connect-account-status`, `connect-onboarding-return`
- [ ] T6 (S1, S3, S4, S5): money request handlers: `rollback-connect-payment`, `reconcile-connect-payments`, `create-return-intent`, `checkout-recovery-worker`
- [ ] T7 (S1, S3, S4, S5): `cancel-order` and `__tests__/shipment-cancel-safety-source-guards.test.ts`
- [ ] T8 (S1, S3, S4, S5): `auto-cancel-orders`, `auto-cancel-preparing` and the root `__tests__` cron cancellation and auto-cancel readers
- [ ] T9 (S1, S3, S4, S5): `generate-shipping-label`, `generate-return-label` and the root `__tests__` tracking contracts
- [ ] T10 (S1, S3, S4, S5): `create-connect-payment`
- [ ] T11 (S1, S3, S4, S5, S8): `release-connect-payout`; replace `atomic-resume-wiring.test.ts`
- [ ] T12 (S1, S3, S4, S5): `resume-pending-payouts`, `reconcile-stripe-fees`
- [ ] T13 (S1, S3, S4, S5): `stripe-webhooks` and `_shared/stripe/stripe-charge.test.ts`
- [ ] T14 (S3, S4, S6): dispute functions: mark their text checks as contracts, not migrate (`resolve-dispute`, `resolve-dispute-refund`, their rows in `auth-required-contract.test.ts`)
- [ ] T15 (S5): final `deno check --frozen */index.ts`, `bun test`, Bruno for the changed functions; close #278

## Log

- L1: Maintainer, 2026-11-11: "Seguimos en el worktree repo-hygiene con el roadmap #272, ítem 6: #278 (probar el cableado de las Edge Functions que quedan llamando a los handlers). Cargá de Engram plan/repo-hygiene-after-228, odd/remaining-sql-pgtap/tasks, odd/money-edge-handlers/tasks y el último resumen de sesión. Usá el método del ítem 2 (#274) y fijate en supabase/functions/release-connect-payout/atomic-resume-wiring.test.ts, que quedó ahí para que este ítem lo reemplace. Traé main y abrí una rama nueva. Antes de arrancar, revisá que #278 siga vigente y decime si cambió algo (ojo: la sesión de supabase-health está con #305 y cambió grants, y lo de wallet y disputas es legacy o se rehace aparte en #261, así que no inviertas ahí). Todo contra el stack local, PRs chicos, y vos encargate de los merge cuando el CI esté en verde. Si alguna migración entra a main, pedime luz verde para aplicarla. Cuando termines, decime qué sigue."
- L2 (T1): #278 still holds at `main` a74a33e5. `SOURCE_TEXT_TEST_COUNTS['supabase/functions']` is 58 (not 63 or 55: #303 moved five files in). 58 unmarked readers: 9 in root `__tests__`, 6 in `_shared`, 43 in function folders; 7 files already carry markers. The general entrypoint check exists (`_shared/__tests__/sentry-wiring.test.ts`, plus `cors-wiring.test.ts` from #336), so S2 holds. One-line serves already: `account-closure-cleanup`, `complete-delivered-shipments`, `create-dispute`, `cron-watchdog`, `delete-account`, `dispatch-push`, `envia-webhook` and the `serveAdminWeb` admin handlers. No `handler.ts` in about 25 folders, the largest `stripe-webhooks` (1099 lines), `auto-cancel-preparing` (665), `generate-shipping-label` (649), `release-connect-payout` (620), `create-connect-payment` (558), `auto-cancel-orders` (553), `reconcile-stripe-fees` (~540), `cancel-order` (445), `resume-pending-payouts` (409). The #305 branch `chore/explicit-grants-1-defaults` changes nothing under `supabase/functions`. No wallet function folder remains.
- L3 (T1): Maintainer chose the full scope (all large functions included, money ones one per PR): "Todo (recomendado)". Moving `index.ts` to `handler.ts` keeps git rename detection so the diff stays near the changed lines. Workers do not edit `scripts/guards/source-text-tests.ts`; the parent lowers the count per slice.
