# supabase/functions/AGENTS.md

Read the root `AGENTS.md` and `../AGENTS.md` first; they win over this file. Edge Functions run on Deno; shared pure helpers live in `_shared/`.

## Types and checks

- `bun run typecheck` does not cover Edge Functions: check one with `deno check supabase/functions/<name>/index.ts`. Some functions have pre-existing Deno type errors; judge only new ones.
- Deno resolves `npm:` imports from the root `node_modules`, so every `npm:` package an Edge Function imports must also be an exact root dev dependency (as `zod`, `@sentry/deno`, and `@types/node` are).
- An untyped `createClient` infers selected rows as `{}`; pass the generated `Database` type or declare a local row type.

## Sentry

- Wrap every handler: `serve(withSentry('<folder-name>', handler))` from `_shared/sentry.ts`. It reports thrown errors and 5xx responses only, never bodies, headers, URLs, or user data. Do not call the Sentry SDK directly.
- `cron-watchdog` checks every pg_cron job through `fn_cron_health()` and reports failed or overdue jobs; it is the only Sentry Cron Monitor the plan allows. A new cron job needs a schedule `cron-watchdog/health.ts` supports.
- `SENTRY_DSN` is a Supabase secret; locally it lives in `supabase/functions/.env` with `SENTRY_ENVIRONMENT=local`. Without a DSN the helper does nothing.

## Bruno collection

`bruno/` holds the HTTP requests (`.bru`) for the local stack of the current worktree. Run `bun run bruno:env` to generate the gitignored `bruno/.env` from `supabase status --env`, then `bun run api:test` to run everything (the `functions` folder needs `supabase functions serve --no-verify-jwt --env-file supabase/functions/.env`). `bruno:env` refuses non-local URLs.

## Local payments loop

With the local Supabase stack running: `bun run functions:serve` (reads `supabase/functions/.env`, maintainer-owned and gitignored), then `bun run stripe:listen` to forward sandbox webhooks to the local `stripe-webhooks`, then `stripe trigger <event>`. `stripe:listen` (`scripts/stripe-listen.ts`) reads the current worktree's API URL and refuses non-local targets. When `stripe-webhooks` handles a new event type, add it to `STRIPE_WEBHOOK_EVENTS` in that script and to `docs/go-live.md`.

- Create test scenarios with the Stripe CLI, not through the MCP.
- Cross-check webhook events in the sandbox (Stripe MCP) with Edge Function logs (Supabase MCP).
