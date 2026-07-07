# Apply Progress: Public Profile Production Audit

## Status

Safe-now slice implemented. Phase 4 is now UNBLOCKED and implemented: the orders detail screen already computed `currentShipment` (with `.id`, `.seller_id`, `.items[].product_id`), and the `reviews` table already supported nullable `shipment_id`/`product_id` (confirmed in `packages/types/src/database.types.ts` lines 1544-1577), so no migration was needed. Verified-purchase identity is now threaded as `(reviewer_id, shipment_id, product_id)` through `ReviewModal` → `useReviewAction` → Supabase insert, with `['seller-reviews', sellerId]` invalidation added.

Safe-now verification remediation applied for the owner action hook-order blocker and runtime behavior evidence gap. The segmented-control contrast warning is intentionally deferred per user decision because emulator contrast looks acceptable and may be a false positive; no segmented-control color changes were made in this remediation.

## Phase 4 Remediation Notes

- Extracted `buildReviewInsertPayload` pure helper into `useReviewAction.helpers.ts` (Extract-Before-Mock) so the shipment/product linkage mapping is testable without mocking TanStack Query / Supabase. The hook now calls the pure builder for the `reviews` insert.
- `ReviewMutationInput` now carries optional `shipmentId` / `productId`. For legacy order-first reviews the builder writes explicit `null` (the column is nullable), so linked rows stay distinguishable from unlinked ones in the verified-purchase contract.
- `useReviewAction.onSettled` now invalidates `['seller-reviews', variables.sellerId]` in addition to the existing `['order', orderId]` and `['profile-stats', sellerId]`, so public profile review lists refresh after a shipment-scoped review is created.
- `ReviewModal` gained optional `shipmentId` / `productId` props (with JSDoc) and forwards them to `useReviewAction`. The existing `sellerId` / `reviewSellerId` fallback (pinned by `ordersMultiShipmentGuards.test.ts`) was preserved so the guard stays green.
- `app/profile/orders/[id].tsx` passes `shipmentId={currentShipment?.id}` and `productId={currentShipment?.items?.[0]?.product_id ?? undefined}` to `ReviewModal`. This is the agreed V1 scope: ONE review per shipment scoped to the shipment's first product. No `order.items[0]` fallback was introduced (the multi-seller mis-assignment bug stays banned).
- New `Requirement: V1 Shipment-Scoped Identity vs V2 Per-Product Reviews` added to `specs/shipments/spec.md` documenting V1 single-review-per-shipment vs V2 one-review-per-product-within-shipment, and the unconditional ban on `order.items[0]` attribution.

## Remediation Notes

- Moved `OptionsMenu` state hook before the owner/null return path so owner hydration changes do not create a conditional hook-order path. Public owner moderation actions remain hidden.
- Extracted small pure public-profile helpers for route-param validation, owner moderation policy, and product/review collection state resolution; `publicProfileProductionAudit.test.ts` now executes these behaviors instead of relying only on source inspection for route/error/owner policy.
- Parameterized `UserReviewCard` accessibility-label copy and wired it through profile i18n keys, preserving the existing default behavior for helper callers.
- Did not touch Phase 4 files and did not add any `order.items[0]` fallback or `profiles_private` usage.

## Completed Tasks

- [x] 1.1 Added `enabled` support for `useProducts` so invalid public-profile params do not trigger generic catalog reads.
- [x] 1.2 Expanded seller review display DTO with `created_at`, nullable `comment`, `shipment_id`, `product_id`, and `isVerifiedPurchase`.
- [x] 1.3 Reviewed shipment spec wording; existing wording already mirrors the target identity tuple.
- [x] 2.1 Guarded `profile/[id]` scalar route params and added retry/back error states.
- [x] 2.2 Passed `isOwner` into `OptionsMenu` for public profiles.
- [x] 2.3 Split loading, fetch-error, and empty states for listings and reviews.
- [x] 2.4 Updated review cards to show verified badges only for linked reviews and display localized review dates.
- [x] 2.5 Added segmented-control tab accessibility state; selected contrast warning is deferred by user decision for follow-up verification.
- [x] 2.6 Added public-profile i18n copy in English and Spanish.
- [x] 3.1 Added focused hook tests for linked, legacy, rating-only, and nullable review rows.
- [x] 3.2 Added structural screen tests for route guard, owner action hiding, and retryable failures.
- [x] 3.3 Added focused helper/structural tests for review card and segmented-control accessibility/readability.
- [x] 5.1 Confirmed no sorting/filtering UI was introduced.
- [x] 5.2 Confirmed this slice does not touch `profiles_private`, `ReviewModal`, `useReviewAction`, or `app/profile/orders/[id].tsx`.
- [x] 4.1 Added optional `shipmentId` / `productId` props to `ReviewModal` with JSDoc explaining verified-purchase linkage and the legacy `null` contract, forwarded to `useReviewAction`.
- [x] 4.2 Extracted `buildReviewInsertPayload` pure helper, added `shipmentId` / `productId` to `ReviewMutationInput`, included `shipment_id` / `product_id` in the Supabase insert (explicit `null` for legacy), and added `['seller-reviews', sellerId]` invalidation in `onSettled`.
- [x] 4.3 `app/profile/orders/[id].tsx` passes `shipmentId={currentShipment?.id}` and `productId={currentShipment?.items?.[0]?.product_id ?? undefined}` to `ReviewModal` (shipment-scoped V1; no `order.items[0]` fallback).
- [x] 4.4 Documented the V1 shipment-scoped identity vs V2 one-review-per-product contract in `specs/shipments/spec.md`, including the unconditional ban on order-first attribution.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/frontend/core/hooks/useProducts.test.ts` | Unit | No existing focused tests found | ✅ Written first for disabled/default query guard | ✅ `bun test` passed | ✅ 2 cases | ✅ Extracted pure helper |
| 1.2 | `apps/frontend/core/hooks/useSellerReviews.test.ts` | Unit | No existing focused tests found | ✅ Written first for missing DTO mapper | ✅ `bun test` passed | ✅ 3 cases | ✅ Extracted pure mapper |
| 1.3 | `openspec/changes/public-profile-production-audit/specs/shipments/spec.md` | Review | N/A documentation review | ✅ Existing spec checked against task | ✅ No wording change needed | ➖ Single contract check | ➖ None needed |
| 2.1 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | No existing focused screen tests found | ✅ Written first for route guard | ✅ `bun test` passed | ✅ Invalid route + enabled guard checks | ✅ Added route resolver |
| 2.2 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | No existing focused screen tests found | ✅ Written first for owner menu hiding | ✅ `bun test` passed | ✅ Owner derivation + prop pass checks | ➖ None needed |
| 2.3 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | No existing focused screen tests found | ✅ Written first for product/review retry states | ✅ `bun test` passed | ✅ Product and review branches checked | ✅ Shared retryable state component |
| 2.4 | `apps/frontend/components/features/users/UserReviewCard.test.ts` | Unit | No existing focused component tests found | ✅ Written first for card presentation helper | ✅ `bun test` passed | ✅ Linked, legacy, and rating-only cases | ✅ Extracted presentation helper |
| 2.5 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | No existing focused component tests found | ✅ Written first for tab a11y wiring | ✅ `bun test` passed | ✅ Role and selected-state checks; contrast deferred by user decision | ➖ None needed |
| 2.6 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | Existing i18n tests not specific to public profile | ✅ Written first for locale keys | ✅ `bun test` passed | ✅ English and Spanish keys checked | ➖ None needed |
| 3.1 | `apps/frontend/core/hooks/useSellerReviews.test.ts` | Unit | N/A new tests | ✅ Written first | ✅ `bun test` passed | ✅ 3 behavior cases | ✅ Pure mapper kept mock-free |
| 3.2 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | N/A new tests | ✅ Written first | ✅ `bun test` passed | ✅ 3 route/UI wiring cases | ➖ None needed |
| 3.3 | `apps/frontend/components/features/users/UserReviewCard.test.ts`, `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Unit/Structural | N/A new tests | ✅ Written first | ✅ `bun test` passed | ✅ Review card + segmented-control cases | ✅ Pure card helper kept mock-free |
| 5.1 | `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts` | Structural | N/A | ✅ Covered by absence of sorting/filtering additions in implementation review | ✅ Focused tests passed | ➖ Review-only | ➖ None needed |
| 5.2 | Repository search / review | Review | N/A | ✅ Checked forbidden paths/patterns | ✅ No forbidden edits made | ➖ Review-only | ➖ None needed |
| 4.2 | `apps/frontend/core/hooks/useReviewAction.test.ts` | Unit | N/A (new file); existing `ordersMultiShipmentGuards.test.ts` baseline 11/11 pass | ✅ Written first for missing `buildReviewInsertPayload` helper (module-not-found RED) | ✅ `bun test` passed | ✅ 2 cases: shipment-linked + legacy null | ✅ Extracted pure builder + wired hook to it |
| 4.1 | `apps/frontend/app/profile/orders/__tests__/ordersMultiShipmentGuards.test.ts` | Structural (source guard) | ✅ ReviewModal guard 1/1 baseline pass | ✅ Written first for missing `shipmentId?`/`productId?` props + forwarding strings | ✅ `bun test` passed | ➖ Single contract check (existing `sellerId` guard already triangulates legacy vs linked) | ➖ None needed |
| 4.3 | `apps/frontend/app/profile/orders/__tests__/ordersMultiShipmentGuards.test.ts` | Structural (source guard) | ✅ orders detail guard 7/7 baseline pass | ✅ Written first for missing `shipmentId={currentShipment?.id}` / `productId={currentShipment?.items?.[0]?.product_id ?? undefined}` + `not.toContain('productId={order.items[0]')` | ✅ `bun test` passed | ➖ Single contract check | ➖ None needed |
| 4.4 | `openspec/changes/public-profile-production-audit/specs/shipments/spec.md` | Doc | N/A documentation only | ✅ Existing spec reviewed against V1/V2 contract | ✅ V1/V2 requirement added | ➖ Triangulation skipped: purely structural/doc with one possible contract output | ➖ None needed |

## Tests Run

- `bun test "apps/frontend/core/hooks/useSellerReviews.test.ts" "apps/frontend/core/hooks/useProducts.test.ts" "apps/frontend/components/features/users/UserReviewCard.test.ts" "apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts"` — ✅ 13 pass, 0 fail.
- `bun test "apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts" "apps/frontend/components/features/users/UserReviewCard.test.ts"` — ❌ RED baseline confirmed before implementation: missing `publicProfile.helpers` module and localized accessibility-label assertion failed against hardcoded English.
- `bun test "apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts" "apps/frontend/components/features/users/UserReviewCard.test.ts"` — ✅ GREEN after remediation: 9 pass, 0 fail, 35 expect() calls.
- `bun test "apps/frontend/core/hooks/useSellerReviews.test.ts" "apps/frontend/core/hooks/useProducts.test.ts" "apps/frontend/components/features/users/UserReviewCard.test.ts" "apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts"` — ✅ 14 pass, 0 fail, 46 expect() calls.
- `bunx eslint "apps/frontend/app/profile/[id].tsx" "apps/frontend/app/profile/publicProfile.helpers.ts" "apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts" "apps/frontend/components/ui/OptionsMenu.tsx" "apps/frontend/components/features/users/UserReviewCard.tsx" "apps/frontend/components/features/users/UserReviewCard.helpers.ts" "apps/frontend/components/features/users/UserReviewCard.test.ts"` — ✅ pass, no output.
- `bunx eslint <same TS files plus profile locale JSON files>` — ⚠️ TS files passed; locale JSON files were ignored by ESLint config with warnings only.
- `bunx tsc --noEmit` from `apps/frontend` — ❌ failed on pre-existing project issues, including missing `bun:test` types, `WizardSteps` missing `steps`, old `EnrichedOrder.items` references, and EdgeFunctionRegistry gaps. No new implementation-specific type errors remained after fixing `resolveProductsQueryEnabled` signature.
- Phase 4 safety-net baseline: `bun test ordersMultiShipmentGuards + useSellerReviews + useProducts + UserReviewCard + publicProfileProductionAudit` — ✅ 25 pass, 0 fail before any Phase 4 edit.
- Phase 4 RED: `bun test useReviewAction.test.ts` — ❌ module `./useReviewAction.helpers` not found (new file). `bun test ordersMultiShipmentGuards.test.ts` after extending guards — ❌ 2 new source-guard tests failed (missing `shipmentId?`/`productId?` and missing `shipmentId={currentShipment?.id}`), 11 prior still pass.
- Phase 4 GREEN+TRIANGULATE: `bun test useReviewAction.test.ts` — ✅ 2 pass, 0 fail (shipment-linked + legacy-null cases). `bun test ordersMultiShipmentGuards.test.ts` — ✅ 13 pass, 0 fail after both ReviewModal and [id].tsx edits.
- Phase 4 full suite: `bun test useSellerReviews useProducts UserReviewCard publicProfileProductionAudit useReviewAction ordersMultiShipmentGuards` — ✅ 29 pass, 0 fail, 79 expect() calls.
- Phase 4 lint: `bunx eslint ReviewModal.tsx useReviewAction.ts useReviewAction.helpers.ts useReviewAction.test.ts orders/[id].tsx ordersMultiShipmentGuards.test.ts` — ✅ pass, no output.
- Phase 4 typecheck: `bunx tsc --noEmit` from `apps/frontend`, filtered for `useReviewAction|ReviewModal|orders/[id]` — ✅ no errors from Phase 4 files (pre-existing repo errors unchanged and out of scope).

## Blockers / Remaining Work

- [x] 4.1-4.4 implemented. The orders detail screen already resolved `currentShipment` with `.id`, `.seller_id`, and `.items[].product_id`, and the `reviews` table already had nullable `shipment_id`/`product_id`, so Phase 4 shipped in this batch. No `order.items[0]` fallback was introduced.
- [ ] V2 one-review-per-product-within-ashipment expansion remains future work (documented in `specs/shipments/spec.md`).

## Files Changed

- `apps/frontend/core/hooks/useProducts.ts`
- `apps/frontend/core/hooks/useProducts.helpers.ts`
- `apps/frontend/core/hooks/useProducts.test.ts`
- `apps/frontend/core/hooks/useSellerReviews.ts`
- `apps/frontend/core/hooks/useSellerReviews.helpers.ts`
- `apps/frontend/core/hooks/useSellerReviews.test.ts`
- `apps/frontend/app/profile/[id].tsx`
- `apps/frontend/app/profile/publicProfile.helpers.ts`
- `apps/frontend/app/__tests__/publicProfileProductionAudit.test.ts`
- `apps/frontend/components/ui/OptionsMenu.tsx`
- `apps/frontend/components/features/users/UserReviewCard.tsx`
- `apps/frontend/components/features/users/UserReviewCard.helpers.ts`
- `apps/frontend/components/features/users/UserReviewCard.test.ts`
- `apps/frontend/components/ui/SegmentedControl.tsx`
- `apps/frontend/core/i18n/locales/en/profile.json`
- `apps/frontend/core/i18n/locales/es/profile.json`
- `openspec/changes/public-profile-production-audit/tasks.md`
- `apps/frontend/components/features/profile/ReviewModal.tsx` (Phase 4.1)
- `apps/frontend/core/hooks/useReviewAction.ts` (Phase 4.2)
- `apps/frontend/core/hooks/useReviewAction.helpers.ts` (Phase 4.2 — new pure builder)
- `apps/frontend/core/hooks/useReviewAction.test.ts` (Phase 4.2 — new unit tests)
- `apps/frontend/app/profile/orders/[id].tsx` (Phase 4.3)
- `apps/frontend/app/profile/orders/__tests__/ordersMultiShipmentGuards.test.ts` (Phase 4.1 + 4.3 — new source guards)
- `openspec/changes/public-profile-production-audit/specs/shipments/spec.md` (Phase 4.4 — V1/V2 contract note)
