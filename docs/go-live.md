# Go-live runbook

How to build the production Supabase project from this repository. Keep this file current: whenever a change adds a secret, cron job, bucket, webhook, or Dashboard setting, add it here in the same commit.

Inventory below was read from project `acoiclkeymgtlwcxilun` through the read-only Supabase MCP on 2026-10-18.

## Status

The repository rebuilds the database schema: `supabase/migrations/` starts with the baseline `20261020100000_remote_schema_baseline.sql`, verified on 2026-10-20 to match the development project (functions, policies, triggers, columns, indexes, constraints, enums, views and grants). Pre-baseline history lives in `supabase/migrations/archive/` and is never applied.

## 1. Project

1. Create the project in the target region and organization.
2. Record the new project ref; update `db:types` in `package.json` and the Supabase MCP URL.
3. Use the new API keys from day one: `sb_publishable_...` in the apps and `sb_secret_...` in server components, and keep the legacy `anon`/`service_role` JWT keys disabled. The legacy `service_role` key of the development project was exposed on 2026-10-19 (it was embedded in a Dashboard-created trigger); never reuse it or copy any key from that project.
4. Decide whether migrations deploy through the Supabase GitHub integration (applies pending `supabase/migrations/` on every push to the production branch). It was connected to the development project on 2026-10-21 and disconnected the same day: its first run failed with `column "refund_id" ... already exists` because two migrations had been applied by hand and were missing from the remote history (nothing was applied). Enable it only on a project whose migration history matches the repository, and only once every branch that pushes to `main` is meant to reach production; then update the "The repository does not deploy itself" rule in `AGENTS.md`.

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
- `cron_watchdog_cron_secret` (same value as the `CRON_SECRET` function secret)
- `stripe_fee_worker_project_url`
- `stripe_fee_worker_service_role_jwt`

## 6. Edge Function secrets

`CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `ENVIA_MODE`, `ENVIA_API_KEY_PROD`, `ENVIA_API_URL_PROD`, `ENVIA_WEBHOOK_SECRET_PROD`, `ENVIA_API_KEY_SANDBOX`, `ENVIA_API_URL_SANDBOX`, `ENVIA_WEBHOOK_SECRET_SANDBOX`, `SENTRY_DSN` (required; without it Sentry reporting and the `cron-watchdog` monitor are silently off), `SENTRY_ENVIRONMENT` (optional, default `production`).

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

Production uses live Stripe keys and `ENVIA_MODE` set to production.

## 7. Edge Functions

Deploy every directory in `supabase/functions/` except `_shared/`. `supabase/config.toml` holds the `verify_jwt` flags; deploy with the CLI so they apply.

The remote project also runs `dynamic-api` (name `get-shipping-quote-seller`), which has no source in this repository. Decide whether production needs it before go-live.

## 8. Cron jobs

| Job                                        | Schedule       | Target                                  |
| ------------------------------------------ | -------------- | --------------------------------------- |
| `auto-cancel-orders-job`                   | `0 * * * *`    | function `auto-cancel-orders`           |
| `checkout-recovery-worker-every-5-minutes` | `*/5 * * * *`  | function `checkout-recovery-worker`     |
| `complete-delivered-shipments`             | `*/5 * * * *`  | function `complete-delivered-shipments` |
| `cron-watchdog-every-15-minutes`           | `*/15 * * * *` | function `cron-watchdog`                |
| `dispute-payout-timeout-job`               | `0 * * * *`    | `fn_cron_dispute_payout_timeout()`      |
| `dispute-shipping-timeout-job`             | `0 * * * *`    | `fn_cron_dispute_shipping_timeout()`    |
| `purge-expired-reservations`               | `*/15 * * * *` | inline `UPDATE public.products`         |
| `purge-old-evidence`                       | `0 0 * * *`    | inline `DELETE FROM storage.objects`    |
| `reconcile-connect-payments`               | `0 */6 * * *`  | `fn_reconcile_connect_payments()`       |
| `reconcile-stripe-fees-every-5-minutes`    | `*/5 * * * *`  | function `reconcile-stripe-fees`        |
| `resume-pending-payouts`                   | `*/5 * * * *`  | function `resume-pending-payouts`       |
| `return-delivery-timeout`                  | `0 * * * *`    | `fn_cron_return_delivery_timeout()`     |
| `track-shipments-every-6-hours`            | `0 */6 * * *`  | function `track-shipments`              |

`auto-cancel-orders-job` and `track-shipments-every-6-hours` embed a literal JWT and the project URL in the job command. Recreate them reading Vault secrets, like the other HTTP jobs.

`cron-watchdog-every-15-minutes` calls `cron-watchdog`, which reads `fn_cron_health()` and reports failed, overdue, or unsupported-schedule jobs to Sentry. Create the Vault secret `cron_watchdog_cron_secret` first, with the same value as the `CRON_SECRET` function secret (the function compares the `x-cron-secret` header against `CRON_SECRET`). Then run, in the SQL Editor:

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
    body := '{}'::jsonb
  );
  $$
);
```

Sentry creates the `cron-watchdog` Cron Monitor on its first check-in (free plan: 1 monitor). The watchdog only sees jobs that end `failed` in `cron.job_run_details`; an HTTP job records `succeeded` once `pg_net` queues the request, so those functions need `withSentry` to surface their own 5xx.

## 9. External webhooks

- Stripe (live mode): platform and Connect endpoints → `stripe-webhooks`; copy each signing secret into `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`. Each endpoint has its own secret, unlike the single local `stripe listen` secret.
  - Platform events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `setup_intent.succeeded`.
  - Connect events: `account.updated`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`.
  - Keep this list in sync with `STRIPE_WEBHOOK_EVENTS` in `scripts/stripe-listen.ts`.
- Stripe Account Links return/refresh URLs → `connect-onboarding-return`.
- Envia tracking webhook → `envia-webhook`; secret into `ENVIA_WEBHOOK_SECRET_PROD`.

## 10. Auth (Dashboard)

- Enable leaked password protection (currently disabled).
- Site URL, redirect URLs, providers, and email templates: not yet inventoried. Record them here.
- Custom SMTP is required before the first real user. The built-in Supabase mailer only delivers to members of the project's organization (other addresses fail with "Email address not authorized"), has a low hourly limit and no delivery guarantee, so signup codes would never reach real users. Configure Resend (or another SMTP provider) under Authentication > Emails > SMTP Settings: verify the sending domain with SPF and DKIM (and DMARC), use a dedicated From address such as `no-reply@<auth domain>`, and disable link tracking. No app code changes are needed.
- After enabling custom SMTP, raise "Rate limit for sending emails" under Authentication > Rate Limits (it starts at 30 per hour) to the expected signup volume.

## 11. Mobile app signing

- Android: the keystore committed before 2026-10-20 (`apps/frontend/credentials/android/keystore.jks`) is public in Git history and must never sign a build. Let EAS generate and hold the upload keystore (`eas credentials` in `apps/frontend`, Android, build credentials), and enroll in Play App Signing on the first upload.
- Google Sign-In: register the SHA-1 of the EAS keystore (and of the Play App Signing key once it exists) on the Android OAuth client used by `@react-native-google-signin/google-signin` in `apps/frontend/app.json`.
- Signing files stay out of the repository: `credentials.json` and `credentials/` are gitignored.

## 12. Verification

1. `get_advisors` security and performance: no new findings.
2. A real end-to-end purchase, label, delivery, and payout with live keys and a small amount.
3. Every cron job shows successful runs in `cron.job_run_details`.
