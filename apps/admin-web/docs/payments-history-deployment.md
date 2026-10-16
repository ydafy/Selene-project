# Expose the observed payout payment date

Apply one additive view migration before regenerating types and implementing History chronology. This step exposes an existing nullable run timestamp; it does not change stored payments, payout status, eligibility, amounts, retries, or event evidence.

## Maintainer quick path

1. In the intended Supabase project's Dashboard SQL Editor, inspect the current view definition and confirm it matches the repository's retry-era definition below. Stop on unexpected drift; do not replay older migrations to repair it blindly.
2. Execute the **complete file**, including `BEGIN` and `COMMIT`:
   `supabase/migrations/20261015022449_expose_payout_history_paid_at.sql`.
3. Run the read-only checks below and report success or the exact error. Do not share keys, payout IDs, seller data, or raw event payloads.
4. Confirm SQL application to the agent. Only then run `bun db:types`, verify the generated view row includes `payout_run_paid_at: string | null`, and proceed with the frontend date/ordering work.

**Do not execute** the combined historical copy at `supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql` on an existing installation: it also creates the retry column/index. It is a canonical source copy, not this deployment step.

## Preflight — inspect, do not mutate

The expected pre-change view is in `supabase/migrations/20260917032655_add_connect_payout_failed_retry_contract.sql`. It has 22 columns, ends with `requires_manual_review`, uses `security_invoker = true`, and chooses the latest run per shipment by `created_at DESC, id DESC`. The new version adds only `payout_run_paid_at` at the end and reads the same selected run's `paid_at`.

```sql
SELECT pg_get_viewdef('public.admin_connect_payout_release_view'::regclass, true);
SELECT column_name, data_type, ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'admin_connect_payout_release_view'
ORDER BY ordinal_position;
SELECT reloptions FROM pg_class
WHERE oid = 'public.admin_connect_payout_release_view'::regclass;
```

If the date column already exists, check its definition and source rather than assuming this file was applied. A missing retry-era view or a different projection is a deployment mismatch that needs investigation.

## Post-application checks

```sql
-- Expected: 23 columns; last name payout_run_paid_at, timestamptz.
SELECT column_name, data_type, ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'admin_connect_payout_release_view'
ORDER BY ordinal_position;

-- Expected: security_invoker=true; service SELECT=true, client SELECT=false.
SELECT reloptions FROM pg_class
WHERE oid = 'public.admin_connect_payout_release_view'::regclass;
SELECT role_name,
  has_table_privilege(role_name, 'public.admin_connect_payout_release_view', 'SELECT') AS can_select
FROM (VALUES ('service_role'), ('anon'), ('authenticated')) AS roles(role_name);

-- Expected: zero date mismatches. No payout identities are returned.
SELECT count(*) AS date_mismatches
FROM public.admin_connect_payout_release_view q
LEFT JOIN public.connect_payout_runs r ON r.id = q.payout_run_id
WHERE q.payout_run_paid_at IS DISTINCT FROM r.paid_at;

-- Inventory only: missing dates are allowed; never backfill from completion,
-- retry creation, arrival estimates or the current time.
SELECT payout_run_status, count(DISTINCT payout_run_id) AS run_count,
  count(DISTINCT payout_run_id) FILTER (WHERE payout_run_paid_at IS NULL) AS undated_run_count
FROM public.admin_connect_payout_release_view
WHERE payout_run_id IS NOT NULL
GROUP BY payout_run_status;
```

## Deployment boundaries

| Item | Required for this increment |
| --- | --- |
| SQL | The single incremental migration above, before type regeneration |
| Edge Functions | No code change/redeployment: existing `get-connect-payout-release-queue` uses `select('*')` and returns the raw rows; verify the deployed endpoint does too |
| Secrets, cron, webhooks | No new settings or changes |
| Generated types | Separate step after maintainer confirmation; never hand-edit generated schema |
| Frontend | Implemented locally: History-only observed date in cards/modal; parsed payment instant descending, run ID descending for ties; missing/invalid dates last and shown unavailable |

The existing webhook/event-ledger/late-failure projection must already be deployed for B4's existing guarantees to hold. This view migration neither installs nor proves that infrastructure. Review its deployed state separately if unknown; do not trigger real payouts or synthetic production failures to test it.

History remains the current observed-paid operational view, **not** an all-attempt ledger or proof of irreversible bank receipt. A later confirmed failure must leave History after reconciliation and a successful queue refresh; the polling interval is not a freshness guarantee. The internal append-only event ledger stays separate; no event timeline or direct ledger access is added.

## Current rollout status

The maintainer reported SQL application without errors and regenerated types. The local generated view row includes `payout_run_paid_at: string | null`; this is structural evidence plus maintainer-reported execution, not an agent-run remote postcheck. Do not reapply SQL or regenerate types merely because the chronological instructions above remain in this guide. Frontend functional checks and source review are tracked separately in `odd/tasks/payments-history-reliability.md`.

## Verification limits

Local structural SQL guards and payout reconciliation/mapper tests are not PostgreSQL execution or remote deployment evidence. No local PostgreSQL runner was available when preparing this increment. The unrelated broad-suite `npm:zod@4.1.12` import error in label-remediation tests remains outside this scope; the maintainer approved payout-focused verification instead. Bounded independent source review found no concrete candidate-caused blocker. Independent test execution was unavailable because the verifier's scratch-isolation requirement conflicted with its no-copy scope; parent evidence remains 194 tests plus 10 isolated hook tests passing, scoped ESLint/diff checks passing, and a final 4-test SQL structural spot check passing. This is a maintainer deployment handoff, not native review approval or proof that the SQL has executed successfully. Follow the preflight and report application/check results before type regeneration.
