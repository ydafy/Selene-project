# Deployed Confirmation Evidence Harness

This harness sends four authenticated requests to a deployed `confirm-shipment-delivery` function. It is a maintainer-run remote check; local unit tests only verify the harness implementation and do not prove remote deployment, database state, or cron state.

## Stop before running

Do not run this against customer, production, shared, or reusable fixtures. Stop if any fixture is not a disposable buyer-owned fixture, if the function deployment is not explicitly confirmed, or if cron state has not been explicitly confirmed by the maintainer.

The harness does not create fixtures, query the database, modify cron, or perform cleanup. It only calls the deployed function. The delivered fixture is intentionally mutated from `delivered` to `completed`; prepare a new disposable fixture for every fresh run.

## Required fixture contract

Prepare three distinct disposable fixtures for the same authenticated buyer:

| Scenario | Required initial state | Expected result |
|---|---|---|
| Delivered | `delivered`, no active dispute | First request completes it; second request returns idempotent buyer success. |
| Shipped | `shipped`, no active dispute | HTTP 409 with `SHIPMENT_NOT_IN_CONFIRMABLE_STATE`. |
| Active dispute | `delivered`, unresolved dispute | HTTP 409 with `SHIPMENT_HAS_ACTIVE_DISPUTE`. |

Use an access token belonging to the buyer that owns all three fixture orders. Do not use a service-role key, an anon key, a cron secret, or a token copied into shell history.

## Invocation contract

Set these environment variables in the maintainer's secure shell. Values below are variable names only; never commit or paste their values into repository artifacts, tickets, or logs.

```text
CONFIRMATION_HARNESS_APPROVAL=I_CONFIRM_DISPOSABLE_FIXTURES
CONFIRM_SHIPMENT_DELIVERY_URL=https://<project-host>/functions/v1/confirm-shipment-delivery
CONFIRM_SHIPMENT_DELIVERY_BEARER_TOKEN=<buyer-access-token>
CONFIRMATION_DELIVERED_ORDER_ID=<disposable-order-uuid>
CONFIRMATION_DELIVERED_SHIPMENT_ID=<disposable-shipment-uuid>
CONFIRMATION_SHIPPED_ORDER_ID=<disposable-order-uuid>
CONFIRMATION_SHIPPED_SHIPMENT_ID=<disposable-shipment-uuid>
CONFIRMATION_ACTIVE_DISPUTE_ORDER_ID=<disposable-order-uuid>
CONFIRMATION_ACTIVE_DISPUTE_SHIPMENT_ID=<disposable-shipment-uuid>
```

Run from the repository root:

```text
bun scripts/confirm-shipment-delivery-harness.ts
```

Validation runs before network access. The URL must be HTTPS, contain no credentials/query/fragment, and end exactly in `/functions/v1/confirm-shipment-delivery`. Every ID must be an RFC UUID and each scenario must use a different shipment. The explicit approval value is required.

## Expected transcript and stop conditions

On success, the harness prints only these four lines:

```text
PASS shipped rejection
PASS active-dispute rejection
PASS delivered confirmation
PASS idempotent retry
```

It stops at the first unexpected response and does not continue to the delivered mutation after a negative-path failure. Do not rerun a failed harness against the same delivered fixture until the failure is understood. Capture only the scenario outcome, HTTP status, and error code for maintainer evidence; do not capture tokens or fixture IDs.

## Maintainer-only evidence

This harness cannot establish any of the following locally:

- deployed function revision and gateway/JWT configuration;
- remote fixture setup and post-request database rows;
- cron job existence, schedule, secrets, or activation state;
- provider delivery timestamps or payout behavior.

The maintainer must explicitly confirm those remote facts and record remote results separately. Local helper/unit evidence remains local evidence, even when this harness is present in the repository.
