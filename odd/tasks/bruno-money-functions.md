# Bruno requests for the four uncovered money Edge Functions (#332)

Roadmap #335, item 1. Give `release-connect-payout`, `resume-pending-payouts`, `reconcile-stripe-fees` and `refresh-connect-account-status` Bruno requests on the local stack, and seed a paid shipment with a connected account so a release reaches the sandbox `payouts.retrieve` on that account.
Branch `test/bruno-money-functions`, worktree `School-portal-worktrees/bruno-money-functions`. Related: #274 (handler-level tests, not sandbox calls), #318.

## Specs

- S1 (#332, Expected): "A Bruno request per function on the local stack, and a seeded paid shipment with a connected account so a release reaches the sandbox `payouts.retrieve` on the connected account."
- S2 (#332): the call to prove is `payouts.retrieve` with `{ stripeAccount }` as options in `release-connect-payout/index.ts` (~line 370) and `stripe-webhooks/index.ts` (~line 620).
- S3 (root AGENTS.md): Bruno and `stripe:listen` only against the local stack; test scenarios created with the Stripe CLI, not the MCP; Bruno collection keeps passing.

## Tasks

- [x] T1 (S1-S3): explore and plan (L2)
- [x] T2 (S1, S3): local-stack requests: auth, validation and empty-batch paths of the four functions, plus a seeded reconcile job without a charge (no Stripe call); one commit per function (ebd2addf, 4bc8d1b3, 09f4cbe1, 13ea17ec, 48213a11, 71498cc9)
- [ ] T3 (S1-S3): a persistent sandbox test connected account (charges and payouts enabled) created with the Stripe CLI; its id kept out of the repository
- [ ] T4 (S1, S2): sandbox scenarios: refresh with a real account, a release (transfer + payout), a failed payout and its retry reaching `payouts.retrieve` with `{ stripeAccount }`, reconcile with a real charge
- [ ] T5 (S1-S3): verification: `supabase db reset`, `functions:serve`, `bun run api:test`, payments loop

## Log

- L1: Maintainer, 2026-11-09, approving the order "#332 → CORS → API keys → #330 → #331" as roadmap #335: "Sí, ese orden y como roadmap". Earlier: "si me gusta lo que sigue me gustaria hacer todas."
- L2 (T1, explore): no sandbox connected account exists in the repository (`seed.sql` has the fake `acct_local_seller_pending`, onboarding `pending`). The release `payouts.retrieve(..., {}, { stripeAccount })` runs only on the retry branch (`retryRunId` of a failed run with a real failed payout); a fake payout id ends in 409 `PAYOUT_RETRY_EVIDENCE_UNAVAILABLE`. `reconcile-stripe-fees` has `verify_jwt = true`, so its worker bearer secret must be a valid JWT, and `bruno-env.ts` does not provide it. `refresh-connect-account-status` answers 200 `cached: true` when Stripe fails. Maintainer chose both parts: local requests now, then a persistent sandbox test connected account for the Stripe scenarios ("Las dos partes").
- L3 (T2, local requests): 22 requests in `bruno/functions/`, seq 123-144, none calls Stripe. `release-connect-payout`: no token 401 `AUTH_REQUIRED`; buyer 403 `ADMIN_REQUIRED` (the body is parsed before the role check, so it sends a valid body); admin `{}` 400 `SELLER_ID_REQUIRED`; unknown shipment 400 `SHIPMENT_NOT_FOUND`; unknown `retryRunId` 404 `PAYOUT_RETRY_PARENT_NOT_FOUND`; a service-role read shows no `connect_payout_runs` row was written. `resume-pending-payouts`: no or wrong secret 401 `CRON_UNAUTHORIZED`; cron secret 200 with every counter 0 and `results: []`. `reconcile-stripe-fees`: no header 401 from the gateway (`UNAUTHORIZED_NO_AUTH_HEADER`); the anon key passes the gateway and the handler answers 401 `Unauthorized`; with the worker secret, an empty batch, then a seeded job on order `f0` (no `stripe_charge_id`) gives `retryScheduled: 1`, the row returns to `pending` with attempt 1, `STRIPE_FEE_UNAVAILABLE` and a future `next_retry_at`, then cleanup deletes it. `refresh-connect-account-status`: no token 401 `AUTH_REQUIRED`; a throwaway user 404 `CONNECT_ACCOUNT_NOT_FOUND`; the buyer with the seller's `sellerId` 403 `FORBIDDEN`; the throwaway user is deleted. `bun run bruno:env` now copies `STRIPE_FEE_RECONCILIATION_WORKER_SECRET` from the functions env file and names it when missing. Gap: the local functions env file lacks that secret, so the three worker-secret requests fail (401) until the maintainer adds it; `bun run api:test` after `supabase db reset`: 650 requests, 647 passed, those 3 failed.
- L4 (T2): the maintainer added `STRIPE_FEE_RECONCILIATION_WORKER_SECRET` (the local stack's legacy `SERVICE_ROLE_KEY`, a JWT because the function has `verify_jwt = true`) to both `supabase/functions/.env` files and to `.env.example` with a placeholder. After `bun run bruno:env` and `supabase db reset`, `bun run api:test`: 650/650 requests, 662/662 tests, including the 7 `reconcile-stripe-fees` requests. Slice boundary: T2 is complete and verified on its own (about 820 lines, mostly `.bru` files).
