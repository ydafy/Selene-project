# Design: Standardize Checkout Deterministic UUIDs

## Technical Approach

Replace only the deterministic SHA-256 formatter in `single-payment-builder.ts` with synchronous UUID v5 generation. Preserve the existing checkout orchestration, random no-idempotency fallback, allocation sorting, Stripe request idempotency key, metadata shape, and settlement recovery. This satisfies the delta requirements while making producer IDs acceptable to strict consumers.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| `node:crypto` SHA-1 with explicit byte assembly | Small internal implementation must be vector-tested; no dependency or async propagation | **Choose.** `node:crypto` is already imported by the Edge-compatible pure module and SHA-1 was verified locally in Deno 2.6.6 and Bun 1.3.11. Keep `derive*` synchronous. |
| UUID package | Less local code; adds import/runtime/version resolution across Deno and Bun | Reject for this narrow primitive. |
| Web Crypto | Native API; SHA-1 digest is asynchronous | Reject because it unnecessarily changes the synchronous call graph. |

The immutable namespace is `7b0f4a20-5c30-4e0f-8f84-9a9f4b2e19c1`, owned by Selene checkout and exported as `CHECKOUT_UUID_NAMESPACE` from `single-payment-builder.ts`. It is code-owned, not configurable: environment-specific values would break replay, Stripe idempotency, and persisted relationships. Any namespace/template/algorithm change is a breaking migration.

## Data Flow

```text
idempotencyKey ──v5(order name)──> orderGroupId ──> transferGroup/PI metadata
       │
       └─ + productId ─v5(shipment name)─> allocation row ─> webhook RPC
                                                    └──────> confirmation
```

Retries reconstruct the same order group, transfer group, shipment-per-product bijection, allocation JSON, and complete PaymentIntent parameters. Settlement still persists a `payment_processing` recovery shell on allocation failure and reuses rows by PaymentIntent/identifier on retry.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/functions/create-connect-payment/single-payment-builder.ts` | Modify | Add namespace/parser/v5 helper; replace both derivations; remove SHA-256 formatter. |
| `supabase/functions/create-connect-payment/single-payment-builder.test.ts` | Modify | Add vectors, UUID/Zod checks, bijection, repeated full-parameter equality, and legacy incompatibility. |
| `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Modify | Feed producer-derived order/shipment IDs through confirmation parsing. |
| `supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` | Modify | Build metadata with the real producer and assert settlement preserves every ID/product mapping. |

Read-only audited consumers: `create-connect-payment/index.ts`, confirmation source/index, webhook settlement source/index, `packages/types/src/database.types.ts`, settlement RPC SQL, and `supabase/queries/maintenance/reset-prelaunch-order-test-data.sql`. No consumer, schema, generated-type, Stripe-flow, or SQL behavior changes.

## Interfaces / Contracts

Canonical names are exact, with no trimming, case folding, delimiter escaping, or Unicode normalization:

```text
selene_order_group:${idempotencyKey}
selene_shipment:${idempotencyKey}:product:${productId}
```

Parse the namespace's 32 hex digits into 16 bytes; append the canonical ECMAScript string encoded by `hash.update(name, 'utf8')`; SHA-1 the concatenation; take the first 16 bytes; set byte 6 to `(b & 0x0f) | 0x50` and byte 8 to `(b & 0x3f) | 0x80`; emit lowercase `8-4-4-4-12`. UUID v5 therefore retains 122 variable encoded bits. Golden vectors include:

- `selene_order_group:checkout-key-abc` → `b0b46a0e-4242-5b5f-85c8-2ff0581dd65a`
- `selene_shipment:shared-key:product:product_gpu` → `5f43fc9e-ec3b-5072-82a1-ce531a0280c9`
- UTF-8 case `selene_order_group:checkout-ñ-😀` → `42d33f19-6cf4-5c35-a0bd-94ac1bf7afc5`

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Algorithm/format/canonical bytes | RED vectors, version `5`, variant `[89ab]`, Zod `.uuid()`, Unicode, distinct products. |
| Contract | Producer→confirmation/webhook | Import real producer helpers; avoid copied metadata fixtures for new round trips. |
| Integration | Retry/cutover | Deep-equal full PI params for reordered identical inputs; prove legacy SHA-256 bytes differ and cannot reuse pre-cutover Stripe keys. |

Run focused Bun tests, then `bun test`, `deno fmt --check`, `deno lint`, and `deno check` for the producer entry/module.

## Threat Matrix

| Boundary | Applicability | Response / RED tests |
|---|---|---|
| Documentation-like paths | N/A — no executable classification | None |
| Git repository selection | N/A — no Git command changes | None |
| Commit state | N/A — no commit automation | None |
| Push state | N/A — no push automation | None |
| PR commands | N/A — no PR automation | None |

## Migration / Rollout

Disposable sandbox only; agents execute nothing remotely. Maintainer: (1) quiesce checkout and confirm no legacy PI/webhook retry remains pending; (2) deploy `create-connect-payment`; (3) execute `supabase/queries/maintenance/reset-prelaunch-order-test-data.sql` in Dashboard—the audited single `TRUNCATE public.orders RESTART IDENTITY CASCADE` lets PostgreSQL resolve dependent tables, avoiding guessed deletion order; (4) use fresh post-cutover idempotency keys; (5) run checkout→webhook settlement→delivery→confirmation smoke and verify v5 IDs, one shipment/item per product, matching transfer group, and repeated request reuse. Rollback: quiesce, redeploy the prior producer, rerun the same reset query, and restart with fresh keys. Never use this reset in production.

## Open Questions

None.
