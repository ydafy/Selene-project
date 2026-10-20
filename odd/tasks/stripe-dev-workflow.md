# Stripe development workflow

Give agents read-only visibility into the Stripe sandbox and a local payments loop (Stripe CLI webhooks into the local Supabase stack), mirroring the Supabase workflow.
Stripe live mode is never connected to agents.

## Specs

- S1: "quiero lo mismo pero como usamos stripe, actualmente todo lo que pase en stripe dahbord pues solo yo te comunico tu no tienes como una manera de ver cosas ahi" — agents read the Stripe sandbox through the official Stripe MCP, read-only, without stored keys.
- S2: "es una manera mas ordenada y profesional y nos evita issues" — payments can be exercised locally: Stripe CLI forwards sandbox webhooks to the local Edge Functions.
- S3: "va por pasos, recuerda commits acotados" — delivered in small steps with scoped commits.

## Tasks

- [x] T1 (S1): Stripe MCP in `~/.gentle-shell/agent/mcp.json`, OAuth, sandbox only, write and money-moving tools hidden; maintainer signs in; verify with a read. User-level config, no repo commit.
- [x] T2 (S1): `AGENTS.md` rule for Stripe inspection.
- [x] T3 (S2): Stripe CLI installed; `supabase functions serve` + `stripe listen` loop documented and verified with a triggered event.
- [x] T4 (S2): `docs/go-live.md` updates for live keys and webhook endpoints.

## Log

- L1: "Y prgeunta, como usamos stripe, ahi pasa algo similar, ae algun mcp o config que podamos ahcer para que sea mas facil ver mi stripe? osea literal lo mismo que hicimos con supabse, es una manera mas ordenada y profesional y nos evita issues, quierro lo mismo pero como usamos stripe, actualmente todo lo que pase en stripe dahbord pues solo yo te comunico tu no tienes como una manera de ver cosas ahi, auqneu digo, suapbase y las edge fcutions aveces traen logs pero sabes a lo que me refiero, dime que opinas?"
- L2: Plan approved: MCP first (OAuth, sandbox, read-only), then local loop, then docs. "va por pasos, recuerda commits acotados".
- L3: Stripe CLI not installed. `supabase/functions/.env` is gitignored; gentle-shell blocks agent writes to `.env*`, so the maintainer creates it. Stripe MCP stops accepting non-agent API keys on 2026-11-30; OAuth avoids keys. OAuth does not cover connected accounts.
- L4: Maintainer authorized OAuth for the sandbox only, with read and write scopes. Agent-side `mcp.json` still hides `stripe_api_write`, `manage_stripe_accounts`, Treasury and Atlas tools. Verified: `list_available_accounts_or_orgs` returns only `acct_1SswKSACloWdhaxv` (Selene sandbox, livemode false); read of payment intents and balance succeeded.
- L5: Stripe CLI 1.54.1 installed (scoop), logged in to Selene sandbox. Added `functions:serve` and `stripe:listen` scripts (CLI 1.54 requires `--events`; list taken from events handled by `stripe-webhooks`). Verified: `stripe trigger payment_intent.payment_failed` forwarded to local `stripe-webhooks` -> HTTP 200; request without signature -> 400. Secrets live in maintainer-owned `supabase/functions/.env` (gitignored).
- L6: Finding for security block B (not fixed here): a forged `stripe-signature` returns 500 and stores the unauthenticated payload in `webhook_dlq`. Invalid signatures should return 400 without persisting the body.
- L7: Fixed L6. `stripe-webhooks` verifies the signature (new pure `signature.ts`, platform then Connect secret, empty secrets skipped) before any Supabase client or DLQ write: invalid -> 400, no secret configured -> 500, both without persisting the body. RED (missing helper) -> GREEN 202 tests. Local e2e: forged -> 400 with webhook_dlq count unchanged, missing -> 400, real triggered event -> 200. Independent verify: PASS WITH WARNINGS (invalid signature now logged at ERROR; `deno check` unavailable in repo, fails identically before/after). Deploy `stripe-webhooks` to apply remotely.
