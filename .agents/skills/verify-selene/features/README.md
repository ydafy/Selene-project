# Selene verification map

Maintained source for what to drive and how on the local stack. Read the index, then the matching feature file. Procedure (launch, doctor, evidence, cleanup) is in `../SKILL.md`; which proof a change needs is in `AGENTS.md`, "Verifying a change".

## Baseline preconditions

- Local stack running for this worktree (`supabase start`), seeded by `supabase db reset`; `bruno/.env` written by `bun run bruno:env`.
- Seeded accounts at `@selene.local`, password `password123`: `admin`, `seller`, `buyer`, `fixture-seller`, `fixture-buyer`. Listings `...0b1` to `...0b7` are in `supabase/seed.sql`.
- Run a Bruno request together with the login request that sets its token (`auth/login-*.bru`, `functions/login-admin.bru`) in one invocation.
- Never point any command here at the remote project.

## Features

- [Admin refund problems](./admin-refund-problems.md): admin "Necesita atención" > "Reembolsos" list and resolve. Browser spec plus Bruno role checks. Proven.
- [Checkout and Stripe webhooks](./checkout-and-webhooks.md): `create-connect-payment` guards, recovery lease, webhook signature, Stripe CLI loop.
- [Product verification](./product-verification.md): public visibility by verification state, proof storage, admin queue, per-role access.
- [Account closure](./account-closure.md): `delete-account`, `fn_close_account`, cleanup worker.
