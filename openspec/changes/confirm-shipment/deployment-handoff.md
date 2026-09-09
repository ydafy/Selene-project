# Deployment Handoff: Hardened Buyer Shipment Confirmation

## Release Status

| Item | Status | Evidence / constraint |
|---|---|---|
| Remote migration | Confirmed by maintainer | `supabase/migrations/20260903002546_confirm_shipment_hardening.sql` was manually applied. |
| Generated database types | Confirmed by maintainer and structurally inspected | `packages/types/src/database.types.ts` includes `shipments.buyer_confirmed_at`, `shipment_completion_events`, and `fn_confirm_shipment_delivery`. |
| Live SQL verification | Confirmed by maintainer | The exact read-only query in [Post-deployment validation](#post-deployment-validation) was executed; all eight structural/grant checks returned `true`. |
| Edge Function deployment | Pending maintainer action | Structural SQL verification is complete; deploy only through the maintainer workflow. |
| Cron schedule | Pending maintainer action | Do not enable it before both functions and cron secrets are configured. |
| Provider validation | Pending maintainer action | Envia delivery timestamps and Stripe payout-queue behavior require sandbox/manual validation before go-live. |

## Required Deployment Order

1. **Migration first — already confirmed.** The maintainer manually applied `supabase/migrations/20260903002546_confirm_shipment_hardening.sql` to the remote project.
2. **Live SQL verification — completed.** The maintainer executed and supplied the all-true result for the read-only structural query below. This is remote structural evidence, not a functional RPC smoke check.
3. **Deploy functions second, in this order:**
   1. `supabase/functions/confirm-shipment-delivery/index.ts`
   2. `supabase/functions/complete-delivered-shipments/index.ts`
4. **Configure Edge and Vault secrets, then run the direct scheduler-authentication smoke check.** Do not create the recurring schedule until that check passes.
5. **Create the cron schedule.** Enable it only after the secret-backed direct request is proven safe with a sandbox or dedicated fixture.
6. **Generate database types after SQL — already confirmed.** The maintainer manually regenerated types after applying SQL. Do not rerun `bun db:types` unless a later remote schema change requires it.
7. Deploy the compatible frontend only after the function and scheduler checks below pass.

## Edge Function Deployments

The maintainer must deploy these two functions without disabling JWT verification:

```text
confirm-shipment-delivery
complete-delivered-shipments
```

`supabase/config.toml` disables JWT verification only for `connect-onboarding-return` and `envia-webhook`; neither new function has that exception. The buyer endpoint expects a caller `Authorization` header. The scheduler endpoint is POST-only and independently verifies `x-cron-secret` before it creates its service-role client or queries shipments.

## Required Secrets and Configuration

### Edge Function environment

Configure the same high-entropy value as `CRON_SECRET` for `complete-delivered-shipments`. It is read at `Deno.env.get('CRON_SECRET')` in `supabase/functions/complete-delivered-shipments/index.ts` and compared to the request's `x-cron-secret` header.

The deployed functions also require their standard server-only Supabase runtime configuration (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). Do not expose the service-role key to the cron request, browser clients, SQL logs, or documentation output.

### Vault secrets for cron

Create Vault-managed secrets before creating the schedule. The names below are the handoff contract for the schedule SQL; substitute only the project URL value and keep the names stable:

| Vault secret name | Value | Use |
|---|---|---|
| `project_url` | Project URL, without a trailing slash | Builds the function URL. |
| `project_anon_jwt` | The project's legacy anon JWT | Gateway authentication only; never a service-role key. |
| `complete_delivered_shipments_cron_secret` | The same value as Edge `CRON_SECRET` | Passed only as `x-cron-secret`. |

Do not store literal secret values in the schedule. Do not use `SUPABASE_SERVICE_ROLE_KEY` in `Authorization` or `apikey`; the cron caller uses the project anon JWT and the separate cron secret.

## Cron Setup

The scheduler path is exactly:

```text
POST /functions/v1/complete-delivered-shipments
```

The function reads exactly `x-cron-secret`; its gateway JWT verification remains enabled. Use the Vault-held project anon JWT in both gateway headers and use the distinct Vault-held cron secret for the function's own authentication. The `apikey` header follows the existing project Edge-function client-header convention and the documented `pg_net` invocation pattern.

After the direct scheduler-authentication smoke check passes and no existing job has the same name, the maintainer can create this five-minute schedule in the Dashboard SQL Editor:

```sql
select cron.schedule(
  'complete-delivered-shipments',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/complete-delivered-shipments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'project_anon_jwt'
      ),
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'project_anon_jwt'
      ),
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'complete_delivered_shipments_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

This schedule is intentionally bounded by the function: it selects at most 100 `delivered` shipments with `buyer_confirmed_at IS NULL` and `delivered_at <= now() - 48 hours`, then calls only `fn_confirm_shipment_delivery` with `auto_completion_<shipmentId>` keys.

## Smoke Checks

Run these only in a sandbox or with dedicated, safe fixtures. Do not use a production shipment merely to test the mutation.

1. **Buyer function gateway and authorization:** POST to `/functions/v1/confirm-shipment-delivery` with a real buyer access JWT in `Authorization: Bearer <buyer-access-token>` and JSON `{ "orderId", "shipmentId", "idempotencyKey": "confirm_shipment_<shipmentId>" }`. Confirm a delivered shipment succeeds, a shipped shipment is rejected, an active-dispute shipment is rejected, and a retry returns idempotent success.
2. **Connect accounting:** for a delivered Connect fixture, confirm completion; verify no `wallets` or `wallet_transactions` write occurred and the expected INFO `system_logs` event was written.
3. **Scheduler authentication:** POST to `/functions/v1/complete-delivered-shipments` with `Authorization: Bearer <project-anon-jwt>`, `apikey: <project-anon-jwt>`, and `x-cron-secret: <cron-secret>`. A missing or incorrect `x-cron-secret` must return `CRON_UNAUTHORIZED` before any shipment access. A non-POST request must return `INVALID_REQUEST`.
4. **Automatic completion:** use a fixture delivered at least 48 hours ago with `buyer_confirmed_at IS NULL`; verify it completes with one `shipment_completion_events` row sourced as `auto`, preserves `buyer_confirmed_at` as NULL, and retries are idempotent. Verify a 47h59m fixture remains excluded.
5. **Race behavior:** run buyer and scheduler confirmation against one delivered fixture; verify one completion event exists and the losing call reports idempotent success with the winner's source.
6. **Provider boundary:** confirm Envia provides the expected carrier `delivered_at` timestamp and that the existing Stripe Connect payout-release queue behavior remains unchanged.

## Post-deployment Validation

The remote migration and generated-type evidence are confirmed. The maintainer executed the following read-only structural query in the remote project's SQL Editor and supplied this result:

```text
buyer_confirmed_at_exists=true
completion_events_table_exists=true
due_index_exists=true
canonical_rpc_exists=true
legacy_rpc_removed=true
completion_events_rls_enabled=true
anon_rpc_execution_revoked=true
service_role_rpc_execution_granted=true
```

The executed query was:

```sql
select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shipments'
      and column_name = 'buyer_confirmed_at'
      and data_type = 'timestamp with time zone'
  ) as buyer_confirmed_at_exists,
  to_regclass('public.shipment_completion_events') is not null
    as completion_events_table_exists,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_shipments_auto_completion_due'
  ) as due_index_exists,
  to_regprocedure(
    'public.fn_confirm_shipment_delivery(uuid,text,uuid,text)'
  ) is not null as canonical_rpc_exists,
  to_regprocedure('public.fn_confirm_delivery(uuid)') is null
    as legacy_rpc_removed,
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'shipment_completion_events'
  ), false) as completion_events_rls_enabled,
  not has_function_privilege(
    'anon',
    'public.fn_confirm_shipment_delivery(uuid,text,uuid,text)',
    'execute'
  ) as anon_rpc_execution_revoked,
  has_function_privilege(
    'service_role',
    'public.fn_confirm_shipment_delivery(uuid,text,uuid,text)',
    'execute'
  ) as service_role_rpc_execution_granted;
```

All result columns are `true`. This structural query does not replace the functional sandbox smoke checks above; no function deployment, cron setup, live RPC smoke result, or provider validation has been claimed or recorded.

## Rollback

Unschedule `complete-delivered-shipments` first. Then revert the frontend and remove both new functions. Retain the nullable `buyer_confirmed_at` column and completion-event audit rows. Restoring the retired legacy RPC is emergency-only because it restores the replaced unsafe confirmation path.
