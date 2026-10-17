# Admin payout queue read endpoint

Manual deployment of `get-connect-payout-release-queue` is required before new clients use pagination. The maintainer reported applying `20261015065416_paginate_admin_payout_queue.sql`; generated types now contain `fn_get_admin_payout_queue`. Repository changes alone do not deploy the Edge Function. No agent deployment was performed. Existing server configuration requires `SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`; never send the latter to clients. No new secrets, cron or webhook configuration is required.

## Additive POST contract

Bearer authentication, `getUser`, and `profiles_private.role = admin` are required before queue reads. OPTIONS retains CORS support.

Presence of `bucket` enables RPC mode:

```json
{"search":"Ada","bucket":"ready","page":0,"scope":"page"}
```

- `bucket`: `ready`, `processing`, `action-required`, or `history` (required).
- `search`: optional string, trimmed; literal seller-name search remains SQL-owned.
- `page`: optional integer from 0 through 2147483647, default 0.
- `scope`: optional `page` (default) or `selection`. Selection is permitted only for `ready` and `action-required`; it returns the complete selectable matching set, independent of page offset.
- Explicit null or invalid values are rejected, not defaulted.

Success is exactly `{success:true, rows, counts, bucket, scope, page, pageSize, totalGroups, totalPages, selectedGroupCount, selectionComplete}` from the RPC. Pages contain 20 complete seller/run groups, not 20 shipment rows; SQL clamps pages and preserves History chronology. Selection completeness is validated, never synthesized. Unknown/malformed metadata or row field types fail closed. There is no legacy fallback after RPC errors.

Without `bucket`, the legacy search-only path and `{success:true,eligibleBatches,rejected,rows}` body remain unchanged, including literal ILIKE escaping and seller grouping. Legacy error statuses remain unchanged.

Errors return `{success:false,error}`. `AUTH_REQUIRED` is 401, `ADMIN_REQUIRED` is 403, and `MISSING_SERVER_CONFIG` is 500. New validation messages are `INVALID_QUEUE_BUCKET`, `INVALID_QUEUE_SEARCH`, `INVALID_QUEUE_PAGE`, `INVALID_QUEUE_SCOPE`, `QUEUE_SELECTION_NOT_ALLOWED` (400). `QUEUE_RPC_FAILED` and `INVALID_QUEUE_RESPONSE` are 502. Existing `PROFILE_LOOKUP_FAILED`, `RELEASE_QUEUE_LOOKUP_FAILED`, and `METHOD_NOT_ALLOWED` retain 400.

## Deployment verification

After maintainer deployment, verify authenticated admin page requests, a query with more than 20 groups, complete selection beyond page one, unauthorized rejection, and legacy responses. Verify effective RPC privileges separately. Offline injected-handler tests do not establish PostgreSQL runtime behavior, PostgREST caps, or deployed authorization.

This endpoint only reads. It creates no payouts, releases, transfers, retries or refunds; selection is not financial authorization. Existing financial action endpoints remain authoritative and unchanged.
