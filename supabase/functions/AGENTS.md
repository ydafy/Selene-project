# supabase/functions/AGENTS.md

Read the root `AGENTS.md` and `../AGENTS.md` first; they win over this file. Edge Functions run on Deno.

## Shared modules

Code that two or more functions use lives in `_shared/`, grouped by topic: `_shared/auth/`, `_shared/auto-cancel/`, `_shared/cancellation/`, `_shared/envia/`, and `_shared/stripe/`. `_shared/sentry.ts`, `_shared/zod-runtime.ts`, `_shared/supabase-js.ts`, `_shared/supabase-secret-key.ts`, and `_shared/account-closure-cleanup.ts` stay directly in `_shared/`. Import a third-party package through its one shared re-export (`_shared/zod-runtime.ts`, `_shared/supabase-js.ts`, `_shared/stripe/sdk.ts`), so a version bump edits one specifier plus the root pin. `STRIPE_API_VERSION` lives in `_shared/stripe/api-version.ts` and moves with the Stripe SDK pin (`docs/dependencies.md`, "Keep the Stripe SDK and API version together"). A module's tests sit next to it; `_shared/__tests__/` holds only the guards that scan every function and the zod preload. Move files with `scripts/dev/move-files.ts`, which rewrites the imports; it does not rewrite path strings inside `toContain` assertions, so fix those by hand.

## CORS

`_shared/cors.ts` is the only CORS policy. A function the admin-web calls from the browser serves with `serveAdminWeb(withSentry('<folder-name>', handler))` instead of `Deno.serve`; every other function (native app, cron, webhooks, redirects) sets no CORS header and has no `OPTIONS` branch. The allowed origins come from the `ADMIN_WEB_ORIGINS` secret, a comma-separated list of exact origins; a missing or invalid list allows none. Production sets the deployed admin-web origin (`docs/go-live.md`, "6. Edge Function secrets"); locally, set `ADMIN_WEB_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5188` in `supabase/functions/.env`. The local stack's gateway answers every preflight itself and sends `Access-Control-Allow-Origin: *` on every function response (#377), so Bruno and `test:e2e:local` never exercise this policy: `_shared/cors.test.ts` and the guard below do, and after a deploy an `OPTIONS` request with the admin-web `Origin` must return that origin in `Access-Control-Allow-Origin`. The Expo web build (`expo start --web`) is not an allowed origin. `_shared/__tests__/cors-wiring.test.ts` fails when a function the admin-web names does not use `serveAdminWeb`, when another function does, or when any other file sets an `Access-Control-*` header. CORS only decides whether a page may read the response: each function still authenticates and authorizes its caller.

## Authentication

Every function runs with `verify_jwt = false` in `supabase/config.toml` and authenticates its caller in code: a user or admin access token through `auth.getUser`, a cron secret, or a webhook signature. The gateway check only understands the legacy JWT keys, so it must be off before the project rotates to asymmetric JWT signing keys (#337). A call without a valid token reaches the function, so it must answer 401 before any database, Stripe, or Envia call. `_shared/__tests__/auth-in-code.test.ts` fails when a function lacks its `verify_jwt = false` entry or its classified mechanism; classify a new function there, with a reason for a public one.

A privileged client uses the `default` secret key from `SUPABASE_SECRET_KEYS`, read only through `readSupabaseSecretKey()` in `_shared/supabase-secret-key.ts`, which returns `undefined` for a missing or malformed key so the function answers its usual 500. Never read `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`. Reach Supabase through supabase-js: it sends the key on `apikey` (and, by default, also as a bearer token, which the API gateway accepts). A secret key is not a JWT, so never hand-build a request that sends it as `Authorization: Bearer` to an Edge Function, which rejects it as `Invalid JWT`. `_shared/__tests__/secret-key-env.test.ts` enforces the reads and that every client takes its key from `readSupabaseSecretKey()`.

## Cron functions

A cron-invoked function runs with `verify_jwt = false` in `supabase/config.toml` and authenticates only the `x-cron-secret` header against `CRON_SECRET` through `_shared/auth/cron-auth.ts` (`isAuthorizedCronRequest`, plus `reportCronSecretMismatch` before the 401); `track-shipments` is the one exception, with its own Bearer secret. Its cron job sends no Supabase API key or JWT (`docs/go-live.md`, "8. Cron jobs"). `_shared/__tests__/cron-verify-jwt.test.ts` fails when a function that checks a cron secret lacks `verify_jwt = false`, and `supabase/tests/database/cron_jobs.test.sql` fails when a cron job sends a Supabase API key or JWT.

## Types and checks

- `bun run typecheck` does not cover Edge Functions: check one with `deno check supabase/functions/<name>/index.ts`. CI runs `deno check --frozen */index.ts` from `supabase/functions`, so every function must pass and `deno.lock` must be current (run `deno check` without `--frozen` to update it, and commit the lock).
- Deno resolves `npm:` imports from the root `node_modules`, so every `npm:<name>@<version>` an Edge Function uses must equal an exact root `devDependencies` pin; `scripts/guards/edge-function-npm-pins.test.ts` enforces it.
- An untyped `createClient` infers selected rows as `{}`; pass the generated `Database` type or declare a local row type.

## Sentry

- Wrap every handler: `Deno.serve(withSentry('<folder-name>', handler))` from `_shared/sentry.ts`. It reports thrown errors and 5xx responses only, never bodies, headers, URLs, or user data. Do not call the Sentry SDK directly.
- `cron-watchdog` checks every pg_cron job through `fn_cron_health()` and reports failed or overdue jobs; it is the only Sentry Cron Monitor the plan allows. A cron job is declared in `supabase/schemas/_cluster/misc.sql` and needs a schedule `cron-watchdog/health.ts` supports; `scripts/guards/cron-jobs.ts` checks it.
- `SENTRY_DSN` is a Supabase secret; locally it lives in `supabase/functions/.env` with `SENTRY_ENVIRONMENT=local`. Without a DSN the helper does nothing.

## Deploy and drift check

Deploy Edge Functions only from `main`, never from a worktree or an unmerged branch: the deployed code must match the repository. The maintainer deploys (root `AGENTS.md`, "Never").

Check the remote against the repository through the Supabase MCP (read-only):

1. `list_edge_functions`: the slugs must be exactly the directories in `supabase/functions/` except `_shared/` and `__tests__/`, and each `verify_jwt` must match `supabase/config.toml` (a function missing there has `verify_jwt = true`).
2. `execute_sql` with `select jobname, schedule, active from cron.job order by jobname`: the names and schedules must match the jobs in `supabase/schemas/_cluster/misc.sql`, and every job is active.

Classify a difference as `../AGENTS.md`, "Schema drift check", step 3, describes.

## Bruno collection

`bruno/` holds the HTTP requests (`.bru`) for the local stack of the current worktree. Run `bun run bruno:env` to generate the gitignored `bruno/.env` from `supabase status --env`, then `bun run api:test` to run everything (the `functions` folder needs `bun run functions:serve`, started right before the calls; it exits about 60 s after the last request, also under `supabase start --eager`). When you change an Edge Function, add or extend its request in `bruno/` and keep the whole collection passing. Do not use `--no-verify-jwt`: it turns gateway JWT verification off for every function until `supabase stop` and `supabase start`, and `bun run functions:serve` already honors each function's `verify_jwt` from `supabase/config.toml`. `bruno:env` refuses non-local URLs.

`bruno/stripe-sandbox/` drives `refresh-connect-account-status`, `release-connect-payout` (a release, a failed payout and its retry) and `reconcile-stripe-fees` against the Stripe sandbox through the persistent test connected account. Each run creates its own charges (`pm_card_bypassPending`) and a failing CLABE, and restores the account's default bank account at the end. The folder is opt-in: its requests are skipped unless the run sets `BRUNO_STRIPE_SANDBOX=1` and `supabase/functions/.env` has `BRUNO_STRIPE_TEST_ACCOUNT_ID` and `STRIPE_SECRET_KEY` (`bruno:env` copies both and refuses a key that does not start with `sk_test_` or `rk_test_`). Run it when a change touches a release, payout, refund or fee path: start `bun run stripe:listen`, then `BRUNO_STRIPE_SANDBOX=1 bun run api:test`. The payout and account webhooks must reach the local `stripe-webhooks`, or the folder fails after waiting about a minute.

## Local payments loop

With the local Supabase stack running: `bun run functions:serve` (reads `supabase/functions/.env`, maintainer-owned and gitignored), then `bun run stripe:listen` to forward sandbox webhooks to the local `stripe-webhooks`, then `stripe trigger <event>`. `stripe:listen` (`scripts/dev/stripe-listen.ts`) reads the current worktree's API URL and refuses non-local targets. When `stripe-webhooks` handles a new event type, add it to `STRIPE_WEBHOOK_EVENTS` in that script and to `docs/go-live.md`; `scripts/dev/stripe-listen.test.ts` fails if those two differ, but nothing checks the handler itself (#257).

- `stripe:listen` forwards events in the sandbox account's default API version, which must equal `STRIPE_API_VERSION`. Raise it in the Stripe Dashboard on each new API major (`docs/dependencies.md`, "Keep the Stripe SDK and API version together"). Do not add `--latest`. `stripe-webhooks` reports an event from another release line to Sentry and still processes it.
- Create test scenarios with the Stripe CLI, not through the MCP.
- Cross-check webhook events in the sandbox (Stripe MCP) with Edge Function logs (Supabase MCP).
