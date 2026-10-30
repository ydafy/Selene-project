# Go-live runbook

How to build the production Supabase project from this repository. Keep this file current: whenever a change adds a secret, cron job, bucket, webhook, or Dashboard setting, add it here in the same commit.

Inventory below was read from project `acoiclkeymgtlwcxilun` through the read-only Supabase MCP on 2026-10-18.

## Status

The repository rebuilds the database schema: `supabase/migrations/` starts with the baseline `20261020100000_remote_schema_baseline.sql`, verified on 2026-10-20 to match the development project (functions, policies, triggers, columns, indexes, constraints, enums, views and grants). Pre-baseline history lives in `supabase/migrations/archive/` and is never applied.

Open launch dependencies:

- Fee-free period for launch sellers (#64). The commission (`system_settings.service_fee_pct`) is global and frozen into each product at publication, so the app cannot waive it for invited sellers' first sales. Do not set the global rate to 0 as a workaround: every product published while it is 0 keeps 0 permanently.

## 1. Project

1. Create the project in the target region and organization.
2. Record the new project ref; update `db:types` in `package.json` and the Supabase MCP URL.
3. Use the new API keys from day one: `sb_publishable_...` in the apps and `sb_secret_...` in server components, and keep the legacy `anon`/`service_role` JWT keys disabled. The legacy `service_role` key of the development project was exposed on 2026-10-19 (it was embedded in a Dashboard-created trigger); never reuse it or copy any key from that project.
4. Decide whether migrations deploy through the Supabase GitHub integration (applies pending `supabase/migrations/` on every push to the production branch). It was connected to the development project on 2026-10-21 and disconnected the same day: its first run failed with `column "refund_id" ... already exists` because two migrations had been applied by hand and were missing from the remote history (nothing was applied). Enable it only on a project whose migration history matches the repository, and only once every branch that pushes to `main` is meant to reach production; then update the "The repository does not deploy itself" rule in `AGENTS.md`.

### Domain

Selene has no domain yet. Code uses the placeholder `selene.example` (`.example` is reserved by RFC 2606 and never resolves) from one constant: `SELENE_DOMAIN` in `packages/types/src/domain.ts` (`SELENE_WEB_URL` derives from it). The same file holds `SELENE_SUPPORT_EMAIL` (`soporte@<domain>`), `ACCOUNT_DELETION_PATH` (`/eliminar-cuenta`), `PRIVACY_PATH` (`/privacidad`) and the derived `ACCOUNT_DELETION_URL` and `PRIVACY_URL`. Several modules need the domain; any new code that needs it imports that constant instead of writing a domain.

When the real domain is registered:

1. Change `SELENE_DOMAIN` in `packages/types/src/domain.ts` and update its test.
2. Settings outside code, which do not read the constant: custom SMTP sender and DNS records (section 10), Auth Site URL and redirect URLs (section 10), and any public page URL registered in the app stores (Google Play account deletion).

## 2. Extensions

`pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `supabase_vault`, `wrappers`, `pg_stat_statements`, `hypopg`, `index_advisor`.

Never store secrets in schema objects (trigger arguments, foreign server options, function bodies). They appear in every schema dump. Read them from Vault at runtime.

Install `pg_net` in the `extensions` schema, not `public` (security advisor `extension_in_public`).

## 3. Database

1. Link the new project and run `supabase db push`: it applies the baseline and every later migration in version order and records them in the remote migration history.
2. Run `get_advisors` (security and performance) and resolve new findings.
3. Regenerate types and confirm they match `packages/types/src/database.types.ts`.

## 4. Storage buckets

| Bucket          | Public                               |
| --------------- | ------------------------------------ |
| `Avatars`       | yes                                  |
| `products`      | yes                                  |
| `public-assets` | yes                                  |
| `evidence`      | yes (review: holds dispute evidence) |
| `verification`  | no                                   |

Bucket policies on `storage.objects` must come from migrations.

## 5. Vault secrets

Values differ per project; never copy them from another environment.

- `project_url`
- `project_anon_jwt`
- `checkout_recovery_worker_url`
- `checkout_recovery_worker_service_role_key`
- `complete_delivered_shipments_cron_secret`
- `resume_pending_payouts_cron_secret`
- `auto_cancel_orders_cron_secret` (same value as the `CRON_SECRET` function secret)
- `cron_watchdog_cron_secret` (same value as the `CRON_SECRET` function secret)
- `account_closure_cleanup_cron_secret` (same value as the `CRON_SECRET` function secret)
- `dispatch_push_cron_secret` (same value as the `CRON_SECRET` function secret)
- `stripe_fee_worker_project_url`
- `stripe_fee_worker_service_role_jwt`
- `track_shipments_cron_secret` (same value as the `TRACK_SHIPMENTS_CRON_SECRET` function secret)

## 6. Edge Function secrets

`CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `ENVIA_MODE`, `ENVIA_API_KEY_PROD`, `ENVIA_API_URL_PROD`, `ENVIA_WEBHOOK_SECRET_PROD`, `ENVIA_API_KEY_SANDBOX`, `ENVIA_API_URL_SANDBOX`, `ENVIA_WEBHOOK_SECRET_SANDBOX`, `SENTRY_DSN` (required; without it Sentry reporting and the `cron-watchdog` monitor are silently off), `SENTRY_ENVIRONMENT` (optional, default `production`). `TRACK_SHIPMENTS_CRON_SECRET` and `TRACK_SHIPMENTS_POLLING_ENABLED` (`true` turns Envia polling on; see "8. Cron jobs"). `EXPO_ACCESS_TOKEN` (required by `dispatch-push`; see "7. Edge Functions").

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

Production uses live Stripe keys and `ENVIA_MODE` set to production.

## 7. Edge Functions

Deploy every directory in `supabase/functions/` except `_shared/`. `supabase/config.toml` holds the `verify_jwt` flags; deploy with the CLI so they apply.

`create-payment-intent` was retired (replaced by `create-connect-payment`; it no longer exists in the repository). Its deployed copy was deleted from the development project on 2026-10-25, so a project still listing it is out of date: remove it with `supabase functions delete create-payment-intent`.

`resolve-shipment-refund` is called by admins with their own session, so it keeps `verify_jwt = true` (declared in `supabase/config.toml`) and checks `profiles_private.role = 'admin'` itself. It needs no new secret. Apply `supabase/migrations/20261022013846_shipment_cancellation_refund_resolution.sql` (new resolution columns, service-only `fn_resolve_shipment_cancellation_refund`, `fn_cancel_shipment` accepting an admin-resolved refund) before deploying it.

`list-shipment-refund-problems` is the admin read of unresolved refund problems (GET, returns `{ problems }`). Like `resolve-shipment-refund` it keeps `verify_jwt = true` (declared in `supabase/config.toml`) and checks `profiles_private.role = 'admin'` itself. It needs no new secret. Apply `supabase/migrations/20261022223302_shipment_refund_problems.sql` (service-only `fn_list_shipment_refund_problems`) before deploying it.

`delete-account` closes an account in one SQL transaction (`fn_close_account`) and then removes the Stripe customer, the Stripe Connect account and Storage files. `account-closure-cleanup` is its cron retry for closures whose cleanup failed or never ran: it runs without a user session, is authenticated by the `x-cron-secret` header against `CRON_SECRET`, and keeps `verify_jwt = false` (declared in `supabase/config.toml`). Apply `supabase/migrations/20261023043220_account_closure.sql` and then `supabase/migrations/20261023052842_account_closure_cleanup.sql` (service-only `fn_claim_account_closures` and `fn_record_closure_attempt`), then deploy both functions. The retry stops after 24 attempts per closure and lists those closures in its response and in an `ERROR` log (`Account closure cleanup gave up`, with the user ids) on every run; an admin reads `account_closures.last_error` for those users and finishes the failed step by hand. Apply `20261023043220_account_closure.sql` before shipping a mobile build from this change: the app selects `profiles.deleted_at` in its order and review queries, which fail on a database without that column.

`dispatch-push` delivers queued push notifications through the Expo Push API every minute: it claims up to 5 batches of 100 rows from `push_deliveries`, sends each batch right after its claim, records the tickets, checks receipts 15 minutes after sending (a `DeviceNotRegistered` receipt disables the token) and deletes finished rows older than 30 days. It is authenticated by the `x-cron-secret` header against `CRON_SECRET` and keeps `verify_jwt = false` (declared in `supabase/config.toml`). It needs the function secret `EXPO_ACCESS_TOKEN`; without it every run answers 500 `MISSING_SERVER_CONFIG` and claims nothing. Create an access token on expo.dev (https://expo.dev/settings/access-tokens) with the account that owns the project, set it with `supabase secrets set EXPO_ACCESS_TOKEN=<value>`, then turn on "Enhanced security for push notifications" in the project settings on expo.dev, so Expo rejects a push request without the token. Apply `supabase/migrations/20261030014104_push_outbox.sql` and `supabase/migrations/20261030025554_push_receipts_and_purge.sql` before deploying it. Expo credential errors (`InvalidCredentials`, `MismatchSenderId`, `UNAUTHORIZED`) are reported to Sentry.

`list-shipment-operation-reviews` and `resolve-shipment-operation-review` serve the admin "Envios" section: the first lists preparing-timeout cancellations waiting for a carrier review (GET or POST, returns `{ reviews }`), the second records the admin decision (`refund_approved` or `closed_no_refund` with a required note, POST). Like the refund pair they keep `verify_jwt = true` (declared in `supabase/config.toml`) and check `profiles_private.role = 'admin'` themselves, and they need no new secret. Apply `supabase/migrations/20261024020649_shipment_cancellation_carrier_review.sql` (service-only `fn_list_shipment_cancellation_reviews` and `fn_resolve_shipment_cancellation_review`) before deploying them. The decision moves no money: an approved refund starts on the next `auto-cancel-preparing` run.

`list-shipment-late-carrier-activity` and `acknowledge-shipment-late-carrier-activity` serve the second bucket of the admin "Envios" section: the first lists carrier activity recorded after a cancellation refund started (GET or POST, returns `{ late_carrier_activity }`), the second marks one case reviewed (POST, required note, idempotent). Like the review pair they keep `verify_jwt = true` (declared in `supabase/config.toml`) and check `profiles_private.role = 'admin'` themselves, and they need no new secret. Apply the B5 migrations in this order before deploying them: `supabase/migrations/20261027020000_shipment_cancellation_summary.sql` (participant read `fn_get_shipment_cancellation_summary`), `supabase/migrations/20261027030000_drop_fn_cancel_order.sql`, `supabase/migrations/20261027040000_shipment_tracking_during_cancellation.sql` (tracking and delivery confirmation do not advance a shipment whose cancellation refund has started; the cancellation completes and the carrier activity is listed for an admin) and `supabase/migrations/20261027050000_shipment_late_carrier_activity_acknowledge.sql` (service-only acknowledge function). Then deploy `confirm-shipment-delivery` and `complete-delivered-shipments`, which answer or skip with `SHIPMENT_CANCELLATION_OPERATION_ACTIVE` for such a shipment. Acknowledging moves no money.

`list-shipment-label-reconciliations` and `resolve-shipment-label-reconciliation` serve the third bucket of the admin "Envios" section, for paid shipments whose label outcome is unproven (the answer to the label request was lost, or an attempt expired): the first lists them (GET or POST, returns `{ label_reconciliations }`), the second records the admin's decision after checking the Envia panel (POST, required note): `label_found` with tracking number, label URL, Envia shipment id and cost in integer cents, which continues the shipment as generated, or `no_label`, which releases it to `unclaimed` so the seller can generate again, a cancellation can claim it and `auto-cancel-orders` can refund it after the deadline. A shipment that is no longer stuck answers 409 `ALREADY_RESOLVED` and nothing changes. Like the others they keep `verify_jwt = true` (declared in `supabase/config.toml`) and check `profiles_private.role = 'admin'` themselves, and they need no new secret. Apply `supabase/migrations/20261028234144_shipment_label_reconciliation.sql` (the migration from the B6.1a PR) before deploying them; the functions call `fn_list_shipment_label_reconciliations` and `fn_resolve_shipment_label_reconciliation`, and `resolve` needs the print format and size in `system_settings` (`LABEL_SETTINGS_MISSING` otherwise). Resolving moves no money and calls neither Stripe nor Envia.

Deploy the seven functions that now answer `AUTH_REQUIRED` for a token that is not a signed-in user (`cancel-order`, `create-dispute`, `create-return-intent`, `generate-return-label`, `generate-shipping-label`, `resolve-dispute`, `resolve-dispute-refund`) together with the app release. The app accepts the old and the new text, so the order does not break either side.

The remote project also runs `dynamic-api` (name `get-shipping-quote-seller`), which has no source in this repository. Decide whether production needs it before go-live.

## 8. Cron jobs

| Job                                        | Schedule       | Target                                  |
| ------------------------------------------ | -------------- | --------------------------------------- |
| `account-closure-cleanup`                  | `0 * * * *`    | function `account-closure-cleanup`      |
| `auto-cancel-orders-job`                   | `0 * * * *`    | function `auto-cancel-orders`           |
| `checkout-recovery-worker-every-5-minutes` | `*/5 * * * *`  | function `checkout-recovery-worker`     |
| `complete-delivered-shipments`             | `*/5 * * * *`  | function `complete-delivered-shipments` |
| `cron-watchdog-every-15-minutes`           | `*/15 * * * *` | function `cron-watchdog`                |
| `dispatch-push-every-minute`               | `*/1 * * * *`  | function `dispatch-push`                |
| `dispute-payout-timeout-job`               | `0 * * * *`    | `fn_cron_dispute_payout_timeout()`      |
| `dispute-shipping-timeout-job`             | `0 * * * *`    | `fn_cron_dispute_shipping_timeout()`    |
| `purge-expired-reservations`               | `*/15 * * * *` | inline `UPDATE public.products`         |
| `purge-cron-run-details`                   | `0 3 * * *`    | inline `DELETE FROM cron.job_run_details` (7 days) |
| `purge-old-evidence`                       | `0 0 * * *`    | inline `DELETE FROM storage.objects`    |
| `reconcile-connect-payments`               | `0 */6 * * *`  | `fn_reconcile_connect_payments()`       |
| `reconcile-stripe-fees-every-5-minutes`    | `*/5 * * * *`  | function `reconcile-stripe-fees`        |
| `resume-pending-payouts`                   | `*/5 * * * *`  | function `resume-pending-payouts`       |
| `return-delivery-timeout`                  | `0 * * * *`    | `fn_cron_return_delivery_timeout()`     |
| `track-shipments-preparing`                | `*/5 * * * *`  | function `track-shipments` (`preparing`) |
| `track-shipments-shipped`                  | `*/15 * * * *` | function `track-shipments` (`shipped`)   |

`track-shipments` polls Envia per lane and authenticates its caller with `Authorization: Bearer <TRACK_SHIPMENTS_CRON_SECRET>` (`verify_jwt = false`; no JWT and no `x-cron-secret`). It only works when `TRACK_SHIPMENTS_POLLING_ENABLED` is `true`; any other value answers `200 {"skipped": true, "reason": "disabled"}` without touching the database or Envia. The old `track-shipments-every-6-hours` job sends a literal service-role JWT and no `lane`, so every run gets 401 (seen four times on 2026-10-25). Replace it in this order:

1. Generate a secret (`openssl rand -hex 32`) and set it as the Edge Function secret `TRACK_SHIPMENTS_CRON_SECRET` (`supabase secrets set TRACK_SHIPMENTS_CRON_SECRET=<value>`). Leave `TRACK_SHIPMENTS_POLLING_ENABLED` unset for now.
2. Store the same value in Vault, then remove the old job (this also removes the service-role JWT from `cron.job`) and create the two lanes. In the SQL Editor:

```sql
select vault.create_secret('<same value as TRACK_SHIPMENTS_CRON_SECRET>', 'track_shipments_cron_secret');

select cron.unschedule('track-shipments-every-6-hours');

select cron.schedule(
  'track-shipments-preparing',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/track-shipments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'track_shipments_cron_secret')
    ),
    body := '{"lane": "preparing"}'::jsonb
  );
  $$
);

select cron.schedule(
  'track-shipments-shipped',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/track-shipments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'track_shipments_cron_secret')
    ),
    body := '{"lane": "shipped"}'::jsonb
  );
  $$
);
```

3. Check the next runs return `200` with `"reason": "disabled"` instead of 401 (Edge Function logs for `track-shipments`).
4. Enable polling: `supabase secrets set TRACK_SHIPMENTS_POLLING_ENABLED=true`. The next runs report `processed` and `recorded` counts per lane.

Both lanes use `*/N` schedules because `cron-watchdog` only supports `*/N`, `M * * * *`, `M */N * * *` and `M H * * *`; each lane has its own lease, so starting in the same minute is safe. Rollback: unset `TRACK_SHIPMENTS_POLLING_ENABLED` (runs keep answering `disabled`), then `cron.unschedule` both lanes if needed.

The service-role JWT that the old job carried was readable by anyone with database owner access. It is replaced, not revoked: revoking it is part of moving to Supabase's per-key API keys before go-live (backlog BL32), which also replaces the service-role values stored in Vault (`checkout_recovery_worker_service_role_key`, `stripe_fee_worker_service_role_jwt`).

`auto-cancel-orders` and `auto-cancel-preparing` reject any caller without the `x-cron-secret` header (401 `UNAUTHORIZED`, compared against `CRON_SECRET`), even though the gateway still accepts the anon JWT. Order matters: create the Vault secret `auto_cancel_orders_cron_secret` and recreate `auto-cancel-orders-job` first (the previous function version ignores the extra header), and only then deploy both functions; otherwise the hourly runs get 401. In the SQL Editor:

```sql
select cron.unschedule('auto-cancel-orders-job');

select cron.schedule(
  'auto-cancel-orders-job',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/auto-cancel-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'auto_cancel_orders_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

`auto-cancel-preparing` has the same authorization and reuses the Vault secret `auto_cancel_orders_cron_secret` (same `CRON_SECRET` value). It runs hourly at minute 30, so it never overlaps `auto-cancel-orders`. Before each refund it reads fresh tracking and cancels the label with Envia; a run can take longer than pg_net's default 5 s, so the job sets `timeout_milliseconds` to keep the real HTTP status in `net._http_response`. Apply the B4 migrations (`20261024013216_shipment_carrier_cancellation_outcome.sql`, `20261024020649_shipment_cancellation_carrier_review.sql`) and deploy `auto-cancel-preparing` first. In the SQL Editor:

```sql
select cron.schedule(
  'auto-cancel-preparing-job',
  '30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/auto-cancel-preparing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'auto_cancel_orders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

`cron-watchdog-every-15-minutes` calls `cron-watchdog`, which reads `fn_cron_health()` and reports failed, overdue, or unsupported-schedule jobs to Sentry. In order: apply `supabase/migrations/20261021025844_cron_health.sql` (creates `fn_cron_health()`, service role only) and `supabase/migrations/20261026014010_cron_health_index_scan.sql` (reads `cron.job_run_details` by primary key; without it the read timed out on 86k rows), deploy `cron-watchdog`, and create the Vault secret `cron_watchdog_cron_secret` with the same value as the `CRON_SECRET` function secret (the function compares the `x-cron-secret` header against `CRON_SECRET`). Then run, in the SQL Editor:

```sql
select cron.schedule(
  'cron-watchdog-every-15-minutes',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cron-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_watchdog_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

The 30-second timeout keeps the response in `net._http_response` while the function reports to Sentry (the `pg_net` default of 5 seconds cut the first run). Running `cron.schedule` again with the same name replaces the job.

`purge-cron-run-details` keeps 7 days of `cron.job_run_details`, which pg_cron never trims (2026-10-26: 86,638 rows since February, about 2,000 more a day). It deletes finished runs only; a run in progress has no `end_time`. Run in the SQL Editor:

```sql
select cron.schedule(
  'purge-cron-run-details',
  '0 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);
```

`account-closure-cleanup` retries the Stripe and Storage cleanup of closed accounts every hour (the schedule shape `cron-watchdog` supports). Create the Vault secret `account_closure_cleanup_cron_secret` first, with the same value as the `CRON_SECRET` function secret, then run, in the SQL Editor:

```sql
select cron.schedule(
  'account-closure-cleanup',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/account-closure-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'account_closure_cleanup_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

`dispatch-push-every-minute` sends queued push notifications (see "7. Edge Functions"). The schedule is written `*/1 * * * *`, the shape `cron-watchdog` supports; `* * * * *` would be reported as unsupported. Deploy `dispatch-push` and set `EXPO_ACCESS_TOKEN` first, then create the Vault secret `dispatch_push_cron_secret` with the same value as the `CRON_SECRET` function secret, then run, in the SQL Editor:

```sql
select cron.schedule(
  'dispatch-push-every-minute',
  '*/1 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_jwt'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
```

Sentry creates the `cron-watchdog` Cron Monitor on its first check-in (free plan: 1 monitor). The watchdog only sees jobs that end `failed` in `cron.job_run_details`; an HTTP job records `succeeded` once `pg_net` queues the request, so those functions need `withSentry` to surface their own 5xx.

## 9. External webhooks

- Stripe (live mode): platform and Connect endpoints → `stripe-webhooks`; copy each signing secret into `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`. Each endpoint has its own secret, unlike the single local `stripe listen` secret.
  - Platform events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `setup_intent.succeeded`, `refund.updated`, `refund.failed`.
  - The refund events complete a shipment cancellation whose refund settles asynchronously, and flag a refund that failed (buyer notification plus a Sentry CRITICAL). Subscribe the platform endpoint to both, and apply `supabase/migrations/20261022005940_shipment_cancellation_refund_events.sql` (new service-only `fn_apply_shipment_cancellation_refund_event`, new `shipment.refund_failed` notification kind) before deploying `stripe-webhooks`.
  - Connect events: `account.updated`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`.
  - Keep this list in sync with `STRIPE_WEBHOOK_EVENTS` in `scripts/stripe-listen.ts`.
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
  - Enable CAPTCHA (hCaptcha) before launch, in this order, because turning it on first rejects every sign-up and sign-in: (1) set `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` (the real hCaptcha site key, never the test key) in the EAS/production env, and the same site key as `VITE_HCAPTCHA_SITE_KEY` in the admin-web build env (Vite inlines it at build time; empty means no widget and no token); (2) ship the mobile build (new native dependencies `react-native-webview` and `@hcaptcha/react-native-hcaptcha`); (3) deploy the admin-web build with `VITE_HCAPTCHA_SITE_KEY` set (login sends `captchaToken`); (4) then enable CAPTCHA in the Dashboard (Authentication > Attack Protection: provider hCaptcha, the hCaptcha secret). Token senders: mobile `signUp`, `signInWithPassword`, `resend` (verify code), `resetPasswordForEmail` (forgot password and reset resend), the delete-account re-sign-in, and the admin-web login. Exempt on the server: Google `signInWithIdToken`, `verifyOtp`, session refresh and `updateUser`. A switch to Turnstile replaces only the provider component (mobile `core/auth/captcha/CaptchaProvider.tsx`, admin-web `src/lib/captcha/useCaptcha.tsx`), the site keys and the Dashboard secret.
- URLs, provider and templates (recorded 2026-10-26 from the Dashboard, auth T6a):
  - Site URL: `http://localhost:5173` (the local admin-web). Production: the public web URL (`SELENE_WEB_URL`, section 1 "Domain").
  - Redirect URLs: `selene://`, `selene://auth-verified`, `http://localhost:5173/**`, `selene://profile/settings`. The app needs `selene://profile/settings` (email-change confirmation, `EMAIL_REDIRECT_URL`); `selene://auth-verified` is not used by any code and can be removed. Production: replace `http://localhost:5173/**` with the deployed admin-web URL.
  - Google: one Client ID (`332992495631-gnackhq8269n8v4k7e12sefsfs0cj5ep.apps.googleusercontent.com`, the web client the app sends as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`); "Skip nonce check" off. Add the iOS client ID when iOS ships.
  - Email templates: "Confirm signup" and "Reset password" send the 6-digit `{{ .Token }}` (the app asks for the code); "Change email address" sends `{{ .ConfirmationURL }}` (the app confirms by link through `selene://profile/settings`); "Reauthentication" uses `{{ .Token }}` but the app never calls it (password changes send `current_password`). Templates are unstyled defaults: brand them together with custom SMTP.
- Public pages (admin-web, no sign-in; routes outside `ProtectedRoute`): `/eliminar-cuenta` and `/privacidad`. They ship with the admin-web deployment (issue #49). Once deployed:
  - Google Play account-deletion URL (Play Console, Data safety): `ACCOUNT_DELETION_URL`.
  - Mobile env: `EXPO_PUBLIC_PRIVACY_URL` = `PRIVACY_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` = `SELENE_SUPPORT_EMAIL` (`apps/frontend/.env.example`).
  - Mobile env: set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the live `pk_live_...` key in the production EAS env. Google Pay in the add-card sheet runs in production only with a live key (`apps/frontend/core/utils/stripeMode.ts`). Any other key keeps it in test mode.
  - Go-live blocker (maintainer): `/privacidad` is only a summary of decided data handling. The full privacy notice (legal text, company identity, ARCO procedure) needs legal review and must not be presented as complete until it exists. The support mailbox must exist and receive mail before the Play submission.
- Custom SMTP is required before the first real user. The built-in Supabase mailer only delivers to members of the project's organization (other addresses fail with "Email address not authorized"), has a low hourly limit and no delivery guarantee, so signup codes would never reach real users. Configure Resend (or another SMTP provider) under Authentication > Emails > SMTP Settings: verify the sending domain with SPF and DKIM (and DMARC), use a dedicated From address such as `no-reply@<auth domain>`, and disable link tracking. No app code changes are needed.
- After enabling custom SMTP, raise "Rate limit for sending emails" under Authentication > Rate Limits (it starts at 30 per hour) to the expected signup volume.

## 11. Mobile app signing

- Android: the keystore committed before 2026-10-20 (`apps/frontend/credentials/android/keystore.jks`) is public in Git history and must never sign a build. Let EAS generate and hold the upload keystore (`eas credentials` in `apps/frontend`, Android, build credentials), and enroll in Play App Signing on the first upload.
- Google Sign-In: register the SHA-1 of the EAS keystore (and of the Play App Signing key once it exists) on the Android OAuth client used by `@react-native-google-signin/google-signin` in `apps/frontend/app.json`.
- Signing files stay out of the repository: `credentials.json` and `credentials/` are gitignored.

## 12. Verification

1. `get_advisors` security and performance: no new findings.
2. A real end-to-end purchase, label, delivery, and payout with live keys and a small amount.
3. One manual pass of the main journeys in the app and admin-web (purchase, cancellation with refund, notifications, admin Payments "Necesita atención"). It looks for what automated checks cannot see: confusing copy, layout, real-device behavior. Logic is already covered by the automated checks in `AGENTS.md`, "Verifying a change".
4. Every cron job shows successful runs in `cron.job_run_details`.
