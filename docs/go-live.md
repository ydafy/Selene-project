# Go-live runbook

How to build the production Supabase project from this repository. Keep this file current: whenever a change adds a secret, bucket, webhook, or Dashboard setting, add it here in the same commit. Cron jobs are declared in `supabase/schemas/_cluster/misc.sql` (section 8); a new job's Vault secret goes in section 5.

Inventory below was read from project `acoiclkeymgtlwcxilun` through the read-only Supabase MCP on 2026-10-18.

## Status

The repository rebuilds the database schema: its migrations start with the baseline `supabase/migrations/20261020100000_remote_schema_baseline.sql`, verified on 2026-10-20 to match the development project (functions, policies, triggers, columns, indexes, constraints, enums, views and grants). Pre-baseline history lives in `supabase/migrations/archive/` and is never applied.

Open launch dependencies:

- Fee-free period for launch sellers (#64). The commission (`system_settings.service_fee_pct`) is global and frozen into each product at publication, so the app cannot waive it for invited sellers' first sales. Do not set the global rate to 0 as a workaround: every product published while it is 0 keeps 0 permanently.

## 1. Project

1. Choose the plan before the first real payment. Recommended: Pro (about USD 25 a month). Free runs the app, but it has no downloadable backups, pauses a project after a week without activity, does not offer leaked password protection, and its database and Storage quotas are small for dispute videos (current limits: https://supabase.com/pricing). Launching on Free is acceptable only with a daily off-site database backup in place (`supabase db dump` on a schedule, stored outside Supabase; it does not cover Storage files) and someone watching the quotas. Upgrade to Pro at the first of: real payments flowing every week, the database or Storage near its quota, or any data incident. Point-in-time recovery (add-on, about USD 100 a month) can wait until there is real volume. Decided with the maintainer on 2026-11-08.
2. Create the project in the target region and organization.
3. Record the new project ref and update the Supabase MCP URL.
4. Use the new API keys from day one: `sb_publishable_...` in the apps (`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the EAS environments, `VITE_SUPABASE_PUBLISHABLE_KEY` in the admin-web build env) and `sb_secret_...` in server components, and keep the legacy `anon`/`service_role` JWT keys disabled. The legacy `service_role` key of the development project was exposed on 2026-10-19 (it was embedded in a Dashboard-created trigger); never reuse it or copy any key from that project.
5. Decide whether migrations deploy through the Supabase GitHub integration (applies pending `supabase/migrations/` on every push to the production branch). It was connected to the development project on 2026-10-21 and disconnected the same day: its first run failed with `column "refund_id" ... already exists` because two migrations had been applied by hand and were missing from the remote history (nothing was applied). Enable it only on a project whose migration history matches the repository, and only once every branch that pushes to `main` is meant to reach production; then update the "The repository does not deploy itself" rule in `AGENTS.md`.

### Moving an existing project to the new API keys

Supabase retires the legacy `anon` and `service_role` keys and the legacy JWT secret at the end of 2026. Move a project in this order; the development project finished every step on 2026-11-12 (#337):

1. Create a publishable key and a secret key (Settings > API Keys). Done.
2. Edge Functions on `SUPABASE_SECRET_KEYS`. Done (#398).
3. Cron jobs without Supabase keys. Done (#397, section 8).
4. `verify_jwt = false` for every function. Done (#399).
5. Set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key in the local `.env` files, the EAS environment variables, and the deployed admin-web's build env. The apps no longer read `EXPO_PUBLIC_SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`, and fail at startup without the new name.
6. Rebuild and install the app, and redeploy the admin-web. An installed development build still carries the anon key and stops working once step 8 disables it.
7. In Settings > API Keys, check the "last used" time of the legacy keys: nothing should have used them since steps 5 and 6.
8. Disable the legacy API keys (Settings > API Keys). It is reversible: re-enable them if a client breaks.
9. JWT signing keys (Settings > JWT Keys): run "Migrate JWT secret", which imports the legacy secret and creates an ES256 standby key, then "Rotate keys".
10. Wait at least the access-token expiry plus 15 minutes (1 h 15 min with the default 1 h expiry), so no valid token is signed with the legacy secret.
11. Revoke the legacy JWT secret. It must come after step 8: revoking it while the legacy API keys are enabled breaks them (https://supabase.com/docs/guides/auth/signing-keys).

### Domain

Selene has no domain yet. Code uses the placeholder `selene.example` (`.example` is reserved by RFC 2606 and never resolves) from one constant: `SELENE_DOMAIN` in `packages/types/src/domain.ts` (`SELENE_WEB_URL` derives from it). The same file holds `SELENE_SUPPORT_EMAIL` (`soporte@<domain>`), `ACCOUNT_DELETION_PATH` (`/eliminar-cuenta`), `PRIVACY_PATH` (`/privacidad`), `TERMS_PATH` (`/terminos`) and the derived `ACCOUNT_DELETION_URL`, `PRIVACY_URL` and `TERMS_URL`. The mobile app's terms and privacy links (Settings > Legales and the register terms link) read `TERMS_URL` and `PRIVACY_URL` directly; no env var overrides them. Several modules need the domain; any new code that needs it imports that constant instead of writing a domain.

When the real domain is registered:

1. Change `SELENE_DOMAIN` in `packages/types/src/domain.ts` and update its test.
2. Settings outside code, which do not read the constant: custom SMTP sender and DNS records (section 10), Auth Site URL and redirect URLs (section 10), and any public page URL registered in the app stores (Google Play account deletion).

## 2. Extensions

`pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `supabase_vault`, `wrappers`, `pg_stat_statements`, `hypopg`, `index_advisor`.

Never store secrets in schema objects (trigger arguments, foreign server options, function bodies). They appear in every schema dump. Read them from Vault at runtime.

Install `pg_net` in the `extensions` schema, not `public` (security advisor `extension_in_public`).

## 3. Database

1. Link the new project. Before the first `supabase db push`, create the Vault secrets (section 5), set the Edge Function secrets (section 6), and deploy the functions (section 7): the push also creates the cron jobs (section 8), which read Vault by name and call the functions. Then run `supabase db push`. It applies the baseline and every later migration in version order and records them in the remote migration history.
2. Run `get_advisors` (security and performance) and resolve new findings.
3. Run the schema drift check (`supabase/AGENTS.md`, "Schema drift check"). The types need no step: `bun run db:types` generates them from the local database, and CI checks them against the migrations.

## 4. Storage buckets

| Bucket         | Public | Size limit | Allowed types                                    |
| -------------- | ------ | ---------- | ------------------------------------------------ |
| `Avatars`      | yes    | 2 MiB      | JPEG, PNG, WebP, HEIC, HEIF                      |
| `products`     | yes    | 10 MiB     | JPEG, PNG, WebP, HEIC, HEIF                      |
| `evidence`     | no     | 50 MiB     | JPEG, PNG, WebP, HEIC, HEIF, MP4, QuickTime, M4V |
| `verification` | no     | none       | any                                              |

Bucket settings and policies on `storage.objects` come from migrations (`supabase/migrations/20261109020901_storage_bucket_access.sql` sets the limits above).

## 5. Vault secrets

The cron jobs in `supabase/schemas/_cluster/misc.sql` read these names on every run, so create all of them before `supabase db push` creates the jobs (section 8). A job whose secret is missing fails or gets 401 on every run. Create each one in the SQL Editor with `select vault.create_secret('<value>', '<name>');`. Values differ per project; never copy them from another environment.

| Name                                       | Value                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `project_url`                              | The project URL, `https://<project-ref>.supabase.co`, with no trailing slash                   |
| `account_closure_cleanup_cron_secret`      | Same value as the `CRON_SECRET` function secret                                                |
| `auto_cancel_orders_cron_secret`           | Same value as `CRON_SECRET` (sent by `auto-cancel-orders-job` and `auto-cancel-preparing-job`) |
| `complete_delivered_shipments_cron_secret` | Same value as `CRON_SECRET`                                                                    |
| `cron_watchdog_cron_secret`                | Same value as `CRON_SECRET`                                                                    |
| `dispatch_push_cron_secret`                | Same value as `CRON_SECRET`                                                                    |
| `resume_pending_payouts_cron_secret`       | Same value as `CRON_SECRET`                                                                    |
| `checkout_recovery_worker_cron_secret`     | Same value as `CRON_SECRET`                                                                    |
| `reconcile_stripe_fees_cron_secret`        | Same value as `CRON_SECRET`                                                                    |
| `track_shipments_cron_secret`              | Same value as the `TRACK_SHIPMENTS_CRON_SECRET` function secret                                |

The development project's service-role JWT was once stored in `cron.job` (the retired `track-shipments-every-6-hours` job sent it), where anyone with database owner access could read it. It was replaced, not revoked. Revoking it is part of moving to Supabase's per-key API keys before go-live (section 1, step 4). No cron job sends a Supabase API key or JWT, so Vault holds no anon or service-role value.

## 6. Edge Function secrets

`CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `ENVIA_MODE`, `ENVIA_API_KEY_PROD`, `ENVIA_API_URL_PROD`, `ENVIA_WEBHOOK_SECRET_PROD`, `ENVIA_API_KEY_SANDBOX`, `ENVIA_API_URL_SANDBOX`, `ENVIA_WEBHOOK_SECRET_SANDBOX`, `SENTRY_DSN` (required; without it Sentry reporting and the `cron-watchdog` monitor are silently off), `SENTRY_ENVIRONMENT` (optional, default `production`). `TRACK_SHIPMENTS_CRON_SECRET` and `TRACK_SHIPMENTS_POLLING_ENABLED` (`true` turns Envia polling on; see "8. Cron jobs"). `EXPO_ACCESS_TOKEN` (required by `dispatch-push`; see "7. Edge Functions").

`ADMIN_WEB_ORIGINS` (required by the functions the admin-web calls): the comma-separated exact origins of the deployed admin-web, with scheme and no trailing slash or path (`https://<admin-web host>`). Without it those functions send no CORS headers and every admin-web screen that calls them fails in the browser. Set it before deploying a function that uses `serveAdminWeb` (`supabase/functions/AGENTS.md`, "CORS"), and never add `localhost` origins in production.

`SUPABASE_URL` and `SUPABASE_SECRET_KEYS` are injected by Supabase. The functions build their privileged client with the `default` secret key from `SUPABASE_SECRET_KEYS` and never read the legacy `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`. Supabase injects `SUPABASE_SECRET_KEYS` only once the project has publishable and secret keys, so create them (step 1.4) before deploying the functions; without them every function that needs the database answers 500.

Production uses live Stripe keys and `ENVIA_MODE` set to production.

## 7. Edge Functions

Deploy only from a checkout of `main`, never from a worktree or an unmerged branch: the deployed code must match the repository. The deployed set must be exactly the directories in `supabase/functions/`, except `supabase/functions/_shared/` and `supabase/functions/__tests__/`. Every function is deployed with `verify_jwt = false` from `supabase/config.toml` and authenticates its caller in code (#399); deploy with the CLI so the flags apply. `supabase/functions/AGENTS.md`, "Deploy and drift check", compares the deployed set with the repository.

`create-payment-intent` was retired (replaced by `create-connect-payment`; it no longer exists in the repository). Its deployed copy was deleted from the development project on 2026-10-25, so a project still listing it is out of date: remove it with `supabase functions delete create-payment-intent`.

`track-returns` and `return-delivery-timeout` were removed from the repository: no cron job or client called them, and the `return-delivery-timeout` cron job runs `fn_cron_return_delivery_timeout()` directly. Return tracking is rebuilt in #266. A project still listing either function is out of date: remove them with `supabase functions delete track-returns` and `supabase functions delete return-delivery-timeout`.

`resolve-shipment-refund` is called by admins with their own session: it verifies the session with `auth.getUser` and checks `profiles_private.role = 'admin'` itself. It needs no new secret. Apply `supabase/migrations/20261022013846_shipment_cancellation_refund_resolution.sql` (new resolution columns, service-only `fn_resolve_shipment_cancellation_refund`, `fn_cancel_shipment` accepting an admin-resolved refund) before deploying it.

`list-shipment-refund-problems` is the admin read of unresolved refund problems (GET, returns `{ problems }`). Like `resolve-shipment-refund` it verifies the session and checks `profiles_private.role = 'admin'` itself. It needs no new secret. Apply `supabase/migrations/20261022223302_shipment_refund_problems.sql` (service-only `fn_list_shipment_refund_problems`) before deploying it.

`delete-account` closes an account in one SQL transaction (`fn_close_account`) and then removes the Stripe customer, the Stripe Connect account and Storage files. `account-closure-cleanup` is its cron retry for closures whose cleanup failed or never ran: it runs without a user session, is authenticated by the `x-cron-secret` header against `CRON_SECRET`, and keeps `verify_jwt = false` (declared in `supabase/config.toml`). Apply `supabase/migrations/20261023043220_account_closure.sql` and then `supabase/migrations/20261023052842_account_closure_cleanup.sql` (service-only `fn_claim_account_closures` and `fn_record_closure_attempt`), then deploy both functions. The retry stops after 24 attempts per closure and lists those closures in its response and in an `ERROR` log (`Account closure cleanup gave up`, with the user ids) on every run; an admin reads `internal.account_closures.last_error` (SQL editor; the table is not exposed through the Data API) for those users and finishes the failed step by hand. Apply `supabase/migrations/20261023043220_account_closure.sql` before shipping a mobile build from this change: the app selects `profiles.deleted_at` in its order and review queries, which fail on a database without that column.

`dispatch-push` delivers queued push notifications through the Expo Push API every minute: it claims up to 5 batches of 100 rows from `push_deliveries`, sends each batch right after its claim, records the tickets, checks receipts 15 minutes after sending (a `DeviceNotRegistered` receipt disables the token) and deletes finished rows older than 30 days. It is authenticated by the `x-cron-secret` header against `CRON_SECRET` and keeps `verify_jwt = false` (declared in `supabase/config.toml`). It needs the function secret `EXPO_ACCESS_TOKEN`; without it every run answers 500 `MISSING_SERVER_CONFIG` and claims nothing. Create an access token on expo.dev (https://expo.dev/settings/access-tokens) with the account that owns the project, set it with `supabase secrets set EXPO_ACCESS_TOKEN=<value>`, then turn on "Enhanced Security for Push Notifications" on the same Access tokens page of the account settings (not the project settings), so Expo rejects a push request without the token with `UNAUTHORIZED`. Give the production project its own token: the development token sits in `supabase/functions/.env` of every worktree, and revoking it after a leak must not stop production pushes. Do these steps in this order before the `supabase db push` that creates `dispatch-push-every-minute` (section 8): set `EXPO_ACCESS_TOKEN`, create the Vault secret `dispatch_push_cron_secret` (section 5), and deploy `dispatch-push`. The function's tables come from `supabase/migrations/20261030014104_push_outbox.sql` and `supabase/migrations/20261030025554_push_receipts_and_purge.sql`. Nothing calls the function before its cron job exists, so deploying it before the push that applies them is safe. Expo credential errors (`InvalidCredentials`, `MismatchSenderId`, `UNAUTHORIZED`) are reported to Sentry.

`list-shipment-operation-reviews` and `resolve-shipment-operation-review` serve the admin "Envios" section: the first lists preparing-timeout cancellations waiting for a carrier review (GET or POST, returns `{ reviews }`), the second records the admin decision (`refund_approved` or `closed_no_refund` with a required note, POST). Like the refund pair they verify the session and check `profiles_private.role = 'admin'` themselves, and they need no new secret. Apply `supabase/migrations/20261024020649_shipment_cancellation_carrier_review.sql` (service-only `fn_list_shipment_cancellation_reviews` and `fn_resolve_shipment_cancellation_review`) before deploying them. The decision moves no money: an approved refund starts on the next `auto-cancel-preparing` run.

`list-shipment-late-carrier-activity` and `acknowledge-shipment-late-carrier-activity` serve the second bucket of the admin "Envios" section: the first lists carrier activity recorded after a cancellation refund started (GET or POST, returns `{ late_carrier_activity }`), the second marks one case reviewed (POST, required note, idempotent). Like the review pair they verify the session and check `profiles_private.role = 'admin'` themselves, and they need no new secret. Apply the B5 migrations in this order before deploying them: `supabase/migrations/20261027020000_shipment_cancellation_summary.sql` (participant read `fn_get_shipment_cancellation_summary`), `supabase/migrations/20261027030000_drop_fn_cancel_order.sql`, `supabase/migrations/20261027040000_shipment_tracking_during_cancellation.sql` (tracking and delivery confirmation do not advance a shipment whose cancellation refund has started; the cancellation completes and the carrier activity is listed for an admin) and `supabase/migrations/20261027050000_shipment_late_carrier_activity_acknowledge.sql` (service-only acknowledge function). Then deploy `confirm-shipment-delivery` and `complete-delivered-shipments`, which answer or skip with `SHIPMENT_CANCELLATION_OPERATION_ACTIVE` for such a shipment. Acknowledging moves no money.

`list-shipment-label-reconciliations` and `resolve-shipment-label-reconciliation` serve the third bucket of the admin "Envios" section, for paid shipments whose label outcome is unproven (the answer to the label request was lost, or an attempt expired): the first lists them (GET or POST, returns `{ label_reconciliations }`), the second records the admin's decision after checking the Envia panel (POST, required note): `label_found` with tracking number, label URL, Envia shipment id and cost in integer cents, which continues the shipment as generated, or `no_label`, which releases it to `unclaimed` so the seller can generate again, a cancellation can claim it and `auto-cancel-orders` can refund it after the deadline. A shipment that is no longer stuck answers 409 `ALREADY_RESOLVED` and nothing changes. Like the others they verify the session and check `profiles_private.role = 'admin'` themselves, and they need no new secret. Apply `supabase/migrations/20261028234144_shipment_label_reconciliation.sql` (the migration from the B6.1a PR) before deploying them; the functions call `fn_list_shipment_label_reconciliations` and `fn_resolve_shipment_label_reconciliation`, and `resolve` needs the print format and size in `system_settings` (`LABEL_SETTINGS_MISSING` otherwise). Resolving moves no money and calls neither Stripe nor Envia.

Deploy the seven functions that now answer `AUTH_REQUIRED` for a token that is not a signed-in user (`cancel-order`, `create-dispute`, `create-return-intent`, `generate-return-label`, `generate-shipping-label`, `resolve-dispute`, `resolve-dispute-refund`) together with the app release. The app accepts the old and the new text, so the order does not break either side.

`dynamic-api` (display name `get-shipping-quote-seller`) has no source in this repository and no caller (0 calls in 24 hours on 2026-11-10). A project still listing it is out of date: remove it with `supabase functions delete dynamic-api`.

## 8. Cron jobs

The pg_cron jobs are code. `supabase/schemas/_cluster/misc.sql` declares every job as a `cron.schedule_in_database(...)` call, and `supabase db schema declarative generate` writes that file. `supabase db push` (section 3) creates each job, or updates it by name if it already exists. Never schedule, change, or unschedule a job by hand in the SQL Editor. The repository would then no longer describe the project.

Before the push that creates the jobs:

1. Create the Vault secrets of section 5. Every HTTP job reads its URL and credentials from Vault by name on each run.
2. Set the Edge Function secrets of section 6.
3. Deploy the functions (section 7).

To change a job, edit its call in `supabase/schemas/_cluster/misc.sql` and run `supabase db schema declarative sync`, as `supabase/AGENTS.md`, "Declarative schema", describes. `bun test scripts/guards/` runs `scripts/guards/cron-jobs.ts`. It fails when a job calls a function that has no directory in `supabase/functions/`, uses a schedule `cron-watchdog` cannot monitor, or repeats a name. `supabase/tests/database/cron_jobs.test.sql` fails when a job holds a literal secret instead of a Vault read, or sends a Supabase API key or JWT.

The schema file does not say these facts:

- Schedules. `cron-watchdog` supports only `*/N`, `M * * * *`, `M */N * * *`, and `M H * * *`, and reports any other shape as unsupported. A job that runs every minute is written `*/1 * * * *`, because `* * * * *` would be reported.
- Timeouts. `auto-cancel-preparing-job`, `cron-watchdog-every-15-minutes`, and `dispatch-push-every-minute` set `timeout_milliseconds` because their functions can run longer than the `pg_net` default of 5 seconds. Without it the real HTTP status never reaches `net._http_response` (the default cut the first `cron-watchdog` run). `auto-cancel-preparing` reads fresh tracking and cancels the label with Envia before each refund.
- HTTP job results. An HTTP job records `succeeded` in `cron.job_run_details` once `pg_net` queues the request, whatever the function answers. `cron-watchdog` sees only jobs that end `failed`, so every function a job calls needs `withSentry` to surface its own 5xx.
- `cron-watchdog`. It reads `fn_cron_health()` and reports failed, overdue, or unsupported-schedule jobs to Sentry. Sentry creates the `cron-watchdog` Cron Monitor on its first check-in (free plan: 1 monitor). Before deploying a change to the function, run `bun scripts/verify/test-cron-health.ts` against the local stack (6 cases; every case rolls back).
- `track-shipments`. The two lanes (`track-shipments-preparing`, `track-shipments-shipped`) send `Authorization: Bearer <TRACK_SHIPMENTS_CRON_SECRET>`, with no JWT and no `x-cron-secret` (`verify_jwt = false`). Each lane has its own lease, so starting in the same minute is safe. Polling runs only when the function secret `TRACK_SHIPMENTS_POLLING_ENABLED` is `true`. Any other value answers `200 {"skipped": true, "reason": "disabled"}` without touching the database or Envia. Leave the flag unset at first, and check that the runs answer `200` with `"reason": "disabled"` (Edge Function logs for `track-shipments`). Then run `supabase secrets set TRACK_SHIPMENTS_POLLING_ENABLED=true`. The next runs report `processed` and `recorded` counts per lane. To roll back, unset the flag; the runs keep answering `disabled`.
- `auto-cancel-orders` and `auto-cancel-preparing`. Both reject a caller without the `x-cron-secret` header (401 `UNAUTHORIZED`, compared against `CRON_SECRET`); with `verify_jwt = false` the gateway checks no JWT. Both jobs send the Vault secret `auto_cancel_orders_cron_secret`. `auto-cancel-preparing-job` runs at minute 30, so it never overlaps `auto-cancel-orders-job`. On every run `auto-cancel-orders` first calls `fn_notify_label_deadline_reminders`, which reminds the seller of each paid shipment without a label that the run would cancel within 12 hours. On a database without `supabase/migrations/20261101040000_shipment_label_deadline_notification.sql` that call fails and the run logs `Label deadline reminders failed` as an `ERROR` every hour. The cancellations still run.
- `purge-cron-run-details`. pg_cron never trims `cron.job_run_details` (2026-10-26: 86,638 rows since February, about 2,000 more a day), so this job keeps 7 days. It deletes finished runs only. A run in progress has no `end_time`.
- `purge-old-evidence`. It is retired. It deleted rows from `storage.objects` directly and failed every night. `supabase/migrations/20261110235701_cron_jobs.sql` unschedules it where it exists, and #29 recreates evidence cleanup through the Storage API.

### Moving an existing project's cron jobs off API-key JWTs

The development project's cron jobs sent the anon JWT, or a service-role JWT for `checkout-recovery-worker` and `reconcile-stripe-fees`, until `supabase/migrations/20261111005002_cron_jobs_cron_secret_only.sql` (#397). Move a project that still has those jobs in this order:

1. Create the Vault secrets `checkout_recovery_worker_cron_secret` and `reconcile_stripe_fees_cron_secret`, each with the value of `CRON_SECRET` (section 5).
2. From `main`, deploy the five functions whose `verify_jwt` changed to `false`: `checkout-recovery-worker`, `reconcile-stripe-fees`, `complete-delivered-shipments`, `auto-cancel-orders`, and `auto-cancel-preparing` (this includes both workers).
3. Right after, run `supabase db push`. Between steps 2 and 3 the two worker jobs are rejected with 401, for at most one 5-minute run each. Both workers lease their work and are retry-safe, and the other jobs already send `x-cron-secret`.
4. After the next runs, check that no job is rejected: `select status_code, count(*) from net._http_response where created > now() - interval '15 minutes' group by status_code;` shows no `401`. `cron.job_run_details` shows `succeeded` even for a 401 (see "HTTP job results").
5. Delete the old Vault secrets with `delete from vault.secrets where name in ('project_anon_jwt', 'checkout_recovery_worker_service_role_key', 'stripe_fee_worker_service_role_jwt', 'checkout_recovery_worker_url', 'stripe_fee_worker_project_url');` and unset the old function secrets with `supabase secrets unset CHECKOUT_RECOVERY_SERVICE_ROLE_JWT STRIPE_FEE_RECONCILIATION_WORKER_SECRET`.

## 9. External webhooks

- Stripe (live mode): platform and Connect endpoints → `stripe-webhooks`; copy each signing secret into `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`. Each endpoint has its own secret, unlike the single local `stripe listen` secret. Create both endpoints with the API version in `STRIPE_API_VERSION` (`supabase/functions/_shared/stripe/api-version.ts`): snapshot event payloads follow the endpoint version, not the SDK, and the sandbox account default (`2025-12-15.clover`) is older. When `STRIPE_API_VERSION` moves, move the endpoints with it.
  - Platform events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `setup_intent.succeeded`, `refund.updated`, `refund.failed`.
  - The refund events complete a shipment cancellation whose refund settles asynchronously, and flag a refund that failed (buyer notification plus a Sentry CRITICAL). Subscribe the platform endpoint to both, and apply `supabase/migrations/20261022005940_shipment_cancellation_refund_events.sql` (new service-only `fn_apply_shipment_cancellation_refund_event`, new `shipment.refund_failed` notification kind) before deploying `stripe-webhooks`.
  - Connect events: `account.updated`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`.
  - `scripts/dev/stripe-listen.test.ts` checks this list against `STRIPE_WEBHOOK_EVENTS` in `scripts/dev/stripe-listen.ts`.
- Stripe Account Links return/refresh URLs → `connect-onboarding-return`.
- Envia tracking webhook → `envia-webhook`; secret into `ENVIA_WEBHOOK_SECRET_PROD`.

## 10. Auth (Dashboard)

- Deployed Auth settings (project `acoiclkeymgtlwcxilun`, recorded 2026-10-22, updated 2026-10-23 after auth block 4). `supabase/config.toml` mirrors them for the local stack, except "Require current password when updating", which has no config key:
  - Email provider on; confirm email on; secure email change on; secure password change off; require current password when updating on (the app sends `current_password`, commit 3c4a941; recovery sessions are exempt, so forgot-password keeps working).
  - Google provider: "Skip nonce check" off. Revisit when iOS ships: the current native library may need it there.
  - Minimum password length 8; no password composition requirements; leaked password protection off (Pro plan only).
  - Email OTP length 6; email OTP expiry 900 s; minimum interval per user 60 s.
  - Rate limits: emails 2 per hour (built-in mailer), SMS 30, token refreshes 150, token verifications 30, anonymous users 30, sign-ups and sign-ins 30, Web3 30.
  - Provider linking: Supabase automatic linking by verified email (a Google sign-in whose verified email matches an existing user links to that user); manual linking (`linkIdentity`) disabled and unused.
- Pending Auth items:
  - Enable leaked password protection once the project is on the Pro plan.
  - Enable CAPTCHA (hCaptcha) before launch, in this order, because turning it on first rejects every sign-up and sign-in: (1) set `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` (the real hCaptcha site key, never the test key) in the EAS/production env, and the same site key as `VITE_HCAPTCHA_SITE_KEY` in the admin-web build env (Vite inlines it at build time; empty means no widget and no token); (2) ship the mobile build (new native dependencies `react-native-webview` and `@hcaptcha/react-native-hcaptcha`); (3) deploy the admin-web build with `VITE_HCAPTCHA_SITE_KEY` set (login sends `captchaToken`); (4) then enable CAPTCHA in the Dashboard (Authentication > Attack Protection: provider hCaptcha, the hCaptcha secret). Token senders: mobile `signUp`, `signInWithPassword`, `resend` (verify code), `resetPasswordForEmail` (forgot password and reset resend), the delete-account re-sign-in, and the admin-web login. Exempt on the server: Google `signInWithIdToken`, `verifyOtp`, session refresh and `updateUser`. A switch to Turnstile replaces only the provider component (mobile `apps/frontend/src/features/auth/components/captcha-provider.tsx`, admin-web `apps/admin-web/src/features/auth/hooks/use-captcha.tsx`), the site keys and the Dashboard secret.
- URLs, provider and templates (recorded 2026-10-26 from the Dashboard, auth T6a):
  - Site URL: `http://localhost:5173` (the local admin-web). Production: the public web URL (`SELENE_WEB_URL`, section 1 "Domain").
  - Redirect URLs: `selene://`, `selene://auth-verified`, `http://localhost:5173/**`, `selene://profile/settings`. The app needs `selene://profile/settings` (email-change confirmation, `EMAIL_REDIRECT_URL`); `selene://auth-verified` is not used by any code and can be removed. Production: replace `http://localhost:5173/**` with the deployed admin-web URL.
  - Google: one Client ID (`332992495631-gnackhq8269n8v4k7e12sefsfs0cj5ep.apps.googleusercontent.com`, the web client the app sends as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`); "Skip nonce check" off. Add the iOS client ID when iOS ships.
  - Email templates: "Confirm signup" and "Reset password" send the 6-digit `{{ .Token }}` (the app asks for the code); "Change email address" sends `{{ .ConfirmationURL }}` (the app confirms by link through `selene://profile/settings`); "Reauthentication" uses `{{ .Token }}` but the app never calls it (password changes send `current_password`). The branded Spanish versions live in `supabase/templates/` (`confirmation.html`, `recovery.html`, `email_change.html`, `reauthentication.html`); the Dashboard still holds the unstyled defaults until they are pasted. With custom SMTP configured, paste each file into Authentication > Emails > Templates with its subject (the `subject` in the commented `[auth.email.template.*]` blocks of `supabase/config.toml`), then send one test mail per template and check the code or link renders. Do not use `supabase config push` against the remote. Locally the experimental stack cannot serve them (see the comment in `supabase/config.toml`).
- Public pages (admin-web, no sign-in; routes outside `ProtectedRoute`): `/eliminar-cuenta`, `/privacidad` and `/terminos`. They ship with the admin-web deployment (issue #49). Once deployed:
  - Google Play account-deletion URL (Play Console, Data safety): `ACCOUNT_DELETION_URL`.
  - Mobile env: `EXPO_PUBLIC_SUPPORT_EMAIL` = `SELENE_SUPPORT_EMAIL` (`apps/frontend/.env.example`). The terms and privacy links need no env var.
  - Mobile env: set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the live `pk_live_...` key in the production EAS env. Google Pay in the add-card sheet runs in production only with a live key (`apps/frontend/src/features/checkout/logic/stripe-mode.ts`). Any other key keeps it in test mode.
  - Go-live blocker (maintainer): `/privacidad` and `/terminos` are only summaries of decided rules (data handling; marketplace, Seguro Selene, payouts, refunds and disputes, suspension and ban). The full privacy notice (legal text, company identity, ARCO procedure) and the full terms need legal review and must not be presented as complete until they exist; the register checkbox already links to `/terminos`. The support mailbox must exist and receive mail before the Play submission.
- Custom SMTP is required before the first real user. The built-in Supabase mailer only delivers to members of the project's organization (other addresses fail with "Email address not authorized"), has a low hourly limit and no delivery guarantee, so signup codes would never reach real users. Configure Resend (or another SMTP provider) under Authentication > Emails > SMTP Settings: verify the sending domain with SPF and DKIM (and DMARC), use a dedicated From address such as `no-reply@<auth domain>`, and disable link tracking. No app code changes are needed.
- After enabling custom SMTP, raise "Rate limit for sending emails" under Authentication > Rate Limits (it starts at 30 per hour) to the expected signup volume.
- Auth switch-on order. Run it once at go-live, top to bottom; the bullets above hold the details. Each step names its check. The Supabase MCP is read-only and cannot read Dashboard Auth settings, so a step without an MCP check ends with a Dashboard readback recorded in "Deployed Auth settings" with its date.
  1. Domain: change `SELENE_DOMAIN` (section 1, "Domain") and its test, then build the app and admin-web from that commit. Check: `bun test packages/types`; the app's Settings > Legales opens `TERMS_URL` and `PRIVACY_URL` on the real domain.
  2. Sending domain: verify it in Resend with SPF, DKIM and DMARC. Check: Resend shows the domain as verified; `nslookup -type=TXT <domain>` returns the SPF and DMARC records.
  3. Custom SMTP: Authentication > Emails > SMTP Settings, From `no-reply@<domain>`, link tracking off. Check: sign up with an address outside the Supabase organization; the code arrives, and the auth logs (Supabase MCP `query_logs`) show the `/signup` request with no "Email address not authorized" error.
  4. Email templates: paste each file from `supabase/templates/` with its subject. Check: one test mail per template (sign-up code, reset code, email-change link from the app); the code or link renders.
  5. Email rate limit: raise it to the expected volume. Check: Dashboard readback; mirror the value in `supabase/config.toml` `[auth.rate_limit] email_sent`.
  6. Site URL and redirect URLs: Site URL = `SELENE_WEB_URL`; keep `selene://` and `selene://profile/settings`, add the deployed admin-web URL, remove `http://localhost:5173/**` and `selene://auth-verified` (#49). Check: an email change confirmed from the link lands in the app's Settings; Dashboard readback.
  7. CAPTCHA, in the four-step order of "Enable CAPTCHA" above (site keys in both builds, ship both, then the Dashboard switch with the hCaptcha secret). Check: after the switch, the auth logs show `/signup` and `/token?grant_type=password` answering 200 from the new builds and no `captcha_failed` burst; mirror it in `supabase/config.toml` `[auth.captcha]`. The local stack already runs CAPTCHA with hCaptcha's public test secret, and Bruno sends the test token (`captchaToken` in `bruno/environments/local.bru`); the Dashboard keeps the real secret.
  8. Leaked password protection (Pro plan): Authentication > Attack Protection. Check: Supabase MCP `get_advisors` (security) no longer reports `auth_leaked_password_protection`.
  9. Close: Supabase MCP `get_advisors` (security) shows no Auth finding; update "Deployed Auth settings" with the new values and the date.

## 11. Mobile app signing

- Android: the keystore committed before 2026-10-20 (`apps/frontend/credentials/android/keystore.jks`) is public in Git history and must never sign a build. Let EAS generate and hold the upload keystore (`bunx eas-cli credentials` in `apps/frontend`, Android, build credentials), and enroll in Play App Signing on the first upload.
- Google Sign-In: register the SHA-1 of the EAS keystore (and of the Play App Signing key once it exists) on the Android OAuth client used by `@react-native-google-signin/google-signin` in `apps/frontend/app.json`.
- Signing files stay out of the repository: `apps/frontend/credentials.json` and `apps/frontend/credentials/` are gitignored.

### Push credentials

- Android push goes through Firebase Cloud Messaging. The Firebase project is the Google Cloud project that holds the Google Sign-In OAuth clients, with the Android app `com.selene.marketplace`.
- FCM V1 key: in Firebase, Project settings > Service accounts > Generate new private key; upload the JSON on expo.dev (project `selene` > Credentials > Android > `com.selene.marketplace` > FCM V1 service account key), then delete the downloaded file. Expo uses it to send to FCM; it never goes in the repository or in Supabase.
- `apps/frontend/google-services.json` stays out of the repository (gitignored). EAS provides it as the file variable `GOOGLE_SERVICES_JSON`, which `apps/frontend/app.config.ts` reads: `bunx eas-cli env:set --name GOOGLE_SERVICES_JSON --type file --visibility sensitive --value ./google-services.json --environment development --environment preview --environment production`, run in `apps/frontend`. Local builds read `apps/frontend/google-services.json`. Without the file the Android prebuild fails, so a local `expo run:android` needs a copy of it in `apps/frontend/`; `bun run worktree:env` copies only the `.env` files, so a new worktree does not get it.
- iOS needs the Apple Developer Program. Register the device and run `bunx eas-cli build --profile development --platform ios`, accepting the push key prompt. The first iOS build also moves Stripe to Swift Package Manager (the Stripe plugin in `apps/frontend/app.json` sets `"disableSPM": true` until then) and checks the other iOS-only items in #217.
- Check: a push sent by `dispatch-push` reaches a production build, and its ticket and receipt in `push_deliveries` are `ok`.

## 12. Verification

1. `get_advisors` security and performance: no new findings.
2. A real end-to-end purchase, label, delivery, and payout with live keys and a small amount.
3. One manual pass of the main journeys in the app and admin-web (purchase, cancellation with refund, notifications, admin Payments "Necesita atención"). It looks for what automated checks cannot see: confusing copy, layout, real-device behavior. Logic is already covered by the automated checks in `AGENTS.md`, "Verifying a change".
   Auth journeys in that pass, on a real device unless noted:
   - Sign up with email, receive the 6-digit code, verify. Sign in with Google: the first time, then again.
   - Forgot password: the code arrives and the new password works. Change the password in Settings: it asks for the current one.
   - Change the email and confirm from both inboxes. The link opens Settings.
   - Edit only the description of a VERIFIED listing: it saves and stays on sale. Change its price: the re-price dialog shows and the listing goes to review.
   - Delete an account: the re-sign-in step, the "what is deleted and what is kept" copy, and other users then see "Usuario eliminado".
   - A suspended account sees the suspension notice; a banned account sees only the blocked-account screen with its reason.
   - Admin-web: log in with the CAPTCHA; a non-admin account is refused.
4. The first Android release build, on a physical device: `bun run build:release:android` (EAS `preview` profile). Since Expo SDK 58, release builds shrink and optimize the code with R8, and development builds do not, so this is the first build that runs it. Check that the app starts, Google Sign-In (its library ships no R8 rules), a Stripe payment with card and Google Pay, and a push notification received and tapped. A crash such as `ClassNotFoundException` in `adb logcat` needs a keep rule through `expo-build-properties` (`odd/tasks/expo-sdk-58.md` L26).
5. Every cron job shows successful runs in `cron.job_run_details`.
