# Shipment cancellation coordination — B1.1

## Scope and current state

This is a dormant SQL foundation, not an enabled cancellation fix. Existing manual/cron handlers, label generation and Connect release do not call these RPCs yet. B1.2 integrates cancellation callers; B1.3 makes label/transfer writers participate in the same shipment lock; B1.4 verifies the integrated behavior. Stored label/transfer checks alone do not exclude another writer's in-flight provider call.

No refund is created or recorded here. No shipment/order status, inventory, notification, allocation or loss is changed. Preparing-timeout acquisition does not prove carrier cancellation is safe (B4). B2 extends this same operation with refund identity/status and recovery; do not create a second refund subsystem.

## Small SQL contract

`shipment_cancellation_operations` contains one row per shipment, protected by RLS and without direct grants to client or service roles. Two `SECURITY DEFINER` functions have an empty search path, check `auth.role()`, and grant execution only to `service_role`:

| RPC                              | Inputs                                                                 | Result                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_claim_shipment_cancellation` | Shipment UUID, order UUID, actor UUID or null, source, nonblank reason | JSON `status`, stable `operation_key`, original `source`, `actor_id`, `reason`; only `claimed` includes owner `claim_token` and `claim_expires_at`. |
| `fn_start_shipment_cancellation` | Shipment UUID, owner token UUID                                        | `true` only on the first permitted write-ahead start; all other attempts raise an error.                                                            |

Sources `buyer`/`seller` require the corresponding owner and a `paid` shipment. `paid_timeout` requires a null actor and `paid`; `preparing_timeout` requires a null actor and `preparing`. The future trusted cron caller still owns settings-driven timeout validation. The future manual handler still owns authenticated-user resolution and the maintenance gate. These RPCs are not user-callable endpoints.

Both functions lock the shipment first, reject persisted transfer/payout references, and reject label states `claimed`, `generation_sent`, `orphan_pending` (also inconsistent `paid` + `generated`). Start rechecks state/blockers after claim. A generated label in `preparing` is deliberately not treated as a generation in flight; B4 owns the required carrier evidence and outcome before any refund in that path.

### Ownership and uncertainty

1. The first claim creates `cancel_shipment_{shipmentId}`, original source/actor/reason, an opaque owner token and a fixed 15-minute lease.
2. A second live claim returns `busy`, without an owner token or any mutation.
3. An expired **pre-start** lease may rotate its owner token. It preserves the first source/actor/reason/key. The old worker can no longer start.
4. Before an external call, the owner must persist `external_started_at` through start. Expired or mismatched ownership is rejected. Lease checks use the live database clock, not a transaction-start timestamp.
5. Once marked, repeated start raises an error and further claims return `recovery_required`, even after the lease expires. No TTL or automatic release authorizes another call.

The write-ahead mark proves only that a call **might** start, not Stripe success. A crash before sending still needs recovery, rather than blindly reopening the attempt. The caller must not call Stripe after a failed or uncertain start response. Start must commit before the provider call; do not hold a database transaction open over the network. Never log tokens.

B1.2 must persist/freeze the reconstructed provider request (including amount and payment identity) before using this foundation for money movement. A shared Stripe key with changing parameters is not sufficient. B1.1 does not claim that persistence or B2 recovery is implemented. There is intentionally no release, completion or refund-status RPC yet.

### Errors

Claim/start reject with `UNAUTHORIZED`, `SHIPMENT_NOT_FOUND`, `SHIPMENT_ORDER_MISMATCH`, `SHIPMENT_NOT_CANCELABLE`, `SHIPMENT_FUNDS_ALREADY_RELEASED` or `SHIPMENT_LABEL_OPERATION_ACTIVE` as applicable. Claim additionally rejects `INVALID_CANCELLATION_CONTEXT`, `ORDER_BUYER_MISMATCH` and `SHIPMENT_SELLER_MISMATCH`. Start additionally rejects `STALE_CANCELLATION_CLAIM`, `CANCELLATION_CLAIM_EXPIRED` and `CANCELLATION_EXTERNAL_ALREADY_STARTED`. Privilege denial can occur before the function body. Errors do not commit partial mutations.

## Local verification

Prerequisite: the existing [local PostgreSQL environment](postgres-test-harness.md), running on a local Docker engine. No new infrastructure or JavaScript dependency is needed.

```sh
bun run db:test:up
bun scripts/test-shipment-cancellation-coordination.ts --help
bun scripts/test-shipment-cancellation-coordination.ts
bun test scripts/test-shipment-cancellation-coordination.test.ts
```

The executable harness only accepts a port override (`SELENE_TEST_PG_PORT`, default 55432), pins host/database credentials to the local test environment, and ignores application connection variables. It creates a uniquely named `b11_<uuid>` database, a minimal shipment/order schema and an `auth.role()` stub. It applies the exact migration/canonical SQL, not a TypeScript reimplementation. It creates non-login `anon`, `authenticated`, `service_role` stubs only when absent; a local advisory lock serializes ownership across runs. It removes only its generated database and roles it created. Never point a proxy at this loopback port to a remote database.

The tests exercise public RPC ownership, frozen context, expired pre-call takeover, stale tokens, post-start uncertainty, state/role guards, service-role execution, denied direct writes and sibling isolation. For real contention A calls claim inside a transaction and keeps its shipment lock; B must receive SQLSTATE `55P03` under a bounded lock timeout. After A commits, B returns `busy` without a second owner. The lease-expiry tests use explicit synthetic timestamp fixtures, not a 15-minute sleep. No provider calls are made.

Plain `bun test` runs only offline CLI/mirror checks and does not require Docker. The standalone live harness fails with nonzero exit on unavailable PostgreSQL, assertion failure or cleanup failure; it never turns unavailable execution into a passing skip. Its minimal schema/auth stub is not proof of the full deployed schema, Supabase JWT/gateway behavior, real cron, Envia or Stripe behavior. Integrated and deployed checks remain separate.

## Deployment handoff — maintainer only

Repository verification does not establish remote deployment. No remote operation is authorized by this document.

1. When separately approved, apply **only** `supabase/migrations/20261016011954_shipment_cancellation_coordination.sql`. `supabase/queries/orders/shipment_cancellation_coordination.sql` is an identical canonical copy, **not a second script to run**. This additive migration is intended to run once; use normal migration bookkeeping rather than replaying its table creation.
2. No Edge Functions, new secrets, cron jobs or webhooks need deployment for B1.1. Do not switch any existing handler to these RPCs yet.
3. After the maintainer confirms SQL was applied, run `bun db:types`. Verify the new table and both RPC signatures are generated. Do not hand-edit types or claim the current generated types include these undeployed objects.
4. Inspect the deployed table's RLS, function grants/search paths and signatures. Any remote runtime checks require separately authorized disposable fixtures. Preserve the old handler behavior until the next scoped integration.

There is no backfill of existing shipments or cancellation attempts. These rows are created only by future callers. B1.1 completion means locally verified repository preparation; deployment/type synchronization is reported separately, not silently treated as completed.
