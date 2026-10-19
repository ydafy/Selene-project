# Go-live runbook

How to build the production Supabase project from this repository. Keep this file current: whenever a change adds a secret, cron job, bucket, webhook, or Dashboard setting, add it here in the same commit.

Inventory below was read from project `acoiclkeymgtlwcxilun` through the read-only Supabase MCP on 2026-10-18.

## Status

Not runnable yet. The repository cannot rebuild the database:

- Repository migrations start at `20260528000000_drop_legacy_columns` and lack a base schema.
- Remote migration history is empty; SQL was applied through the Dashboard.
- Migration version `20260923000000` is used by two files.

Prerequisite: after active worktrees merge into `main`, dump the remote schema into one baseline migration and verify `supabase db reset` rebuilds it locally.

## 1. Project

1. Create the project in the target region and organization.
2. Record the new project ref; update `db:types` in `package.json` and the Supabase MCP URL.

## 2. Extensions

`pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `supabase_vault`, `wrappers`, `pg_stat_statements`, `hypopg`, `index_advisor`.

Install `pg_net` in the `extensions` schema, not `public` (security advisor `extension_in_public`).

## 3. Database

1. Apply the baseline migration, then every later migration in version order.
2. Run `get_advisors` (security and performance) and resolve new findings.
3. Regenerate types and confirm they match `packages/types/src/database.types.ts`.

## 4. Storage buckets

| Bucket | Public |
| --- | --- |
| `Avatars` | yes |
| `products` | yes |
| `public-assets` | yes |
| `evidence` | yes (review: holds dispute evidence) |
| `verification` | no |

Bucket policies on `storage.objects` must come from migrations.

## 5. Vault secrets

Values differ per project; never copy them from another environment.

- `project_url`
- `project_anon_jwt`
- `checkout_recovery_worker_url`
- `checkout_recovery_worker_service_role_key`
- `complete_delivered_shipments_cron_secret`
- `resume_pending_payouts_cron_secret`
- `stripe_fee_worker_project_url`
- `stripe_fee_worker_service_role_jwt`

## 6. Edge Function secrets

`CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `ENVIA_MODE`, `ENVIA_API_KEY_PROD`, `ENVIA_API_URL_PROD`, `ENVIA_WEBHOOK_SECRET_PROD`, `ENVIA_API_KEY_SANDBOX`, `ENVIA_API_URL_SANDBOX`, `ENVIA_WEBHOOK_SECRET_SANDBOX`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

Production uses live Stripe keys and `ENVIA_MODE` set to production.

## 7. Edge Functions

Deploy every directory in `supabase/functions/` except `_shared/`. `supabase/config.toml` holds the `verify_jwt` flags; deploy with the CLI so they apply.

The remote project also runs `dynamic-api` (name `get-shipping-quote-seller`), which has no source in this repository. Decide whether production needs it before go-live.

## 8. Cron jobs

| Job | Schedule | Target |
| --- | --- | --- |
| `auto-cancel-orders-job` | `0 * * * *` | function `auto-cancel-orders` |
| `checkout-recovery-worker-every-5-minutes` | `*/5 * * * *` | function `checkout-recovery-worker` |
| `complete-delivered-shipments` | `*/5 * * * *` | function `complete-delivered-shipments` |
| `dispute-payout-timeout-job` | `0 * * * *` | `fn_cron_dispute_payout_timeout()` |
| `dispute-shipping-timeout-job` | `0 * * * *` | `fn_cron_dispute_shipping_timeout()` |
| `purge-expired-reservations` | `*/15 * * * *` | inline `UPDATE public.products` |
| `purge-old-evidence` | `0 0 * * *` | inline `DELETE FROM storage.objects` |
| `reconcile-connect-payments` | `0 */6 * * *` | `fn_reconcile_connect_payments()` |
| `reconcile-stripe-fees-every-5-minutes` | `*/5 * * * *` | function `reconcile-stripe-fees` |
| `resume-pending-payouts` | `*/5 * * * *` | function `resume-pending-payouts` |
| `return-delivery-timeout` | `0 * * * *` | `fn_cron_return_delivery_timeout()` |
| `track-shipments-every-6-hours` | `0 */6 * * *` | function `track-shipments` |

`auto-cancel-orders-job` and `track-shipments-every-6-hours` embed a literal JWT and the project URL in the job command. Recreate them reading Vault secrets, like the other HTTP jobs.

## 9. External webhooks

- Stripe: platform and Connect endpoints → `stripe-webhooks`; copy each signing secret into `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`.
- Stripe Account Links return/refresh URLs → `connect-onboarding-return`.
- Envia tracking webhook → `envia-webhook`; secret into `ENVIA_WEBHOOK_SECRET_PROD`.

## 10. Auth (Dashboard)

- Enable leaked password protection (currently disabled).
- Site URL, redirect URLs, providers, and email templates: not yet inventoried. Record them here.

## 11. Verification

1. `get_advisors` security and performance: no new findings.
2. A real end-to-end purchase, label, delivery, and payout with live keys and a small amount.
3. Every cron job shows successful runs in `cron.job_run_details`.
