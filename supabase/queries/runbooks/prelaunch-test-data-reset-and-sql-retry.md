# Pre-launch Test-data Reset and SQL Retry Runbook

**Owner:** maintainer with production-equivalent Supabase Dashboard access only
**Scope:** disposable marketplace test data only
**Status:** destructive data-only reset is intentionally **not supplied**

## Safety boundary

Do not run `TRUNCATE ... CASCADE`, delete from `auth.*`, `storage.*`,
`supabase_migrations.*`, `system_settings`, or any configuration/reference table.
Do not use a Dashboard project reset as a substitute for a data-only reset.

The local generated types and repository SQL identify several transactional
relationships, but they cannot prove the live project's complete foreign-key
graph, trigger behavior, or which `products`/profiles are reference data. A
destructive table list would therefore risk protected data. The repository's
foundation migration also deliberately refuses to delete the invalid legacy
rows; it raises `PRELAUNCH_RESET_REQUIRED:LEGACY_GROUPED_SHIPMENTS` instead.

The SQL Editor runs the submitted SQL as the `postgres` role and does not add a
transaction wrapper. Keep each supplied `BEGIN; ... COMMIT;` source intact and
run one source per editor execution.

## Read-only safety preflight

1. Create and verify a downloadable database backup in the Supabase Dashboard.
2. Pause test traffic, Stripe test webhooks, scheduled jobs, and any worker that
   can write marketplace rows. Do not resume them until post-retry verification
   passes.
3. Run the following **read-only** inspection inside the explicit transaction
   shown immediately after it. Its session-local maintainer confirmation is the
   required sentinel: if it is not set to the exact literal, the query raises
   and nothing else may proceed.

```sql
DO $$
BEGIN
  IF current_setting('app.prelaunch_reset_confirmation', true)
       IS DISTINCT FROM 'SELENE_TEST_DATA_RESET_APPROVED' THEN
    RAISE EXCEPTION 'REFUSING_PRELAUNCH_RESET: set the session-local maintainer confirmation first';
  END IF;
END;
$$;

WITH candidate_tables(table_name) AS (
  VALUES
    ('orders'), ('order_items'), ('shipments'), ('shipment_label_events'),
    ('disputes'), ('connect_payout_runs'), ('connect_payout_run_shipments'),
    ('wallet_transactions'), ('payout_requests'), ('notifications')
),
foreign_keys AS (
  SELECT
    child.relname AS child_table,
    parent.relname AS parent_table,
    con.conname AS constraint_name,
    pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  WHERE con.contype = 'f'
    AND child_ns.nspname = 'public'
    AND parent_ns.nspname = 'public'
)
SELECT *
FROM foreign_keys
WHERE child_table IN (SELECT table_name FROM candidate_tables)
   OR parent_table IN (SELECT table_name FROM candidate_tables)
ORDER BY parent_table, child_table, constraint_name;
```

`SET LOCAL` requires an explicit transaction. Use this single read-only
preflight block instead of running the snippets separately:

```sql
BEGIN;
SET LOCAL app.prelaunch_reset_confirmation = 'SELENE_TEST_DATA_RESET_APPROVED';
-- Paste the DO block and FK SELECT above here.
ROLLBACK;
```

The result is the live dependency map. Expected known edges include
`connect_payout_run_shipments -> connect_payout_runs`,
`connect_payout_run_shipments -> shipments`, `shipment_label_events -> shipments`,
`order_items -> shipments`, `shipments -> orders`, and `disputes -> shipments`.
The output may add tables not represented by local generated types; every such
edge blocks a repository-authored destructive reset.

## Data-only reset with existing successful schema retained

### Decision gate

Do **not** run a repository SQL deletion after the preflight. The live FK map
must be reviewed by the maintainer, who is accountable for deciding what is
disposable. This repository has no safe, complete classification for profiles,
products, addresses, wallets, audit data, or Stripe-correlated records.

If the map confirms that grouped records exist, the minimum transactional
dependency order to assess is:

1. child event/association rows (`shipment_label_events`,
   `connect_payout_run_shipments`);
2. dispute/payment/payout children (all tables revealed by the live FK query);
3. `order_items`;
4. `shipments`;
5. `orders`.

This is **not an executable delete order**. In particular, resetting products
from `SOLD`/`RESERVED` requires a maintainer-approved business rule, and deleting
or mutating wallets, profiles, addresses, settings, Auth, or Storage is outside
this runbook.

After the maintainer performs a separately reviewed Dashboard deletion plan,
run these verification queries before retrying the migration:

```sql
-- Must return zero rows. This is the foundation migration's blocking invariant.
SELECT shipment_id, COUNT(*) AS order_item_count
FROM public.order_items
WHERE shipment_id IS NOT NULL
GROUP BY shipment_id
HAVING COUNT(*) > 1;

-- Must retain configuration; update a populated legacy value to `ground` before
-- applying the foundation constraint. Do not delete this row.
SELECT id, envia_carrier, envia_service, envia_print_format, envia_print_size,
       listing_quote_reference_destination
FROM public.system_settings
ORDER BY id;

-- Protected schemas: no statements in this runbook modify them.
SELECT n.nspname AS protected_schema, c.relname AS table_name, c.reltuples::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname IN ('auth', 'storage', 'supabase_migrations')
ORDER BY n.nspname, c.relname;
```

If `envia_service` is populated with a legacy spelling, run this narrow
configuration correction only after confirming it is the intended Paquetexpress
setting. It preserves the row and all other configuration:

```sql
BEGIN;
UPDATE public.system_settings
SET envia_service = 'ground'
WHERE envia_carrier = 'paquetexpress'
  AND envia_service IS NOT NULL
  AND lower(regexp_replace(btrim(envia_service), '\s+', ' ', 'g')) <> 'ground';
COMMIT;
```

## Full project/database reset

Use this path only when Auth users, Storage objects/metadata, project settings,
Edge Function deployment state, API keys, secrets, cron/webhook configuration,
and migration history are intentionally disposable or have a tested restoration
plan. A new/reset project is **not** a safe data-only reset: Supabase documents
that database backups do not carry Edge Functions, Auth settings/API keys,
Realtime settings, extensions/settings, or read replicas.

1. Create a fresh test project or use the Dashboard's destructive reset control
   only after its current scope has been confirmed in the Dashboard UI.
2. Restore/reconfigure Auth, Storage, API keys, Edge Functions, secrets, cron,
   Stripe webhook endpoints, and project settings from a maintainer-owned
   checklist. Do not infer these from a database backup.
3. Apply the full migration history in filename order, ending with the retry
   sequence below. This is the only case where all migrations are reapplied.
4. Recreate test users and Storage fixtures only if they are intentionally
   disposable. Verify no live Stripe endpoint points at the reset project.

## Exact SQL retry order after local corrections

### Data-only path (earlier successful schema retained)

First use the structural checks above. Do not re-run a source merely because it
exists locally; Dashboard SQL Editor executions do not automatically create a
migration-history record.

1. **Apply only if absent:**
   `supabase/migrations/20260713210000_envia_shipping_label_hardening.sql`.
   It creates the label-state baseline, `shipment_label_events`, and the base
   `system_settings` fields required by the foundation.
2. **Reapply the changed active settlement RPC:**
   `supabase/queries/orders/fn_create_shipments_from_single_payment.sql`.
   This is required even if the original migration succeeded because the current
   function now rejects allocation rows containing more than one product. It is
   the canonical source for the `20260703000000` function body.
3. **Retry the previously rolled-back foundation:**
   `supabase/migrations/20260824001426_post_purchase_label_generation_foundation.sql`.
   It creates the partial unique shipment link index, applies the exact
   Paquetexpress `ground` setting constraint, adds quote fields/state guards,
   and replaces the legacy grouped settlement function with the retired guard.
4. **Retry the previously rolled-back payout view:**
   `supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql`.
   Its outer `::INTEGER` preserves the existing view column type while using
   `label_provider_cost_cents` for the payout deduction.

Do **not** run `supabase/queries/orders/fn_create_shipment_from_payment.sql`
separately after step 3: the foundation migration embeds the same retired legacy
function definition and grants. Running both adds no state and obscures the
deployment record. If step 3 is intentionally not applied, that query is the
required standalone fallback to retire the old remote function.

### Full reset path

Apply every migration in lexical filename order. The relevant tail is:

1. `20260702000000_single_modal_checkout_settlement.sql` — columns required by
   the settlement RPC;
2. `20260703000000_single_modal_settlement_rpc.sql` — its current migration
   body already contains the canonical one-product settlement function;
3. `20260713210000_envia_shipping_label_hardening.sql`;
4. `20260824001426_post_purchase_label_generation_foundation.sql`;
5. `queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql`.

## Post-retry verification

```sql
-- Foundation index and 1:1 invariant.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'order_items'
  AND indexname = 'order_items_shipment_id_unique';

SELECT shipment_id, COUNT(*)
FROM public.order_items
WHERE shipment_id IS NOT NULL
GROUP BY shipment_id
HAVING COUNT(*) > 1;

-- View output type must remain integer, not bigint.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'admin_connect_payout_release_view'
  AND column_name = 'release_amount_cents';

-- The remote legacy entry point must fail closed.
SELECT pg_get_functiondef(
  'public.fn_create_shipment_from_payment(text,bigint,jsonb)'::regprocedure
);
```

Expected results: the duplicate query returns zero rows;
`release_amount_cents` is `integer`; and the legacy function body contains
`LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED`.

Only after the maintainer confirms all remote SQL succeeded: regenerate types,
deploy the affected Edge Functions, and run the Envia sandbox test. Those are
separate deployment steps and are intentionally not performed by this runbook.

## Risks and stop conditions

- Any FK discovered outside the assessed transactional set: stop; do not infer
  a delete order.
- Any live Stripe test charge, transfer, payout, webhook retry, or cron still
  references the data: stop and reconcile/disable it first.
- Any failed SQL source: stop. Its explicit transaction rolls back that source;
  do not continue to the next one.
- Any unexpected protected-schema row change: restore from backup and stop.
