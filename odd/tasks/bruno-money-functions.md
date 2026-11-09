# Bruno requests for the four uncovered money Edge Functions (#332)

Roadmap #335, item 1. Give `release-connect-payout`, `resume-pending-payouts`, `reconcile-stripe-fees` and `refresh-connect-account-status` Bruno requests on the local stack, and seed a paid shipment with a connected account so a release reaches the sandbox `payouts.retrieve` on that account.
Branch `test/bruno-money-functions`, worktree `School-portal-worktrees/bruno-money-functions`. Related: #274 (handler-level tests, not sandbox calls), #318.

## Specs

- S1 (#332, Expected): "A Bruno request per function on the local stack, and a seeded paid shipment with a connected account so a release reaches the sandbox `payouts.retrieve` on the connected account."
- S2 (#332): the call to prove is `payouts.retrieve` with `{ stripeAccount }` as options in `release-connect-payout/index.ts` (~line 370) and `stripe-webhooks/index.ts` (~line 620).
- S3 (root AGENTS.md): Bruno and `stripe:listen` only against the local stack; test scenarios created with the Stripe CLI, not the MCP; Bruno collection keeps passing.

## Tasks

- [x] T1 (S1-S3): explore and plan (L2)
- [ ] T2 (S1, S3): local-stack requests: auth, validation and empty-batch paths of the four functions, plus a seeded reconcile job without a charge (no Stripe call); one commit per function
- [ ] T3 (S1-S3): a persistent sandbox test connected account (charges and payouts enabled) created with the Stripe CLI; its id kept out of the repository
- [ ] T4 (S1, S2): sandbox scenarios: refresh with a real account, a release (transfer + payout), a failed payout and its retry reaching `payouts.retrieve` with `{ stripeAccount }`, reconcile with a real charge
- [ ] T5 (S1-S3): verification: `supabase db reset`, `functions:serve`, `bun run api:test`, payments loop

## Log

- L1: Maintainer, 2026-11-09, approving the order "#332 → CORS → API keys → #330 → #331" as roadmap #335: "Sí, ese orden y como roadmap". Earlier: "si me gusta lo que sigue me gustaria hacer todas."
- L2 (T1, explore): no sandbox connected account exists in the repository (`seed.sql` has the fake `acct_local_seller_pending`, onboarding `pending`). The release `payouts.retrieve(..., {}, { stripeAccount })` runs only on the retry branch (`retryRunId` of a failed run with a real failed payout); a fake payout id ends in 409 `PAYOUT_RETRY_EVIDENCE_UNAVAILABLE`. `reconcile-stripe-fees` has `verify_jwt = true`, so its worker bearer secret must be a valid JWT, and `bruno-env.ts` does not provide it. `refresh-connect-account-status` answers 200 `cached: true` when Stripe fails. Maintainer chose both parts: local requests now, then a persistent sandbox test connected account for the Stripe scenarios ("Las dos partes").
