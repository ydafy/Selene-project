# Overdue held payout: keep holding with a note

`record-payout-hold-note` lets an admin keep an overdue held payout on hold and say why (#549, `odd/tasks/held-payout-overdue-refund.md`, S2). A shipment is overdue when it is completed, was never transferred, its seller's Stripe account cannot be paid, and 30 days or more have passed since `completed_at` (`admin_connect_payout_release_view.is_payout_overdue`). The function moves no money and changes no shipment, order or payout run. The RPC `fn_admin_record_payout_hold_note` appends a row to `shipment_payout_hold_notes` and a `PAYOUT_HOLD_NOTED` row to `admin_audit_logs`; the newest note reaches the admin queue as `latest_hold_note`, `latest_hold_noted_at` and `latest_hold_noted_by` (`get-connect-payout-release-queue`).

It serves the admin-web with `serveAdminWeb` and runs with `verify_jwt = false`; it authenticates the caller in code. It needs `SUPABASE_URL` and the `default` secret key from `SUPABASE_SECRET_KEYS`, and no new secret, cron or webhook. Deploy it after migration `20261115234100_payout_overdue_hold_notes`, which adds the RPC.

## Request

`POST` with a user access token in `Authorization: Bearer <token>`:

```json
{
  "shipment_id": "7b310000-0000-4000-8000-000000000011",
  "note": "Stripe sigue revisando la cuenta."
}
```

- `shipment_id`: a uuid.
- `note`: a string, trimmed; 1 to 1000 characters after trimming, counted as code points like SQL `char_length`.

The admin id is the verified caller, never a body field. Checks run in this order: method, token (401), active admin from `profiles_private.role` and `status` through `isActiveAdmin` (403), then the body (422), then the RPC.

## Response

200 with the stored note:

```json
{
  "id": "9c000000-0000-4000-8000-000000000001",
  "shipment_id": "7b310000-0000-4000-8000-000000000011",
  "note": "Stripe sigue revisando la cuenta.",
  "noted_at": "2026-11-14T05:27:34.123456+00:00",
  "noted_by": "00000000-0000-4000-8000-000000000001"
}
```

Each call appends a new note; a repeated call writes a second note and a second audit row.

Errors are `{ "error": "<code>" }`:

| Status | Code                  | When                                                                                |
| ------ | --------------------- | ----------------------------------------------------------------------------------- |
| 405    | `METHOD_NOT_ALLOWED`  | Not `POST`.                                                                         |
| 401    | `AUTH_REQUIRED`       | No bearer token, or the token is not a user session.                                |
| 403    | `ADMIN_ONLY`          | Not an active admin, also when the RPC re-check raises `ADMIN_REQUIRED`.            |
| 422    | `INVALID_SHIPMENT_ID` | `shipment_id` missing or not a uuid, or the body is not a JSON object.              |
| 422    | `INVALID_HOLD_NOTE`   | `note` missing, not a string, blank, or longer than 1000 characters after trimming. |
| 404    | `SHIPMENT_NOT_FOUND`  | No shipment with that id.                                                           |
| 409    | `PAYOUT_NOT_OVERDUE`  | The shipment is not overdue, for example held fewer than 30 days or already paid.   |
| 500    | `INTERNAL_ERROR`      | Any other failure: lookup, RPC or an unusable RPC result. Sentry receives the 5xx.  |

Raw database and Auth text goes only to the log; the note text is never logged.

## Checks

- `bun test supabase/functions/record-payout-hold-note`
- `deno check supabase/functions/record-payout-hold-note/index.ts`
- Bruno: `bruno/functions/record-payout-hold-note-*.bru` with `bun run functions:serve` (`supabase/functions/AGENTS.md`, "Bruno collection").
