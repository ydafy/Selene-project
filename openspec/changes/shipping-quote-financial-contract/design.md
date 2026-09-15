# Design: Shipping Quote Financial Contract

## Technical Approach

Use additive `products` snapshots. Preserve allocation/claims/refunds/units. Exclude payout/reconciliation, post-carrier deductions, pickups, manual dimensions, checkout selectors, dead-artifact disposition, and remote operations.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Snapshot columns / current settings | Requires migration and type gate | Persist accepted reserve/rates; prevent settings drift |
| Nullable snapshot / bulk historical reconstruction | Historical settings are unavailable | Legacy-only fallback with atomic backfill; never fabricate publication history |
| Strict quote wrapper / changing shared label policy | Keeps label orchestration stable | Reject mixed/nonmatching responses before shared selection |
| Integer cents / decimal calculations | Requires boundary conversion | Ceiling insurance; retain configured buffer and normalized rates |
| Inline guidance / route redesign | Existing form owns shipping UI | Retain tooltip; no navigation changes |
| Evidence-only cost / repricing | Label drift remains operational risk | Never change reserve/net or refund basis |

## Data Flow

```text
Quote + accepted settings -> draft economics -> atomic publication snapshot
Reserved product -> snapshot (or legacy backfill) -> per-product allocation
Allocation -> settlement before paid -> shipment cents / item pesos
Label claim -> real-address quote -> provider cost evidence only
Stored buyer charge -> refund excluding reserve -> actual-Stripe-fee loss
```

Use the seller's real valid Mexican origin ZIP; retain reference-destination default `06500`, distinct from real buyer addresses. Declare merchandise price. Preserve claim/evidence/sent/finalize/rejection/orphan orchestration.

## File Changes

Planned paths; CLI-generated migration timestamp.

| File | Action | Description |
|---|---|---|
| `supabase/migrations/<timestamp>_product_publication_economics.sql` | Create | Columns, validation/write protection, atomic backfill RPC |
| `supabase/queries/rollback_product_publication_economics.sql` | Create | Paired down-SQL, manual only |
| `packages/types/src/database.types.ts` | Regenerate | After confirmed remote SQL only |
| `apps/frontend/core/{hooks/usePublishProduct.ts,store/useSellStore.ts}` | Modify | Accepted inputs; atomic publication |
| `apps/frontend/core/utils/sellerProceedsEstimate{,.test}.ts` | Modify | Ceiling and publication fixtures |
| `supabase/functions/get-shipping-quote/{index.ts,quote-contract.ts,quote-contract.test.ts}` | Modify/Create | Strict quote seam and tests |
| `supabase/functions/create-connect-payment/{index.ts,fee-calculator.ts,fee-calculator.test.ts}` | Modify | Snapshot resolution and per-product commission |
| `supabase/functions/_shared/{publication-economics.ts,publication-economics.test.ts}` | Create | Validation/fallback seam and tests |
| `supabase/functions/_shared/{__tests__/envia-shipping.test.ts,refund-basis.test.ts}` | Modify | Quote/refund regressions |
| `supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` | Modify | Units, correlation, evidence independence |
| `apps/frontend/components/features/sell/SellDetailsForm.tsx`, `apps/frontend/app/profile/orders/prepare/[id].tsx` | Modify | Preset/box-drift and packaging/handoff guidance |
| `apps/frontend/core/i18n/locales/{en,es}/{sell,orders}.json`, `apps/frontend/tests/orders/__tests__/i18nOrdersParity.test.ts` | Modify | Copy parity/source wiring |

## Interfaces / Contracts

Add nullable `publication_shipping_reserve_cents bigint`, `publication_commission_rate numeric`, and `publication_insurance_rate numeric`: all-null legacy or all-present; safe nonnegative integer reserve, finite fractional rates within `[0,1]`. Snapshot rates never undergo legacy percent/basis-point normalization again.

`usePublishProduct` atomically submits product and accepted estimate. Database validation reconstructs economics from price, quote, and accepted inputs; rejects invalid/stale acceptance; preserves ownership/RLS; prevents arbitrary replacement. Unchanged edits retain snapshots; economic edits require renewed acceptance. Missing/invalid quotes block publication.

Checkout validates snapshots and supplies per-product commission to `calculateCheckoutAllocation`. Only all-null legacy rows read current `service_fee_pct`, buffer, and normalized insurance. Conditional service-role-only backfill returns the concurrent winner; failure blocks payment and releases reservations. Partial/invalid snapshots fail closed. Never overwrite snapshots or apply global commission to mixed listings.

Reserve = `Q + buffer + ceil(priceCents * insuranceRate)`; commission = `round(priceCents * commissionRate)`. Insurance is included once, not deducted again. `products.price`, `products.shipping_cost` (quote only), API `price`, and item amounts remain decimal pesos: convert once to cents on entry, divide by 100 on persistence/display. Shipment reserve and label evidence remain cents. Example: reserve `18200`, item shipping `182.00`, commission `80.00`, net `738.00`. Reuse generated `Tables` aliases; parse provider JSON as `unknown`.

## Testing Strategy

Strict Bun RED→GREEN→refactor; design-only.

| Layer | Planned coverage |
|---|---|
| Unit | Mixed/duplicate/malformed/non-MXN rates, variants, origin, ceiling, configured buffer, snapshot precedence, mixed commissions |
| Integration | Atomic publication, tampering/stale acceptance, settings drift, concurrent backfill/failure, unit conversion, UUID/retry conservation, allocation-before-paid, refund/loss invariance |
| UI/manual | Locale parity, tooltip/wrapping, preparing revisit, visible errors; no E2E runner assumed |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary changes. RPC execution: revoke PUBLIC/anon/authenticated; grant service role only; preserve server credential isolation.

## Migration / Rollout

Create the imperative additive migration repository-only. Handoff its exact generated filename: maintainer applies SQL first; wait for confirmation; run `bun db:types`; verify columns/RPC types before dependent code. Then maintainer deploys `get-shipping-quote`, `create-connect-payment`, and compatible publication client; verify publication, settings drift, legacy backfill, and settlement units. No new secrets/cron/webhooks.

Rollback: revert consumers first; preserve snapshots for in-flight payments; apply paired down-SQL only after dependency checks/export and explicit approval. Undeployed SQL can be removed. Never mutate settled money.

After sandbox validation, separately authorize one production Ground label: branch receipt and first tracking gate rollout only. [Envia reference](https://docs.envia.com/reference/shipping-rates.md) confirms rates/merchandise value, not branch admission or insurance coverage.

## Open Questions

Publication acceptance validation must define trusted quote provenance before apply; client-supplied reserve alone is insufficient. Branch admission remains unproven.
