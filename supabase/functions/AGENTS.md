# supabase/functions/AGENTS.md

Read the root `AGENTS.md` and `../AGENTS.md` first; they win over this file. Edge Functions run on Deno; shared pure helpers live in `_shared/`.

## Types and checks

- `bun run typecheck` does not cover Edge Functions: check one with `deno check supabase/functions/<name>/index.ts`. CI runs `deno check --frozen */index.ts` from `supabase/functions`, so every function must pass and `deno.lock` must be current (run `deno check` without `--frozen` to update it, and commit the lock).
- Deno resolves `npm:` imports from the root `node_modules`, so every `npm:<name>@<version>` an Edge Function uses must equal an exact root `devDependencies` pin; `scripts/guards/edge-function-npm-pins.test.ts` enforces it.
- An untyped `createClient` infers selected rows as `{}`; pass the generated `Database` type or declare a local row type.

## Sentry

- Wrap every handler: `serve(withSentry('<folder-name>', handler))` from `_shared/sentry.ts`. It reports thrown errors and 5xx responses only, never bodies, headers, URLs, or user data. Do not call the Sentry SDK directly.
- `cron-watchdog` checks every pg_cron job through `fn_cron_health()` and reports failed or overdue jobs; it is the only Sentry Cron Monitor the plan allows. A new cron job needs a schedule `cron-watchdog/health.ts` supports.
- `SENTRY_DSN` is a Supabase secret; locally it lives in `supabase/functions/.env` with `SENTRY_ENVIRONMENT=local`. Without a DSN the helper does nothing.

## Bruno collection

`bruno/` holds the HTTP requests (`.bru`) for the local stack of the current worktree. Run `bun run bruno:env` to generate the gitignored `bruno/.env` from `supabase status --env`, then `bun run api:test` to run everything (the `functions` folder needs `bun run functions:serve`, started right before the calls; it exits about 60 s after the last request, also under `supabase start --eager`). When you change an Edge Function, add or extend its request in `bruno/` and keep the whole collection passing. Do not use `--no-verify-jwt`: it turns gateway JWT verification off for every function until `supabase stop` and `supabase start`, and `bun run functions:serve` already honors each function's `verify_jwt` from `supabase/config.toml`. `bruno:env` refuses non-local URLs.

## Local payments loop

With the local Supabase stack running: `bun run functions:serve` (reads `supabase/functions/.env`, maintainer-owned and gitignored), then `bun run stripe:listen` to forward sandbox webhooks to the local `stripe-webhooks`, then `stripe trigger <event>`. `stripe:listen` (`scripts/dev/stripe-listen.ts`) reads the current worktree's API URL and refuses non-local targets. When `stripe-webhooks` handles a new event type, add it to `STRIPE_WEBHOOK_EVENTS` in that script and to `docs/go-live.md`; `scripts/dev/stripe-listen.test.ts` fails if those two differ, but nothing checks the handler itself (#257).

- Create test scenarios with the Stripe CLI, not through the MCP.
- Cross-check webhook events in the sandbox (Stripe MCP) with Edge Function logs (Supabase MCP).
