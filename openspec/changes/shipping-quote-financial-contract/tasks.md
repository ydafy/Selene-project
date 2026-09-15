# Tasks: Shipping Quote Financial Contract

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1200 |
| 400-line budget risk | High |
| Orchestrator budget | 800 lines |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 schema+quote → PR 2 snapshot+allocation → PR 3 UI+i18n |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Snapshot schema + deterministic quote | PR 1 | `bun test supabase/functions/get-shipping-quote/quote-contract.test.ts` | Local `supabase start` + `bun test` | Migration + quote-contract |
| 2 | Snapshot read/write/fallback + allocation | PR 2 | `bun test supabase/functions/_shared/publication-economics.test.ts` | Local `supabase start` + `bun test` | `_shared` + fee-calculator |
| 3 | UI notices + i18n parity | PR 3 | `bun test apps/frontend/tests/orders/__tests__/i18nOrdersParity.test.ts` | Expo Go / `bun test` | SellDetailsForm, prepare screen, locales |

## Phase 1: Foundation

- [x] 1.1 Create `supabase/migrations/<timestamp>_product_publication_economics.sql` and paired `supabase/queries/rollback_product_publication_economics.sql` with nullable snapshot columns, validation, backfill RPC.
- [x] 1.2 RED: failing `quote-contract.test.ts` for `selectPaquetexpressGroundRate` rejecting non-Paquetexpress, non-Ground, non-MXN, `ground_do`, `ground_od`.
- [x] 1.3 GREEN: create `supabase/functions/get-shipping-quote/quote-contract.ts` returning one Paquetexpress Ground MXN rate for the seller's real valid Mexican origin ZIP; destination defaults to `06500` only as the listing reference destination.

## Phase 2: Core Implementation

- [x] 2.1 RED: failing `publication-economics.test.ts` for `calculateEstimatedSellerShippingDeductionCents` (`Q + buffer + ceil(price*rate)`), snapshot validation, legacy fallback.
- [x] 2.2 GREEN: create `supabase/functions/_shared/publication-economics.ts` with reserve formula, validation, fallback seam.
- [x] 2.3 RED: failing `fee-calculator.test.ts` for `calculateCheckoutAllocation` snapshot precedence, legacy backfill, UUID v5 shipment idempotency.
- [x] 2.4 GREEN: update `supabase/functions/create-connect-payment/fee-calculator.ts` to read snapshot first, fall back to settings, backfill legacy.
- [x] 2.5 RED: failing test for snapshot write/read via `usePublishProduct.ts`.
- [x] 2.6 GREEN: update `apps/frontend/core/hooks/usePublishProduct.ts` and `core/store/useSellStore.ts` to atomically persist reserve/commission/insurance snapshot.

## Phase 3: Integration / Wiring

- [x] 3.1 Update `apps/frontend/components/features/sell/SellDetailsForm.tsx` with preset/box-drift tooltip and branch-handoff notice.
- [x] 3.2 Update `apps/frontend/app/profile/orders/prepare/[id].tsx` with preparing packaging/handoff guidance.
- [x] 3.3 Update `apps/frontend/core/i18n/locales/{en,es}/{sell,orders}.json` and verify parity.

## Phase 4: Testing

- [x] 4.1 RED: update `supabase/functions/_shared/__tests__/envia-shipping.test.ts` to assert deterministic quote rejections.
- [x] 4.2 GREEN: wire `get-shipping-quote/index.ts` through `quote-contract.ts` preserving success paths.
- [x] 4.3 RED: update `supabase/functions/_shared/__tests__/refund-basis.test.ts` for `allocateCancellationLossCents` excluding reserve.
- [x] 4.4 GREEN: update settlement/refund paths to use snapshot-sourced allocation.
- [x] 4.5 REFACTOR: run focused `bun test` and `bun run lint`; keep payout/pickup out of scope.

## Phase 5: Deployment Handoff

- [x] 5.1 Stop before remote SQL; report exact migration file, order, Edge Functions (`get-shipping-quote`, `create-connect-payment`), verification steps.
- [ ] 5.2 After maintainer SQL confirmation, run `bun db:types` and verify `packages/types/src/database.types.ts` contains snapshot columns.
- [ ] 5.3 Record branch-admission proof (one production Paquetexpress Ground label receipt + first tracking) before rollout.
