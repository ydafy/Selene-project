# Tasks: Standardize Checkout Deterministic UUIDs

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 250–350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | N/A |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: not-applicable
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | UUID v5 producer + unit vectors | PR 1 | `bun test supabase/functions/create-connect-payment/single-payment-builder.test.ts` | N/A — pure unit tests | Revert producer module + its test |
| 2 | Consumer contracts + runbook | PR 1 | `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` | Runbook smoke steps only | Revert consumer tests + runbook |

## Phase 1: RED Tests

- [x] 1.1 RED: Add golden-vector tests to `supabase/functions/create-connect-payment/single-payment-builder.test.ts` for `deriveOrderGroupId('checkout-key-abc')`, `deriveShipmentId('shared-key','product_gpu')`, and UTF-8 case.
- [x] 1.2 RED: Assert derived ids are version `5`, RFC-4122 variant, and pass Zod `.uuid()` plus the strict regex.
- [x] 1.3 RED: Add per-product bijection tests: distinct `productId` values yield distinct shipment ids; identical `(idempotencyKey, productId)` reproduces the same id.
- [x] 1.4 RED: Add PaymentIntent parameter byte-stability test: identical cart/idempotency key produces deep-equal params across two builds.
- [x] 1.5 RED: Add deterministic cutover test: old SHA-256 output for the same canonical name differs from the pinned UUID v5 golden vector. Use a single known legacy fixture for version/variant failure, but do not generalize.
- [x] 1.6 RED: Add producer→confirmation contract test in `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` using real producer v5 IDs.
- [x] 1.7 RED: Add producer→settlement contract test in `supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` using real producer shipment IDs and asserting recovery.

## Phase 2: GREEN Implementation

- [x] 2.1 Implement dependency-free UUID v5 helper in `supabase/functions/create-connect-payment/single-payment-builder.ts` with the pinned namespace, SHA-1 namespace+name, version/variant bits, and lowercase output.
- [x] 2.2 Replace `deriveOrderGroupId`/`deriveShipmentId` to use the v5 helper with `selene_order_group:${idempotencyKey}` and `selene_shipment:${idempotencyKey}:product:${productId}`.
- [x] 2.3 Remove obsolete `hexToUuid` and `sha256Hex` helpers.
- [x] 2.4 Update existing deterministic fixtures in `supabase/functions/create-connect-payment/single-payment-builder.test.ts` to expect v5 outputs.
- [x] 2.5 Run `bun test supabase/functions/create-connect-payment/single-payment-builder.test.ts` until green.

## Phase 3: Contract Verification

- [x] 3.1 Run `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` until the producer→confirmation contract is green.
- [x] 3.2 Run `bun test supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` until the producer→settlement round-trip is green.
- [x] 3.3 Audit read-only consumers: `supabase/functions/create-connect-payment/index.ts` (read-only), `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.ts` (read-only), `supabase/functions/stripe-webhooks/single-modal-settlement.ts` (read-only), `packages/types/src/database.types.ts` (read-only), `supabase/queries/maintenance/reset-prelaunch-order-test-data.sql` (read-only); confirm no edits.

## Phase 4: Broader Verification and Cutover Runbook

- [x] 4.1 Run `bun test` and `bun run lint`; fix only failures caused by this change.
- [x] 4.2 Run `deno fmt --check`, `deno lint`, and `deno check` on `supabase/functions/create-connect-payment/index.ts` (read-only) and `supabase/functions/create-connect-payment/single-payment-builder.ts`.
- [x] 4.3 Write `openspec/changes/standardize-checkout-deterministic-uuids/cutover-runbook.md` with sandbox cleanup (`supabase/queries/maintenance/reset-prelaunch-order-test-data.sql` (read-only)), deployment order, config, rollback, and smoke verification; state no remote operations and no `bun db:types` unless schema changes.
- [x] 4.4 Stop before remote Supabase/Stripe operations or `bun db:types`; report cutover commands for maintainer approval.
