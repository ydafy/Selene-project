# Admin payout queue read endpoint

Manual deployment of `get-connect-payout-release-queue` is required before new clients use pagination. The maintainer reported applying `20261015065416_paginate_admin_payout_queue.sql`; generated types now contain `fn_get_admin_payout_queue`. Repository changes alone do not deploy the Edge Function. No agent deployment was performed. Existing server configuration requires `SUPABASE_URL` and the server-only secret key from `SUPABASE_SECRET_KEYS`; never send the latter to clients. No new secrets, cron or webhook configuration is required.

## Additive POST contract

Bearer authentication, `getUser`, and `profiles_private.role = admin` are required before queue reads. OPTIONS retains CORS support.

Presence of `bucket` enables RPC mode:

```json
{ "search": "Ada", "bucket": "ready", "page": 0, "scope": "page" }
```

- `bucket`: `ready`, `overdue`, `processing`, `action-required`, or `history` (required).
- `search`: optional string, trimmed; literal seller-name search remains SQL-owned.
- `page`: optional integer from 0 through 2147483647, default 0.
- `scope`: optional `page` (default) or `selection`. Selection is permitted only for `ready` and `action-required`; it returns the complete selectable matching set, independent of page offset. `overdue` cannot be selected: nothing in it can be released.
- Explicit null or invalid values are rejected, not defaulted.

Success is exactly `{success:true, rows, counts, bucket, scope, page, pageSize, totalGroups, totalPages, selectedGroupCount, selectionComplete}` from the RPC. `counts` has exactly the five keys `ready`, `overdue`, `processing`, `action-required` and `history`, each a non-negative integer; four keys, a sixth key or a bad value fails with `INVALID_QUEUE_RESPONSE`. Pages contain 20 complete seller/run groups, not 20 shipment rows; SQL clamps pages and preserves History chronology. Selection completeness is validated, never synthesized. Unknown/malformed metadata or row field types fail closed.

Each row carries `seller_payout_block_reason` (null or a string code, such as `payouts_disabled` or `onboarding_rejected`, explaining why the seller's account cannot be paid) and `days_since_completed` (null or an integer). Both are required keys; any string code passes, so a new account gate code still reaches the admin. They are display data: `is_eligible` and `ineligible_reason` still decide selection. Deploy this function only after the migration that adds both columns to `admin_connect_payout_release_view`, or every RPC-mode read fails with `INVALID_QUEUE_RESPONSE`. There is no legacy fallback after RPC errors.

## Overdue held payouts (#549)

A completed shipment that was never transferred, whose seller cannot be paid (`seller_payout_block_reason` set), and that has waited 30 days or more since `completed_at` is overdue. Every row carries four more required keys:

- `is_payout_overdue`: boolean, never null.
- `latest_hold_note`: the newest note an admin wrote through `record-payout-hold-note`, or null.
- `latest_hold_noted_at`: when that note was written, an ISO timestamp string, or null.
- `latest_hold_noted_by`: the admin who wrote it, a uuid, or null.

A missing key or a wrong type fails with `INVALID_QUEUE_RESPONSE`. A run-less overdue shipment leaves its seller's `ready` group for an `overdue` group of its own, so it is never released by mistake. An overdue shipment inside a payout run (for example a run parked because the account is not actionable) stays in its run group in `action-required` or `processing`, and its row carries `is_payout_overdue: true` so the admin can act on it there too.

Deploy together: migration `20261115234100_payout_overdue_hold_notes` and this function ship in the same release. The deployed function before this change accepts only four `counts` keys, so the migration alone breaks every RPC-mode read with `INVALID_QUEUE_RESPONSE`; this function alone fails the same way, because the RPC does not return `overdue` or the four row keys yet. Apply the migration, then deploy the function at once.

Without `bucket`, the legacy search-only path and `{success:true,eligibleBatches,rejected,rows}` body remain unchanged, including literal ILIKE escaping and seller grouping. Legacy error statuses remain unchanged.

Errors return `{success:false,error}`. `AUTH_REQUIRED` is 401, `ADMIN_REQUIRED` is 403, and `MISSING_SERVER_CONFIG` is 500. New validation messages are `INVALID_QUEUE_BUCKET`, `INVALID_QUEUE_SEARCH`, `INVALID_QUEUE_PAGE`, `INVALID_QUEUE_SCOPE`, `QUEUE_SELECTION_NOT_ALLOWED` (400). `QUEUE_RPC_FAILED` and `INVALID_QUEUE_RESPONSE` are 502. Existing `PROFILE_LOOKUP_FAILED`, `RELEASE_QUEUE_LOOKUP_FAILED`, and `METHOD_NOT_ALLOWED` retain 400.

## Deployment verification

After maintainer deployment, verify authenticated admin page requests, an `overdue` page, a query with more than 20 groups, complete selection beyond page one, unauthorized rejection, and legacy responses. Verify effective RPC privileges separately. Offline injected-handler tests do not establish PostgreSQL runtime behavior, PostgREST caps, or deployed authorization.

This endpoint only reads. It creates no payouts, releases, transfers, retries or refunds; selection is not financial authorization. Existing financial action endpoints remain authoritative and unchanged.
