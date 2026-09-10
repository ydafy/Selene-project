# Deployed Confirmation Evidence Harness

This harness sends authenticated requests to a deployed `confirm-shipment-delivery` function. Default `full` mode sends four requests; explicit `core` mode sends three while disputes are unavailable. It is a maintainer-run remote check; local unit tests only verify the harness implementation and do not prove remote deployment, database state, or cron state.

## Stop before running

Do not run this against customer, production, shared, or reusable fixtures. Stop if any fixture is not a disposable buyer-owned fixture, if the function deployment is not explicitly confirmed, or if cron state has not been explicitly confirmed by the maintainer.

The harness does not create fixtures, query the database, modify cron, or perform cleanup. It only calls the deployed function. The delivered fixture is intentionally mutated from `delivered` to `completed`; prepare a new disposable fixture for every fresh run. DB-prepared disposable fixtures support confirmation proof only; they do not provide Envia tracking end-to-end evidence.

## Required fixture contract

In `full` mode (the default), prepare three distinct disposable fixtures for the same authenticated buyer:

| Scenario | Required initial state | Expected result |
|---|---|---|
| Delivered | `delivered`, no active dispute | First request completes it; second request returns idempotent buyer success. |
| Shipped | `shipped`, no active dispute | HTTP 409 with `SHIPMENT_NOT_IN_CONFIRMABLE_STATE`. |
| Active dispute | `delivered`, unresolved dispute | HTTP 409 with `SHIPMENT_HAS_ACTIVE_DISPUTE`. |

Use an access token belonging to the buyer that owns all three fixture orders. Do not use a service-role key, an anon key, a cron secret, or a token copied into shell history.

Do not fabricate an active dispute merely to run this harness. While the disputes module is unavailable, use `core` mode with only distinct delivered and shipped fixtures. It proves the shipped rejection, buyer completion, and idempotent retry. Rerun `full` mode after the disputes work is available.

## Core fixture preparation

Use one new disposable sandbox order containing two products. Current settlement creates one shipment per purchased product, so the order supplies two distinct shipment IDs even when both products have the same seller. The authenticated buyer must own the order. Both core-mode order ID variables may therefore contain the same order ID.

Tracking verification is outside this harness. When tracking has already been verified independently, prepare the core fixtures in the Supabase SQL Editor instead of replaying provider events. Direct status preparation is valid only as confirmation-harness fixture setup; it must not be reported as Envia evidence.

Run this transaction manually with disposable IDs only. It requires Connect-backed shipments so confirmation does not exercise the deprecated wallet branch. It also rejects completed, buyer-confirmed, or disputed fixtures.

```sql
begin;

do $$
declare
  shipped_updated integer;
  delivered_updated integer;
begin
  update public.shipments as shipment
  set status = 'shipped',
      updated_at = now()
  where shipment.id = '<shipped-shipment-uuid>'
    and shipment.order_id = '<disposable-order-uuid>'
    and shipment.stripe_payment_intent_id is not null
    and shipment.completed_at is null
    and shipment.buyer_confirmed_at is null
    and not exists (
      select 1
      from public.disputes as dispute
      where dispute.shipment_id = shipment.id
        and dispute.status not in ('resolved', 'rejected')
    );
  get diagnostics shipped_updated = row_count;

  if shipped_updated <> 1 then
    raise exception 'Expected exactly one shipped fixture, updated % rows', shipped_updated;
  end if;

  update public.shipments as shipment
  set status = 'delivered',
      delivered_at = coalesce(shipment.delivered_at, now()),
      updated_at = now()
  where shipment.id = '<delivered-shipment-uuid>'
    and shipment.order_id = '<disposable-order-uuid>'
    and shipment.stripe_payment_intent_id is not null
    and shipment.completed_at is null
    and shipment.buyer_confirmed_at is null
    and not exists (
      select 1
      from public.disputes as dispute
      where dispute.shipment_id = shipment.id
        and dispute.status not in ('resolved', 'rejected')
    );
  get diagnostics delivered_updated = row_count;

  if delivered_updated <> 1 then
    raise exception 'Expected exactly one delivered fixture, updated % rows', delivered_updated;
  end if;
end $$;

select id, order_id, status, shipped_at, delivered_at
from public.shipments
where id in ('<shipped-shipment-uuid>', '<delivered-shipment-uuid>')
order by status;

commit;
```

The transaction fails and rolls back if either fixture update does not affect exactly one row. The `select` must show one `shipped` and one `delivered` row before you run the harness. The delivered fixture becomes `completed` after the harness runs, so never reuse it.

## Invocation contract

Set these environment variables in the maintainer's secure shell. Values below are variable names only; never commit or paste their values into repository artifacts, tickets, or logs.

```text
CONFIRMATION_HARNESS_APPROVAL=I_CONFIRM_DISPOSABLE_FIXTURES
CONFIRMATION_HARNESS_MODE=full
CONFIRM_SHIPMENT_DELIVERY_URL=https://<project-host>/functions/v1/confirm-shipment-delivery
CONFIRM_SHIPMENT_DELIVERY_BEARER_TOKEN=<buyer-access-token>
CONFIRMATION_DELIVERED_ORDER_ID=<disposable-order-uuid>
CONFIRMATION_DELIVERED_SHIPMENT_ID=<disposable-shipment-uuid>
CONFIRMATION_SHIPPED_ORDER_ID=<disposable-order-uuid>
CONFIRMATION_SHIPPED_SHIPMENT_ID=<disposable-shipment-uuid>
CONFIRMATION_ACTIVE_DISPUTE_ORDER_ID=<disposable-order-uuid>
CONFIRMATION_ACTIVE_DISPUTE_SHIPMENT_ID=<disposable-shipment-uuid>
```

To use core mode, set `CONFIRMATION_HARNESS_MODE=core` and omit both `CONFIRMATION_ACTIVE_DISPUTE_*` variables. The mode defaults to `full`; the only valid values are `core` and `full`.

Run from the repository root:

```text
bun scripts/confirm-shipment-delivery-harness.ts
```

Validation runs before network access. The URL must be HTTPS, contain no credentials/query/fragment, and end exactly in `/functions/v1/confirm-shipment-delivery`. Every required ID must be an RFC UUID and each selected scenario must use a different shipment. The explicit approval value is required.

## Expected transcript and stop conditions

In full mode, success prints these four lines:

```text
PASS shipped rejection
PASS active-dispute rejection
PASS delivered confirmation
PASS idempotent retry
```

In core mode, success omits `PASS active-dispute rejection`.

It stops at the first unexpected response and does not continue to the delivered mutation after a negative-path failure. Do not rerun a failed harness against the same delivered fixture until the failure is understood. Capture only the scenario outcome, HTTP status, and error code for maintainer evidence; do not capture tokens or fixture IDs.

## Maintainer-only evidence

This harness cannot establish any of the following locally:

- deployed function revision and gateway/JWT configuration;
- remote fixture setup and post-request database rows;
- cron job existence, schedule, secrets, or activation state;
- provider delivery timestamps or payout behavior.

The maintainer must explicitly confirm those remote facts and record remote results separately. Local helper/unit evidence remains local evidence, even when this harness is present in the repository.
