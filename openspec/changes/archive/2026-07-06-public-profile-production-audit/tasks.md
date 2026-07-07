# Tasks: Public Profile Production Audit

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 260-360 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Harden public profile reads/UI for safe-now cases | PR 1 | Base on current branch; include tests and i18n/a11y updates |
| 2 | Preserve blocked review-creation follow-up contract | PR 1 | Document only; no implementation until orders/multi-seller fix lands |

## Phase 1: Foundation / Contracts

- [x] 1.1 Update `apps/frontend/core/hooks/useProducts.ts` to accept an `enabled` guard so invalid `/profile/[id]` params cannot trigger generic catalog reads.
- [x] 1.2 Update `apps/frontend/core/hooks/useSellerReviews.ts` DTO to include `created_at`, nullable `comment`, `shipment_id`, `product_id`, and `isVerifiedPurchase` contract fields.
- [x] 1.3 Add/adjust `openspec/changes/public-profile-production-audit/specs/shipments/spec.md` notes if task wording needs to mirror the `(reviewer_id, shipment_id, product_id)` target.

## Phase 2: Safe-Now Public Profile Hardening

- [x] 2.1 Refactor `apps/frontend/app/profile/[id].tsx` to validate scalar `id` early, stop reads on invalid params, and render explicit retryable error states.
- [x] 2.2 Make `apps/frontend/app/profile/[id].tsx` pass `isOwner` to `OptionsMenu` and keep owner moderation actions hidden on the public route.
- [x] 2.3 Update profile listings/reviews branches to separate loading, fetch error, and empty states for `useProducts` and `useSellerReviews`.
- [x] 2.4 Update `apps/frontend/components/features/users/UserReviewCard.tsx` to show verified badge only when `isVerifiedPurchase`, render localized `created_at`, and avoid claiming trust for legacy rows.
- [x] 2.5 Fix `apps/frontend/components/ui/SegmentedControl.tsx` selected-state contrast and accessible labels/state for tabs.
- [x] 2.6 Replace hardcoded public-profile copy with i18n keys in `apps/frontend/core/i18n/locales/en/profile.json` and `apps/frontend/core/i18n/locales/es/profile.json`.

## Phase 3: Verification

- [x] 3.1 Add hook tests for `useSellerReviews` covering linked verified reviews, legacy unlinked reviews, rating-only rows, and nullable comments.
- [x] 3.2 Add screen/component tests for `app/profile/[id].tsx` covering invalid route params, owner menu hiding, and retryable product/review failures.
- [x] 3.3 Verify `UserReviewCard` and `SegmentedControl` render accessible roles/labels and the selected tab remains readable.

## Phase 4: Blocked / Follow-up Orders-Multi-seller Work

- [x] 4.1 Update `apps/frontend/components/features/profile/ReviewModal.tsx` only after the orders fix can provide the full `(reviewer_id, shipment_id, product_id)` identity.
- [x] 4.2 Update `apps/frontend/core/hooks/useReviewAction.ts` invalidations for `['profile', userId]` and `['seller-reviews', sellerId]` when review creation is shipment-safe.
- [x] 4.3 Update `apps/frontend/app/profile/orders/[id].tsx` to pass shipment/product identity instead of `order.items[0]` fallback once the multi-seller bug is fixed.
- [x] 4.4 Keep the follow-up contract explicit in `openspec/changes/public-profile-production-audit/specs/shipments/spec.md` so verified badges never rely on order-first attribution.

## Phase 5: Cleanup / Documentation

- [x] 5.1 Ensure task/spec wording stays aligned with the public trust contract and no review sorting/filtering is introduced.
- [x] 5.2 Confirm no private profile fields are touched and no temporary TODOs are used as tracking for the blocked follow-up.
