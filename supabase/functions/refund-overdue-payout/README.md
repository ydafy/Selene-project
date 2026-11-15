# Overdue held payout: refund the buyer

`refund-overdue-payout` lets an admin refund the buyer of an overdue held payout when Stripe rejected the seller's account (#549, `odd/tasks/held-payout-overdue-refund.md`, S3, S4, S6). It is the one approved exception to "refunds only before a shipment is completed": only an admin, only when Stripe rejected the seller's account, only when no transfer of the shipment was ever started, and the Stripe refund must succeed before the database records the shipment as refunded.

It serves the admin-web with `serveAdminWeb` and runs with `verify_jwt = false`; it authenticates the caller in code. It needs `SUPABASE_URL`, the `default` secret key from `SUPABASE_SECRET_KEYS` and `STRIPE_SECRET_KEY`, and no new secret, cron or webhook. Apply these migrations, in this order, before deploying it:

1. `supabase/migrations/20261115234100_payout_overdue_hold_notes.sql` (the overdue flag in `admin_connect_payout_release_view`)
2. `supabase/migrations/20261115234200_overdue_payout_refund.sql` (`fn_claim_overdue_payout_refund`, `fn_complete_overdue_payout_refund`, the `admin_overdue_payout` source)
3. `supabase/migrations/20261115234300_overdue_refund_manual_resolution.sql` (manual repayment of a failed refund)

## Request

`POST` with a user access token in `Authorization: Bearer <token>`:

```json
{ "shipment_id": "7b310000-0000-4000-8000-000000000011" }
```

Only `shipment_id` is read. The client never sends an amount; any other field is ignored.

## What it does

Checks run in this order, and every refusal before step 6 stores nothing and creates no refund:

1. Method, token (401), active admin from `profiles_private.role` and `status` through `isActiveAdmin` (403), `shipment_id` (422).
2. The shipment from `admin_connect_payout_release_view` (404 when missing). If the shipment already has a started `admin_overdue_payout` operation, steps 3 to 5 are skipped and the run recovers it (see "Recovery").
3. Database checks, so a refusal never calls Stripe: the shipment is `completed`, `is_payout_overdue` is true, and the seller's stored `stripe_onboarding_status` is `rejected` with a connected account.
4. The connected account, read live from Stripe through the v1 API: `requirements.disabled_reason` must start with `rejected.` (`rejected.fraud`, `rejected.terms_of_service`, `rejected.listed`, `rejected.other`, ...). The stored `rejected` status is broader (it also covers reasons such as `under_review` that Stripe may lift), so it is not enough.
5. The PaymentIntent and its latest charge: only a `card` charge can be refunded here (Apple Pay and Google Pay are card charges; checkout accepts only cards, #567). OXXO cannot be refunded through Stripe and SPEI refunds need a bank account from the buyer.
6. `fn_claim_overdue_payout_refund` locks the shipment and re-checks everything above plus: no Stripe transfer or payout, no `transfer_started_at` in any payout run mapping, any run holding the shipment parked, no active operation of another source. It claims the shipment's `shipment_cancellation_operations` row, which is the fence `fn_begin_shipment_transfer` checks, and writes an `OVERDUE_PAYOUT_REFUND_CLAIMED` audit row.
7. The amount, on the server: the charge is read again and the refund is the shipment's item subtotal plus its proportional Seguro Selene share, the cancellation formula (`_shared/cancellation/refund-basis.ts`), capped by what the charge can still refund. The Stripe fee loss is the shipment's share of `orders.actual_stripe_fee_cents`; when the order has no fee yet, it is read from the charge's balance transaction and stored, as `cancel-order` does.
8. `fn_start_shipment_cancellation_refund` freezes the request (metadata `caller_role: 'admin'`, `shipment_id`, `order_id`, `reason: 'overdue_payout_seller_rejected'`, `seguro_share_cents`) and the fee loss, and checks the seller is still `rejected`.
9. The Stripe refund, with the idempotency key `cancel_shipment_<shipment_id>`.
10. `fn_record_shipment_cancellation_refund` records Stripe's answer. Only a recorded `succeeded` refund runs `fn_complete_overdue_payout_refund`: the shipment moves from `completed` to `refunded` (the order status follows), the fee loss and the label cost are recorded, payout run mappings that never transferred are closed, and the buyer gets the `shipment.refunded` notice.

A `pending` refund answers 202; the `refund.updated` webhook (`stripe-webhooks`, `fn_apply_shipment_cancellation_refund_event`) completes it when Stripe settles it. A `failed` refund answers 409 `REFUND_FAILED`: the money returns to Selene's balance, the buyer gets the refund-failed notice, the case is listed by `list-shipment-refund-problems`, and the admin repays the buyer by hand and records the reference with `resolve-shipment-refund` (L11).

## Recovery

The claim returns `recovery_required` for a started refund, whatever the shipment's eligibility now is. The run never creates a second refund: it reuses the recorded refund (and completes it once Stripe reports `succeeded`), finds the refund at Stripe by `metadata.shipment_id`, or, within 23 hours of the start, replays the frozen request with the same idempotency key, which Stripe answers with the original refund. Past 23 hours with no refund of the shipment at Stripe, the operation is escalated once (Sentry `CANCELLATION_REFUND_NOT_FOUND`, and it appears in the refund problems list) and the call answers 409 `REFUND_RECOVERY_REQUIRED`. Retrying after the escalation searches Stripe again and, when it still finds no refund of the shipment, replays the frozen request: an escalated overdue refund with no refund at Stripe is resolved by retrying this function, never by a manual repayment (L14). Two refunds of the same shipment at Stripe stay in recovery for a human.

A Stripe error before the start (the charge read) leaves only the claim, which expires after 15 minutes; until then a retry answers 409 `REFUND_IN_PROGRESS`. A Stripe error on the refund itself leaves the started operation, and the next call recovers it.

## Response

200 when the shipment is refunded, 202 while Stripe has the refund pending:

```json
{
  "status": "refunded",
  "shipment_id": "7b310000-0000-4000-8000-000000000011",
  "refund_id": "re_3Q...",
  "amount_cents": 10600
}
```

Errors are `{ "error": "<code>" }`:

| Status | Code                                     | When                                                                                    |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| 405    | `METHOD_NOT_ALLOWED`                     | Not `POST`.                                                                             |
| 401    | `AUTH_REQUIRED`                          | No bearer token, or the token is not a user session.                                    |
| 403    | `ADMIN_ONLY`                             | Not an active admin, also when the claim's re-check raises `ADMIN_REQUIRED`.            |
| 422    | `INVALID_SHIPMENT_ID`                    | `shipment_id` missing or not a uuid, or the body is not a JSON object.                  |
| 404    | `SHIPMENT_NOT_FOUND`                     | No shipment with that id.                                                               |
| 409    | `SHIPMENT_NOT_COMPLETED`                 | The shipment is not `completed`.                                                        |
| 409    | `SHIPMENT_ALREADY_REFUNDED`              | It was already refunded.                                                                |
| 409    | `PAYOUT_NOT_OVERDUE`                     | Not overdue: held fewer than 30 days, paid, or the seller is not blocked.               |
| 409    | `SELLER_ACCOUNT_NOT_REJECTED`            | The stored status is not `rejected`, or Stripe's `disabled_reason` is not `rejected.*`. |
| 409    | `PAYMENT_METHOD_NOT_REFUNDABLE`          | The charge is not a card.                                                               |
| 409    | `SHIPMENT_FUNDS_ALREADY_RELEASED`        | The shipment has a Stripe transfer or payout.                                           |
| 409    | `SHIPMENT_TRANSFER_OPERATION_ACTIVE`     | A payout run ever started its transfer.                                                 |
| 409    | `PAYOUT_RUN_NOT_PARKED`                  | A payout run holding the shipment is not parked.                                        |
| 409    | `SHIPMENT_CANCELLATION_OPERATION_ACTIVE` | Another operation (a cancellation) holds the shipment.                                  |
| 409    | `REFUND_AMOUNT_EXCEEDS_CAP`              | The charge cannot refund the shipment's amount any more.                                |
| 409    | `REFUND_IN_PROGRESS`                     | Another call holds the claim, or the claim expired before the start.                    |
| 409    | `REFUND_RECOVERY_REQUIRED`               | A started refund needs a human (see "Recovery").                                        |
| 409    | `REFUND_UNCONFIRMED`                     | Stripe's answer could not be tied to this shipment.                                     |
| 409    | `REFUND_FAILED`                          | Stripe reports the refund `failed` or `canceled`; repay by hand (L11).                  |
| 502    | `STRIPE_REQUEST_FAILED`                  | A Stripe call failed.                                                                   |
| 500    | `REFUND_COMPLETION_FAILED`               | Stripe refunded but the completion failed; Sentry alert, a retry completes it.          |
| 500    | `INTERNAL_ERROR` and other `REFUND_*`    | Any other server fault. Sentry receives every 5xx.                                      |

Raw database and Stripe text goes only to the log; logs carry ids and codes, never names, emails or addresses.

## Checks

- `bun test supabase/functions/refund-overdue-payout supabase/functions/_shared/cancellation`
- `deno check supabase/functions/refund-overdue-payout/index.ts`
- Bruno: `bruno/functions/refund-overdue-payout-*.bru` with `bun run functions:serve`, and the Stripe sandbox flow in `bruno/stripe-sandbox/` (`supabase/functions/AGENTS.md`, "Bruno collection").
