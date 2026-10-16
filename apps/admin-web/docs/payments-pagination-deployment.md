# Payments grouped-pagination deployment

B2 adds a read-only database contract. List pages contain up to20 complete seller/run groups; **Select all** retrieves all available matching groups, including unloaded pages. It never submits payouts or retries by itself. Existing search still defines the matching query.

## SQL step — maintainer only

After the agent finishes the bounded review, execute exactly one complete migration in the intended Supabase Dashboard SQL Editor:

`supabase/migrations/20261015065416_paginate_admin_payout_queue.sql`

Prerequisite: the previously applied `20261015022449_expose_payout_history_paid_at.sql` and existing release view/run schema. Do not replay old migrations or execute the identical canonical copy as a second migration. This file adds only `fn_get_admin_payout_queue(text,text,integer,text)`, its comment and restricted EXECUTE privileges; no tables or stored financial data change.

## Read-only checks after application

Run these in SQL Editor. Share only aggregate results/errors, never payout/seller IDs, payloads, keys or secrets.

```sql
-- Expected: security-definer=false; service_role=true; anon/authenticated=false.
SELECT p.prosecdef, p.provolatile, p.proconfig
FROM pg_proc p
WHERE p.oid = 'public.fn_get_admin_payout_queue(text,text,integer,text)'::regprocedure;
SELECT role_name,
  has_function_privilege(role_name,
    'public.fn_get_admin_payout_queue(text,text,integer,text)', 'EXECUTE') AS can_execute
FROM (VALUES ('service_role'), ('anon'), ('authenticated')) AS roles(role_name);

-- Expected: at most20 groups, clamped page, consistent group-unit counts.
-- More than20 raw shipment rows is valid: groups must remain complete.
WITH response AS (
  SELECT public.fn_get_admin_payout_queue('', 'ready', 0, 'page') AS data
)
SELECT data->'counts' AS query_counts, data->'page' AS page,
  data->'totalPages' AS total_pages, data->'totalGroups' AS total_groups,
  jsonb_array_length(data->'rows') AS returned_shipment_rows,
  (SELECT count(DISTINCT r->>'seller_id')
    FROM jsonb_array_elements(data->'rows') r) AS returned_seller_groups
FROM response;

-- Expected: true even when the selection contains more than20 groups.
-- The page argument must not cap or skip any selectable group.
SELECT public.fn_get_admin_payout_queue('', 'ready', 0, 'selection') =
  public.fn_get_admin_payout_queue('', 'ready', 2147483647, 'selection')
  AS select_all_ignores_page;

-- Expected: missing_groups=0, unexpected_groups=0, complete=true.
WITH response AS (
  SELECT public.fn_get_admin_payout_queue('', 'ready', 0, 'selection') AS data
), expected AS (
  SELECT DISTINCT seller_id::text AS id
  FROM public.admin_connect_payout_release_view
  WHERE payout_run_id IS NULL AND seller_id IS NOT NULL
    AND shipment_id IS NOT NULL AND order_id IS NOT NULL
    AND is_eligible IS TRUE AND release_amount_cents > 0
), selected AS (
  SELECT DISTINCT r->>'seller_id' AS id
  FROM response, jsonb_array_elements(data->'rows') r
)
SELECT
  (SELECT count(*) FROM (SELECT id FROM expected EXCEPT SELECT id FROM selected) x) AS missing_groups,
  (SELECT count(*) FROM (SELECT id FROM selected EXCEPT SELECT id FROM expected) x) AS unexpected_groups,
  data->'selectionComplete' AS complete
FROM response;
```

Also inspect page and selection responses for `action-required` using aggregate counts only; only failed+retryable groups may be selected. `processing`/`history` selection calls must reject with `QUEUE_SELECTION_NOT_ALLOWED`; negative/null page, unknown/null scope or bucket reject with their named `INVALID_QUEUE_*` error. These are read calls, not financial mutations. If the queue has20or fewer groups, it cannot by itself prove the21-group boundary; do not create real payouts to populate a test.

## Contract and next gates

- `p_search`: literal, case-insensitive seller-name substring; `%`/`_` are not wildcards. Blank/null means no seller filter.
- `p_bucket`: `ready`, `processing`, `action-required`, `history`.
- `p_scope=page`: stable group ordering,20group page size, page index clamped to the current last page. No split groups. Counts describe all matching groups, not the returned shipment-row count.
- `p_scope=selection`: only Ready/Attention; all selectable matching groups, independent of page. `selectedGroupCount` and `selectionComplete` describe that result; `totalGroups/totalPages` still describe the bucket. This intentionally loads the full selection only on request; timeout/error is not partial success.
- History stays paid-time descending, nulls last, run ID descending ties. Other groups use normalized seller name and identity for deterministic ordering. Page positions are fresh snapshots, not stable memberships under concurrent queue changes.
- One JSON return contains the rows/counts from one SQL statement snapshot, avoiding the top-level PostgREST row cap on a set-returning shipment query. This does not remove resource/time limits or promise unlimited payload size.
- After successful SQL application, confirm to the agent and regenerate types; the agent checks the generated RPC signature before integrating Edge/frontend. No hand-written generated RPC types.
- Edge step is **later and separate**: `get-connect-payout-release-queue` must expose the new mode behind its existing bearer/admin-role checks. SQL alone does not activate UI paging. No release/retry financial endpoint, secret, cron or webhook change is planned.

## Additive Edge wire contract

The new POST body is `{ search?: string, bucket, page: 0, scope: 'page' }`.
`bucket` is one of `ready`, `processing`, `action-required`, `history`; page is a
zero-based nonnegative int32. Explicit `scope: 'selection'` is allowed only for
Ready or Attention and ignores the page offset. Omitting `bucket` preserves the
legacy search-only protocol; it must not be used as a pagination fallback.

Successful new-mode responses retain the SQL keys `rows`, `counts`, `bucket`,
`scope`, `page`, `pageSize`, `totalGroups`, `totalPages`, `selectedGroupCount`, and
`selectionComplete`, alongside `success: true`. The shared request/response fields
are optional for compatibility, but a new-mode frontend must require them.
`validatePayoutQueueResponse` validates this envelope in the paginated hook path.
The Payments page supplies the active bucket and page, displays backend group
counts, and passes already-paged complete groups to the workbenches without a
second client slice.

The frontend keeps visible page details separate from selected details, resets
page/selection on search changes, clamps refreshed page bounds, and retains the
30-second polling interval. Select-all means every selectable
group matching the active search and bucket, not just the visible page. A failed
or incomplete selection request must not install partial selections. Each serial financial callback fetches fresh complete details and compares them
against the reviewed snapshot before dispatch; envelope validation or a cached
full selection cannot establish freshness. Changed amounts/account/eligibility,
retry authority, query changes, query errors or failed reads stop that dispatch. Each request is a fresh snapshot rather than a durable
cursor. Complete selections can exceed resource/time limits; a failure must
remain a failure, with no silent fallback or money movement.

After the Edge and frontend implementations pass their separate checks, the
maintainer must manually deploy `get-connect-payout-release-queue` through the
Supabase Dashboard. No release/retry function, secret, cron, or webhook change is
needed for this read protocol. Verify the new page and selection envelopes,
legacy search-only compatibility, and unchanged admin authorization before
activating the new frontend. SQL application and generated-signature confirmation
were reported complete by the maintainer and parent respectively; Edge deployment
is a separate gate and is not established by those confirmations.

## Evidence limits

Structural SQL tests are not PostgreSQL execution. No local PostgreSQL runner was available for this increment; remote checks remain maintainer-owned; SQL application was subsequently confirmed, but independent runtime boundary and effective-privilege evidence is not supplied by these source tests. Existing History changes, generated output and unrelated worktree edits must be preserved. No commit, push, function deployment or remote mutation is authorized by creating these files.


## Current handoff: manual Edge deployment and read-only UI checks

Local implementation and source rechecks are complete. The final F1/F2 source recheck closed both blockers; it did not execute tests or establish deployed behavior. Parent-observed post-correction checks:107 frontend-process tests plus57 isolated child tests, no failures; app-local TypeScript and production build passed. The Edge handler's28 tests also passed. Scoped lint passed as writer evidence. The production build retains a bundle-size advisory; no tooling or dependency changes were made. Native assessment was unavailable, not approved. Automated Chromium verification with mocked reads was subsequently added and passed; see the browser evidence section below.

The maintainer subsequently confirmed deployment with `supabase functions deploy get-connect-payout-release-queue`. Do not repeat this deployment or require Dashboard reapplication. The function includes its entrypoint `index.ts`, `handler.ts`, `get-connect-payout-release-queue.ts` and resolved imports. No financial action functions, extra SQL, type regeneration, secrets, cron or webhook changes are needed for the browser test.

Before activating the new frontend against this endpoint, confirm the new page/selection protocol works and non-admin requests remain rejected. Then check in the browser:

1. Pages show at most20 complete seller/run groups; counts cover the matching bucket, not only the visible page.
2. With more than20 selectable groups, Select all includes unloaded groups; deselection, clear and search reset behave coherently. If the available queue is smaller, record that the cross-page boundary remains unobserved; do not create real payouts to populate it.
3. Changing pages, filtering and selecting causes no release/retry request. Do not confirm real financial actions solely for verification.
4. History retains payment-date ordering and its read-only behavior; Processing remains read-only.
5. Incomplete responses, selection failures or stale query state stop the operation rather than silently accepting a partial selection.

Report any real-queue errors or untested boundaries separately. Deployment confirmation plus local/browser proof does not independently establish deployed authorization or SQL behavior under45groups.

## Browser evidence with fictional groups

`e2e/admin-web/payments.e2e.ts` renders the actual protected `/payments` UI using
an entirely fictitious admin session/profile and intercepted Supabase reads. The
fixture has45sellers with two eligible shipments each (90shipments total). No
records are inserted into a database and no demo mode or production guard changes
are introduced.

The five Chromium scenarios check:

- Complete seller pages of20,20and5groups, including disabled boundary controls.
- Select-all45before page2/3have been loaded; retained selection across navigation,
  individual deselection (90→89→88shipments), clear and disabled release when empty.
- Search resets the page/selection and scoped select-all selects only matching groups.
- Failed complete-selection requests do not install partial selections.
- A deliberately attempted release request to the fictional origin is aborted
  before connection; ordinary scenarios attempt zero financial requests.

The context route is installed before navigation, allows only exact local-server
GETs and explicit fictional profile/queue reads, and denies every other request.
Service workers and WebSockets are blocked. Server configuration uses dummy public
Supabase values and a dedicated strict5187port with no server reuse. Google Fonts
are intentionally blocked offline. Screenshots are saved under ignored
`test-results/`; the full command is in the root README.

This closes the proposed mocked-browser verification scope. It is not a45group
PostgreSQL/PostgREST integration test, a deployed permissions test, a financial
provider test or a confirmation of real payouts. Those limits remain explicit;
there is no need to manufacture real financial records just to exercise paging.
