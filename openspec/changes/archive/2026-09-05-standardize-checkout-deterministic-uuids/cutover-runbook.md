# Disposable Sandbox Cutover Runbook: Deterministic Checkout UUID v5

## Scope and Safety Boundary

This runbook is for the maintainer's disposable sandbox only. It changes the
checkout identifier compatibility contract: existing SHA-256-shaped order and
shipment identifiers cannot be reused after the UUID v5 producer deployment.

Do not run these steps in production. Do not apply a migration, run `bun
db:types`, rotate secrets, alter Stripe webhooks, or change Envia configuration.
This change has no schema or generated-type changes.

## Prerequisites

1. Confirm the selected Supabase project is the disposable sandbox.
2. Quiesce checkout traffic and verify there are no pending legacy
   `create-connect-payment` retries or Stripe webhook retries to preserve.
3. Verify the sandbox function already has these existing server-only secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_SECRET_KEY`
4. Do not log, export, or rotate any secret. No new configuration is required.

## Execution Order

### 1. Deploy the producer Edge Function

Deploy only `supabase/functions/create-connect-payment/index.ts` and its local
modules to the confirmed sandbox through the Supabase Dashboard deployment UI
or the maintainer's authenticated CLI workflow:

```sh
supabase functions deploy create-connect-payment --project-ref <confirmed-disposable-sandbox-project-ref>
```

Do not deploy confirmation, Stripe webhook, or Envia functions for this change.
The existing consumers keep their strict UUID validation and accept the new
producer UUID v5 values.

### 2. Reset disposable checkout data

Execute exactly one SQL file in the Supabase Dashboard SQL Editor, after the
producer deployment succeeds:

1. `supabase/queries/maintenance/reset-prelaunch-order-test-data.sql`

That file is the complete SQL unit: it executes
`TRUNCATE public.orders RESTART IDENTITY CASCADE` inside a transaction. Do not
replace it with hand-written table-by-table deletes or add a migration. Its
cascade is intentional and lets PostgreSQL clear checkout-dependent rows in
the correct relationship order.

### 3. Use fresh idempotency keys

Do not retry any pre-cutover key. Create a fresh sandbox buyer, fresh published
products, and a fresh checkout idempotency key after the reset. The new fixed
namespace is `7b0f4a20-5c30-4e0f-8f84-9a9f4b2e19c1`; it derives order groups
from `selene_order_group:${idempotencyKey}` and shipments from
`selene_shipment:${idempotencyKey}:product:${productId}`.

## Post-Deployment Verification

1. Create a checkout with at least two different products, including two from
   one seller when available.
2. Repeat the same checkout request with the same fresh idempotency key before
   confirmation. Verify Stripe returns the same PaymentIntent instead of a
   parameter-mismatch or duplicate PaymentIntent.
3. Inspect the resulting order group and every shipment ID. Each must be
   lowercase UUID v5 (version nibble `5`, RFC 4122 variant nibble one of
   `8`, `9`, `a`, or `b`).
4. Complete the normal sandbox payment webhook settlement. Verify exactly one
   shipment and one linked `order_item` exist for every purchased product, with
   a bijective product-to-shipment mapping.
5. Verify the order `stripe_transfer_group`, PaymentIntent transfer group, and
   metadata transfer group match the deterministic order group.
6. Progress a shipment through sandbox delivery and confirm it as the buyer.
   The strict confirmation validator must accept the producer-generated order
   and shipment identifiers.
7. Preserve the Stripe PaymentIntent ID, order ID, shipment IDs, and relevant
   function logs as deployment evidence.

## Rollback

1. Quiesce the disposable sandbox checkout.
2. Redeploy the prior `create-connect-payment` function revision.
3. Re-execute `supabase/queries/maintenance/reset-prelaunch-order-test-data.sql`
   in the Dashboard SQL Editor.
4. Restart sandbox testing only with fresh idempotency keys.

Do not attempt to mix pre-cutover PaymentIntents or persisted identifiers with
the UUID v5 producer. A production migration requires a separate approved
proposal and runbook.
