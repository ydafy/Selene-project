# Exploration: standardize-checkout-deterministic-uuids

> Read-only audit of the deterministic order/shipment identifier pipeline in
> `create-connect-payment`. Reconstructs the producer chain (SHA-256 → hex →
> UUID), enumerates every consumer (Zod schemas, RFC regex, webhook, SQL,
> frontend), classifies compatibility boundaries, and proposes a bounded
> remediation that keeps Stripe idempotency and the one-shipment-per-product
> invariant intact.

## Scope

In scope:

- Producer: `hexToUuid`, `deriveOrderGroupId`, `deriveShipmentId`,
  `buildCheckoutIdentifiers`, `buildTransferGroup`, `buildSinglePaymentIntentParams`
  in `supabase/functions/create-connect-payment/single-payment-builder.ts`.
- Producer's orchestrator: `supabase/functions/create-connect-payment/index.ts`
  (Stripe PaymentIntent create body stability).
- Consumers that fail today:
  - `supabase/functions/confirm-shipment-delivery/index.ts` (Zod `.uuid()`).
  - `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.ts`
    (strict regex `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).
- Consumers that already accept any UUID format:
  - `supabase/functions/stripe-webhooks/single-modal-settlement.ts`
    (reassembles `order_id` / `shipment_id` from PI metadata).
  - `supabase/queries/orders/fn_create_shipments_from_single_payment.sql`,
    `checkout_recovery.sql`, `fn_confirm_shipment_delivery.sql`,
    `fn_cancel_order.sql`, `fn_cancel_shipment.sql`, `fn_create_order_from_payment.sql`.
  - `supabase/queries/disputes/*.sql` (read `order_id`/`shipment_id`).
  - All `Tables<'orders'>` / `Tables<'shipments'>` consumers in
    `apps/frontend`, `apps/admin-web`, `packages/types/src/database.types.ts`
    (no Zod `.uuid()` is called on these IDs anywhere in the frontend).
- Existing recovery design: `sdd/paid-but-unfulfillable-checkout-recovery/design`
  (Engram #935) which already requires `bijection between requested product
  IDs and allocation rows: each row has one product and a unique deterministic
  shipment ID`. Must remain invariant.
- Tests: `supabase/functions/create-connect-payment/single-payment-builder.test.ts`,
  `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts`.

Out of scope (this change will NOT touch):

- Stripe Connect transfer/payout mechanics (only read).
- Envia / shipping label / tracking generation.
- Dispute resolution, refund, cancellation flows.
- The locally-dirty worktree (uncommitted edits to `apps/frontend/**`, the
  dropped `supabase/queries/orders/fn_confirm_delivery.sql`, the
  in-progress `confirm-shipment` change artifacts).
- Remote operations (SQL apply, Edge Function deploy, `bun db:types`,
  cron / Vault / Stripe / Envia). Maintainer-owned per AGENTS.md §Supabase
  Deployment Workflow.
- Configuration changes (ESLint / TS / bun / test / CI / Husky).
- Renaming the producer functions or restructuring the build pipeline.

## Current State

### The producer

`supabase/functions/create-connect-payment/single-payment-builder.ts:209-251`
implements the SHA-256-as-UUID pipeline:

```ts
function hexToUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
export function deriveOrderGroupId(idempotencyKey: string): string {
  return hexToUuid(sha256Hex(`selene_order_group:${idempotencyKey}`));
}
export function deriveShipmentId(idempotencyKey: string, productId: string): string {
  return hexToUuid(sha256Hex(`selene_shipment:${idempotencyKey}:product:${productId}`));
}
```

The output is a 36-character hyphenated hex string of the form
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` — but the 13th hex character (the
version nibble) and the 17th hex character (the variant nibble) are
**uniformly random SHA-256 bits**. RFC 4122 requires:

- Version nibble ∈ `{1,2,3,4,5}` (only ~31.25 % of SHA-256 outputs satisfy this).
- Variant nibble high 2 bits = `10` → first hex char ∈ `{8,9,a,b}`
  (only ~25 % of SHA-256 outputs satisfy this).

Combined, only ~1 of every ~12.8 hashes passes both checks by coincidence. The
rest are "UUID-shaped but not RFC-4122-compliant" — accepted by Postgres's
`uuid` type (FORMAT-only validator), but rejected by every RFC-strict
consumer.

The producer comment at line 200-208 explicitly acknowledges this:

> Format a 32-hex-char (128-bit) string as an RFC-4122-style UUID
> (8-4-4-4-12). The Postgres `uuid` column type validates FORMAT only, not
> version/variant bits, so a deterministic hash-derived 128-bit value is
> accepted.

The intent (per Engram #1236) was byte-stable PaymentIntent bodies for
Stripe idempotency-key reuse, not a non-RFC format. The non-RFC format is
an unintended side-effect that breaks downstream RFC validators.

### The producer's byte-stability contract

`buildSinglePaymentIntentParams` (lines 421-503) normalizes the allocation
rows by `sellerId` ascending, sorts `productIds` per row, and embeds the
resulting JSON via `chunkAllocationJson` into PI metadata. The combined
guarantee: for a given `(idempotency key, product set, seller set)`,
the PI create body is byte-identical across retries, so Stripe's request
idempotency (`selene_pi_<idempotencyKey>` at line 417) returns the
existing PI instead of minting a duplicate.

This contract MUST be preserved: any fix must produce a deterministic,
idempotency-stable identifier per `(idempotencyKey, role)` pair.

### The failing consumers

1. **`supabase/functions/confirm-shipment-delivery/index.ts:19-30`** uses
   Zod 3.23.8's `z.string().uuid()` for `orderId` and `shipmentId`.
   Zod's `.uuid()` validator (v3.x) requires RFC 4122 version 1–5 +
   variant `10xx`. Roughly 1/12.8 of the current outputs pass.

2. **`supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.ts:11-12`**
   applies a strict custom regex as a defence-in-depth validator inside
   `parseConfirmationRequestBody`:
   ```
   /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
   ```
   Even if Zod were loosened, this regex still rejects non-RFC IDs.

The fresh-sandbox smoke test (Engram #1237) reached delivery and exposed
confirmation, but confirmation failed with `INVALID_REQUEST` because the
backend rejected the request body before any DB lookup.

### The passing consumers (no RFC check)

- `supabase/functions/stripe-webhooks/single-modal-settlement.ts:319-321`:
  reads `metadata.order_id` / `metadata.order_group_id` as plain strings
  and casts with `(p_allocation ->> 'order_id')::UUID` (Postgres FORMAT-only).
- All `supabase/queries/orders/*.sql` and `supabase/queries/disputes/*.sql`
  use `UUID` columns with no version/variant CHECK constraint.
- The frontend (`apps/frontend/**`, `apps/admin-web/**`) never calls
  `z.string().uuid()` on `orderId` or `shipmentId`. Confirmed by grep
  (`apps/frontend/.uuid() ` returned zero matches).
- `packages/types/src/{index,database.types}.ts` types `Orders.id` and
  `Shipment.id` as plain `string` (the Postgres-generated UUID column type).

### Tests pinning the current contract

- `single-payment-builder.test.ts:629-636` rebuilds the expected UUID from
  raw SHA-256 hex (no RFC patch) and asserts exact equality:
  ```ts
  const expectedHex = createHash('sha256')
    .update('selene_shipment:shared-key:product:product_gpu', 'utf8')
    .digest('hex');
  const expected = `${expectedHex.slice(0, 8)}-...`;
  expect(deriveShipmentId('shared-key', 'product_gpu')).toBe(expected);
  ```
  This test MUST be updated to expect the RFC-patched output.

- `single-payment-builder.test.ts:638-649` asserts the relaxed RFC shape
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`
  (which accepts any hex in the version/variant positions). This test
  remains green under the patched algorithm.

- `confirm-shipment-delivery.test.ts:11-13` already uses hand-crafted
  RFC-4122-compliant fixtures (`11111111-1111-4111-8111-111111111111` is
  v4 variant-`8`, version=`4`, etc.). These pass the regex today; they
  remain valid after the producer fix and do not need changes.

- `confirm-shipment-delivery.test.ts:34-43` exercises rejection paths for
  non-RFC IDs and for cross-shipment idempotency keys. These continue to
  pass because the rejection semantics are unchanged.

### Migration boundary (disposable sandbox)

Per Engram #1237: "sandbox data is disposable and maintainers perform remote
Supabase / Stripe / Envia operations manually". Per Engram #1236: "non-RFC
hash-shaped IDs were introduced to keep order/shipment IDs and Stripe
PaymentIntent bodies byte-stable across retries".

Implication: any change to the producer alters the IDs generated for every
future checkout. Old in-flight PIs and old `orders`/`shipments` rows will
retain their hash-as-UUID format. For a disposable sandbox, the cleanup is:

1. Maintainer drops test data (`TRUNCATE orders, shipments, order_items,
   wallet_transactions, disputes, connect_payout_run_shipments,
   shipment_tracking_events, checkout_recovery_shells, notifications
   CASCADE`) — no schema migration required because `orders.id` and
   `shipments.id` remain `UUID` columns that accept any RFC-4122 version.
2. New orders / shipments / PIs use the new RFC-4122 v5 IDs.
3. Old orders / shipments can no longer be confirmed because their IDs
   still fail the regex — but in a disposable sandbox, none survive.
4. `bun db:types` is maintainer-owned per AGENTS.md §Supabase Deployment
   Workflow and does not regenerate new column types (no schema change).

For production (out of scope), this would require a CASCADE backfill of
`orders.id`, `shipments.id`, and ~12 referencing tables, which is
invasive enough to belong in its own change.

## Affected Areas

- `supabase/functions/create-connect-payment/single-payment-builder.ts:209-251`
  — producer (the only file that needs code changes). `hexToUuid` is the
  chokepoint: every deterministic ID flows through it. Must gain RFC 4122
  version=5 + variant=`10xx` bit-patching.
- `supabase/functions/create-connect-payment/single-payment-builder.test.ts:629-649`
  — must update the SHA-256→UUID equality test (line 635) to expect the
  RFC-patched hex, and add new tests asserting version=5, variant=`[89ab]`,
  Zod-acceptance, and Stripe-body byte-stability on retry.
- `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts`
  — add a contract test that derives an ID via the producer
  (`deriveOrderGroupId` / `deriveShipmentId`) and asserts
  `parseConfirmationRequestBody` accepts it (closes the checkout→confirmation
  contract gap that Engram #1237 exposed).
- `apps/frontend/core/utils/shipment-confirmation.ts`
  — read-only verification: the payload builder is already agnostic
  about UUID format. No change needed.
- `supabase/functions/stripe-webhooks/single-modal-settlement.ts`
  — read-only verification: reassembles via `(p_allocation ->> 'order_id')::UUID`
  which Postgres accepts for any RFC-4122 format. No change needed.
- `supabase/queries/orders/*.sql`, `supabase/queries/disputes/*.sql`
  — read-only verification: column types remain `UUID` and Postgres
  FORMAT-only validators accept any RFC-4122 v1–v5 ID. No change needed.
- `packages/types/src/{index,database.types}.ts`
  — read-only verification: types are `string`. No change needed unless the
  maintainer decides to add a `version: 5` discriminator (not recommended;
  over-coupling types to a presentation detail).
- `apps/frontend`, `apps/admin-web` — read-only verification: no Zod `.uuid()`
  calls on `orderId` / `shipmentId`. No change needed.
- `openspec/specs/single-modal-multiseller-checkout/spec.md` — should add
  a delta requirement asserting deterministic IDs are RFC-4122 v5 in the
  propose / spec phase. Out of scope for exploration.

## Approaches

### 1. Bit-patch the SHA-256 output to RFC 4122 v5 (recommended)

Replace `hexToUuid(hex32)` with a version that sets the version nibble to
`5` (UUID v5) and the variant nibble's high two bits to `10` (variant 1 /
RFC 4122 standard). Everything else is left untouched.

```
hex[12] = '5'
hex[16] = (0x8 | (parseInt(hex[16], 16) & 0x03)).toString(16)
```

Pseudocode in TS:

```ts
function hexToRfc4122V5Uuid(hex32: string): string {
  const chars = hex32.split('');
  chars[12] = '5';                       // version = 5
  const variantNibble = parseInt(chars[16], 16);
  chars[16] = (0x8 | (variantNibble & 0x03)).toString(16); // variant 10xx
  return `${chars.slice(0,8).join('')}-${chars.slice(8,12).join('')}-${chars.slice(12,16).join('')}-${chars.slice(16,20).join('')}-${chars.slice(20,32).join('')}`;
}
```

- Pros:
  - **Byte-stable PI body**: same idempotency key + same cart ⇒ same
    patched hex ⇒ same `transfer_group`, `metadata.order_id`,
    `metadata.shipment_id`. Stripe request idempotency continues to
    return the existing PI.
  - **RFC 4122 v5 compliant**: passes Zod `.uuid()` AND the strict
    `parseConfirmationRequestBody` regex.
  - **No new dependencies**: stays in `node:crypto` / Deno's Web Crypto.
    Works in the existing `bun test` runner (no esm.sh shim).
  - **Collision resistance preserved**: SHA-256's 128-bit effective
    collision space minus 8 bits (4 version + 4 variant bits, which
    are now derived deterministically) — still 120 bits, well above
    any practical attack threshold for this codebase.
  - **Minimal blast radius**: one helper function changes; all downstream
    consumers already accept any RFC-4122 v1–v5 format.
- Cons:
  - Not a "true" UUID v5 (which uses SHA-1 of `namespace || name`). The
    bit-patched SHA-256 hybrid is RFC-4122-compliant by the standard's
    definition (version/variant bits set correctly) but not generated
    via the RFC-4122 v5 algorithm. The standard explicitly leaves
    generation algorithms open for v5-compatible implementations as
    long as version + variant bits are valid.
  - "Hash-shaped" branding lingers in code comments. Mitigation: update
    the docstring to document the bit-patch and link to RFC 4122 §4.3.
- Effort: **Low**.

### 2. Replace with true UUID v5 via the `uuid` npm package

Use `uuidv5(namespace, name)` from the `uuid` library (RFC 4122 v5 =
SHA-1(`namespace || name`)). Import via esm.sh in Deno.

- Pros:
  - Standards-compliant in the strictest reading of RFC 4122 §4.3.
  - Library library with explicit version semantics.
- Cons:
  - **Hash algorithm switch** (SHA-256 → SHA-1): every byte of every ID
    changes for the same input. This breaks the existing tests'
    expected hex; it also means the Stripe PI body changes for any
    input that was ever validated under SHA-256 (no in-flight PIs
    benefit from idempotency-key reuse).
  - **Lower collision resistance**: SHA-1 is 160-bit nominal but
    ~63-bit after v5's fixed bits, versus SHA-256's ~120-bit after
    patching. Not a real-world risk for Selene's volume but still a
    regression.
  - **New dependency**: must `import { v5 as uuidv5 } from 'uuid'` via
    esm.sh; adds a runtime dependency to `create-connect-payment` and
    forces every test fixture to either import the same shim or
    hardcode v5 outputs.
  - **Slower** than direct SHA-256 (extra layer + JSON-over-HTTP via
    esm.sh on cold start).
- Effort: **Medium**.

### 3. Loosen the consumer regex / Zod schema only

Reduce the strict regex to `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
and drop Zod's `.uuid()` in favour of `.min(36).max(36)` with a relaxed
pattern. Preserves the producer unchanged.

- Pros:
  - One-line change in two files.
  - Lowest producer risk.
- Cons:
  - **Treats symptom, not cause**: the producer still emits
    hash-shaped IDs that are formally UUID-invalid. Any future code
    path that uses Zod's `.uuid()` (e.g., a new Edge Function or RPC
    argument) re-encounters the same rejection.
  - **Weakens the contract**: the strict regex and Zod `.uuid()` were
    added precisely to validate UUID format. Loosening them
    re-introduces the silent acceptance of malformed IDs.
  - The test that asserts `parseConfirmationRequestBody` rejects
    `orderId: 'order-1'` (line 36) still passes (correctly), but the
    **acceptance** test for valid IDs would need to weaken too.
- Effort: **Low**. **Not recommended.**

### 5. Hybrid: bit-patch the producer AND loosen the consumer's variant regex

Bit-patch (approach 1) + relax `parseConfirmationRequestBody`'s regex
from `[89ab]` to `[0-9a-f]` (accept all variants).

- Pros:
  - Forward-compatible with any future RFC 4122 v6–v8 UUIDs the
    platform could mint.
  - Belt-and-braces: producer and consumer both permissive.
- Cons:
  - Doubles the change surface without solving a real problem
    (Selene's codebase does not generate v6–v8 IDs anywhere).
  - Future-proofing YAGNI; the only consumer that cares is
    `parseConfirmationRequestBody`, and once approach 1 lands it
    always sees v5 IDs anyway.
- Effort: **Low**. **Not recommended** unless a v6/v8 producer
  appears in another change.

### 4. Replace `deriveShipmentId` with `uuid.v4()` and abandon determinism on the per-product path

Use the injected `randomUuid()` callback (already present in
`buildCheckoutIdentifiers` for the no-idempotency-key path) for the
shipment-id path too.

- Pros:
  - Simple.
- Cons:
  - **Breaks the recovery contract** (Engram #935): "Keep one charge
    and one allocation/shipment per product. Before
    `paymentIntents.create`, assert a bijection between requested
    product IDs and allocation rows: each row has one product and a
    unique deterministic shipment ID." Random shipment IDs cannot
    guarantee uniqueness per product across retries.
  - **Breaks Stripe idempotency-key reuse on the per-product side**:
    a retry with the same idempotency key but a freshly random
    shipment ID produces a different PI metadata body → Stripe
    rejects idempotency-key reuse.
  - **Breaks `one shipment per product`** invariant: the random path
    could produce collisions across products (vanishingly unlikely
    but contractually not zero).
- Effort: **N/A — rejected**.

## Recommendation

**Approach 1 — bit-patch the SHA-256 output to RFC 4122 v5** in
`hexToUuid` (rename to `hexToRfc4122V5Uuid` for clarity, or add a new
helper next to it). Update the producer comment to cite RFC 4122 §4.3
and document the bit-patch. Update the byte-equality test
(`single-payment-builder.test.ts:629-636`) to expect the patched hex,
and add three new focused tests:
  1. `deriveOrderGroupId` / `deriveShipmentId` outputs always have
     `chars[12] = '5'` and `chars[16] ∈ [89ab]`.
  2. Outputs pass `z.string().uuid()` (imported in the test).
  3. Outputs pass `parseConfirmationRequestBody`'s regex (imported from
     `confirm-shipment-delivery.ts`; this is the missing checkout →
     confirmation contract test the user explicitly asked for).
  4. Stripe PI body byte-stability: calling `buildSinglePaymentIntentParams`
     twice with the same `(idempotencyKey, productIds, sellerIds)`
     produces deep-equal `metadata` including the `transfer_group`,
     `order_id`, and `allocation_json_*` keys.

This is the smallest complete change that preserves every existing
invariant:

- **Stripe idempotency**: byte-stable PI body, same idempotency key
  returns same PI.
- **PaymentIntent request/body stability**: identical metadata blob
  on the same input.
- **One shipment per product**: same `(idempotencyKey, productId)`
  yields the same `shipmentId`, no collisions.
- **Checkout recovery** (Engram #935): bijection between requested
  product IDs and allocation rows still holds because each row's
  `shipmentId` is still a deterministic function of the same inputs.

And it makes every consumer (Zod, regex, webhook, SQL, frontend)
accept the new IDs without further changes.

## Risks

- **Producer algorithm change breaks retry idempotency for in-flight PIs**:
  any PI created before this change cannot benefit from idempotency
  on a retry that uses the new algorithm (the new metadata has
  patched bits in the version/variant positions of `order_id` /
  `shipment_id`). Mitigation: this is acceptable for the disposable
  sandbox (per Engram #1237). For production, coordinate the change
  with a maintenance window and a `TRUNCATE orders, shipments CASCADE`
  cleanup so no in-flight retries cross the algorithm boundary.
- **Frontend acceptance test gap**: the current
  `apps/frontend/tests/orders/shipment-confirmation.test.ts:79-90`
  uses synthetic `'order-1'` / `'shipment-1'` IDs that are already
  invalid; it tests the request builder, not the round trip. The
  real round-trip test must live in the new contract test inside
  `single-payment-builder.test.ts` (per Recommendation item 3).
- **Byte-equality test churn**: `single-payment-builder.test.ts:629-636`
  asserts raw SHA-256 hex. After the fix, two of the 32 hex characters
  per ID change deterministically. The test must be updated; failing
  to update it is the most likely implementation regression.
- **Recovery shell column lag**: per `recovery.test.ts` and
  `recovery_state_audit`, `database.types.ts` does not yet contain
  `checkout_recovery_shells` / `compensation_state`. The producer
  change does not affect schema, so this is pre-existing and out of
  scope; flagged for the verify phase.
- **Zod version compatibility**: Zod 3.23.8's `.uuid()` accepts
  versions 1–5. Confirmed by reading the bundled reference. Future
  Zod major upgrades may tighten version acceptance; pin Zod in
  package.json or assert version-5 explicitly in the schema.
- **Stripe metadata 500-char ceiling**: the patched UUIDs are still
  36 chars; `transfer_group = "selene_order_" + orderGroupId` is
  73 chars, well under the 100-char transfer_group ceiling and the
  500-char metadata-value ceiling. Unaffected.
- **Disambiguation from UUID v4 database IDs**:
  `gen_random_uuid()` (Postgres) emits RFC-4122 v4 IDs (version `4`,
  variant `[89ab]`). The new producer emits v5 (`5`, `[89ab]`). Both
  pass every consumer; downstream code never checks version. No
  collision class between v4 (gen_random_uuid) and v5 (deterministic)
  is reachable in practice (different namespaces) but is theoretically
  possible if the SHA-256 of a real `(idempotencyKey, productId)`
  pair happened to equal a `gen_random_uuid()` output. Probability
  ~2^-120; not a real risk.
- **No tests for the producer's webhook consumer**:
  `single-modal-settlement.ts:319-321` casts `metadata.order_id`
  via `(... -> 'order_id')::UUID`. Postgres FORMAT-only accepts the
  v5 IDs unchanged. The existing `single-modal-settlement.test.ts`
  uses pre-baked fixtures (e.g., `VALID_ORDER_ID` constant) and
  never goes through the producer — recommend adding a round-trip
  test that builds a v5 ID via the producer, embeds it in PI
  metadata, calls `parseSingleModalPayload`, and asserts no
  `INVALID_SINGLE_MODAL_METADATA:*` throw.

## Ready for Proposal

Yes. The producer change is a single-helper rewrite, the test surface
is bounded to one test file plus one new contract test, every
consumer already accepts the new format, Stripe idempotency is
preserved by construction, and the disposable-sandbox migration is a
`TRUNCATE ... CASCADE` that the maintainer runs manually. The
orchestrator can proceed to `sdd-propose` with:

- One-helper rewrite: `hexToUuid` → bit-patched v5 in
  `supabase/functions/create-connect-payment/single-payment-builder.ts`.
- Three updated tests in
  `supabase/functions/create-connect-payment/single-payment-builder.test.ts`.
- One new round-trip contract test (checkout → confirmation) that
  proves `parseConfirmationRequestBody` accepts producer output.
- One new round-trip contract test for the webhook consumer
  (`parseSingleModalPayload` accepts producer output).
- Maintainer deployment: redeploy `create-connect-payment`, then
  `TRUNCATE orders, shipments, order_items, wallet_transactions,
  disputes, connect_payout_run_shipments, shipment_tracking_events,
  checkout_recovery_shells, notifications CASCADE` in the disposable
  sandbox. No `bun db:types` required (no schema change).
- No remote operations, no SQL schema migration, no Edge Function
  deploy beyond `create-connect-payment`, no new cron / Vault /
  Stripe / Envia configuration.