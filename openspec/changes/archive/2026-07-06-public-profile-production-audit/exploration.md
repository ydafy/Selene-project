## Exploration: public-profile-production-audit

### Current State
- **Flow map**
  1. `app/product/[id].tsx` loads a product through `useProduct()` and renders `ProductSellerCard`.
  2. `components/features/product/ProductSellerCard.tsx` navigates to `/profile/[id]` with `seller.id`.
  3. `app/profile/[id].tsx` loads three data sources in parallel: `useProfile(id)`, `useProducts({ sellerId: id, verifiedOnly: true })`, and `useSellerReviews(id)`.
  4. `ProfileHeader` renders precomputed seller stats from `profiles`, while the segmented view switches between active listings and reviews.
- **Data dependencies verified against shared DB types**
  - `products.seller_id -> profiles.id` (`packages/types/src/database.types.ts:1023-1181`)
  - `reviews.seller_id -> profiles.id` and `reviews.reviewer_id -> profiles.id` (`packages/types/src/database.types.ts:1343-1490`)
  - `reviews.product_id -> products.id` and `reviews.shipment_id -> shipments.id` are optional but supported by schema (`packages/types/src/database.types.ts:1348-1450,1477-1488`)
  - Public seller stats live on `profiles.average_rating`, `profiles.total_reviews`, `profiles.total_sales` (`packages/types/src/database.types.ts:1184-1218`)
- **Privacy boundary check**
  - The public profile flow reads `profiles`, `products`, and `reviews` only (`core/hooks/useProduct.ts`, `core/hooks/useProfile.ts`, `core/hooks/useProducts.ts`, `core/hooks/useSellerReviews.ts`).
  - `profiles_private` contains email/phone/role/Stripe fields and is not queried by this flow (`packages/types/src/database.types.ts:1220-1275`; no frontend matches for `profiles_private` in the audited path).
- **Findings by severity**
  - **Critical**
    - **Review attribution is not multi-seller safe.** `ReviewModal` writes `sellerId: order.items[0]?.seller_id` and omits `shipment_id` / `product_id` (`apps/frontend/components/features/profile/ReviewModal.tsx:41-46`), while the order screen always mounts the modal with the whole order (`apps/frontend/app/profile/orders/[id].tsx:560-617`). The schema supports `seller_id`, `product_id`, and `shipment_id` on `reviews` (`packages/types/src/database.types.ts:1343-1490`), and shipment specs already model `canReview` at shipment level (`openspec/specs/shipments/spec.md:226-244`). In multi-seller orders, the first seller can receive the only review.
  - **High**
    - **Public profile data stays stale after a review submit.** `useReviewAction` invalidates `['order', orderId]` and deprecated `['profile-stats', sellerId]` only (`apps/frontend/core/hooks/useReviewAction.ts:50-55`), but the live public-profile caches are `['profile', userId]` (`apps/frontend/core/hooks/useProfile.ts:13-25`) and `['seller-reviews', sellerId]` (`apps/frontend/core/hooks/useSellerReviews.ts:56-64`).
    - **Products/reviews failures are rendered as empty states instead of errors.** `app/profile/[id].tsx` ignores `error` from `useProducts` and `useSellerReviews` (`apps/frontend/app/profile/[id].tsx:65-71`) and falls through to empty-state branches (`apps/frontend/app/profile/[id].tsx:177-193,269-284`).
    - **Review cards expect product context that review writes do not persist.** `useSellerReviews` joins `product:products(name)` (`apps/frontend/core/hooks/useSellerReviews.ts:33-45`), but `useReviewAction` never inserts `product_id` (`apps/frontend/core/hooks/useReviewAction.ts:21-29`), so the “verified purchase” label often degrades to a generic fallback.
  - **Medium**
    - **Selected segmented tab text is likely invisible.** `SegmentedControl` sets the selected background to `theme.colors.primary` and the selected text color to the same `theme.colors.primary` (`apps/frontend/components/ui/SegmentedControl.tsx:46-48,62-64`); `primary` is `#bd9f65` in theme (`apps/frontend/core/theme/index.ts:78`).
    - **Route param handling is unsafe.** `app/profile/[id].tsx` uses `id!` from `useLocalSearchParams<{ id: string }>()` for all three hooks (`apps/frontend/app/profile/[id].tsx:49,62,65,71`). If `id` is missing or array-valued, `useProfile`/`useSellerReviews` disable, but `useProducts` still runs and can query the generic catalog because it has no `enabled` guard (`apps/frontend/core/hooks/useProducts.ts:52-58`).
    - **Viewing your own public profile still shows moderation actions.** `app/profile/[id].tsx` passes `OptionsMenu` without `isOwner` (`apps/frontend/app/profile/[id].tsx:137-141`), while `OptionsMenu` defaults `isOwner = false` and only hides when true (`apps/frontend/components/ui/OptionsMenu.tsx:15-19,34-36`).
    - **Review DTO type is looser than runtime reality.** `SellerReview.comment` is typed as `string` (`apps/frontend/core/hooks/useSellerReviews.ts:19`) but the DB column is nullable (`packages/types/src/database.types.ts:1345-1357`).
    - **`useProduct` placeholder lookup is effectively dead code.** It reads exact cache key `['products']` (`apps/frontend/core/hooks/useProduct.ts:36-42`), but `useProducts` stores lists under `['products', options]` (`apps/frontend/core/hooks/useProducts.ts:55`).
    - **The screen claims full i18n but still hardcodes Spanish UI copy.** Examples: profile empty states in `apps/frontend/app/profile/[id].tsx:190,282`, verified labels in `apps/frontend/components/features/product/ProductSellerCard.tsx:106`, `apps/frontend/components/features/profile/ProfileHeader.tsx:217,226`, and review badge text in `apps/frontend/components/features/users/UserReviewCard.tsx:122`. Locale files also do not define `profile.public.tabProducts` / `tabReviews` keys.
    - **No targeted tests were found** for `app/profile/[id].tsx`, `useSellerReviews`, `UserReviewCard`, or the product→profile route handoff.
  - **Low**
    - **Accessibility gaps remain across the flow.** Pressables in `ProductSellerCard` (`apps/frontend/components/features/product/ProductSellerCard.tsx:47-117`), segmented tabs (`apps/frontend/components/ui/SegmentedControl.tsx:37-42`), and public-profile product cards (`apps/frontend/app/profile/[id].tsx:201-205`) do not expose explicit button semantics/labels. `UserReviewCard` wraps the entire card as `accessibilityRole="text"` (`apps/frontend/components/features/users/UserReviewCard.tsx:40-49`), which flattens richer content.
    - **Responsive/performance smells:** `Dimensions.get()` is captured at module scope (`apps/frontend/app/profile/[id].tsx:45-46`) and both `FlashList` instances are nested inside a parent `ScrollView` with `scrollEnabled={false}` (`apps/frontend/app/profile/[id].tsx:126-300`), which reduces virtualization value.
    - **Profile-level failure state is minimal.** The screen shows a generic error with no retry/back CTA (`apps/frontend/app/profile/[id].tsx:94-106`).
- **Missing context / questions**
  - Should seller reviews be **shipment-scoped**, **seller-scoped**, or **order-scoped**? Current schema/specs strongly suggest shipment-safe behavior, but UI write-path is order-first.
  - Should navigating to `/profile/[id]` for the current user show the public profile variant, redirect to the private profile tab, or simply hide moderation actions?
  - Is the public profile intentionally limited to `VERIFIED` active listings only, or should sold/history inventory also be visible for trust context?

### Affected Areas
- `apps/frontend/app/product/[id].tsx` — entry point that loads seller join data and hands off to seller navigation.
- `apps/frontend/components/features/product/ProductSellerCard.tsx` — seller CTA, verification badge, and route push to `/profile/[id]`.
- `apps/frontend/app/profile/[id].tsx` — public seller profile screen, tab state, loading/empty/error handling, and product→profile reverse navigation.
- `apps/frontend/components/features/profile/ProfileHeader.tsx` — shared header rendering seller stats and public trust signals.
- `apps/frontend/components/ui/SegmentedControl.tsx` — tab control used on the public profile and affected by the selected-state color bug.
- `apps/frontend/core/hooks/useProfile.ts` — reads public seller profile/stat fields from `profiles`.
- `apps/frontend/core/hooks/useProducts.ts` — loads seller inventory and currently lacks a route-param guard.
- `apps/frontend/core/hooks/useSellerReviews.ts` — loads relational review data and defines a partially incorrect DTO.
- `apps/frontend/components/features/users/UserReviewCard.tsx` — renders review accessibility text and verified-purchase badge.
- `apps/frontend/components/features/profile/ReviewModal.tsx` — writes review rows that later feed public seller reputation.
- `apps/frontend/core/hooks/useReviewAction.ts` — mutation/invalidation logic that leaves public profile caches stale.
- `apps/frontend/app/profile/orders/[id].tsx` — order detail integrates `ReviewModal` and currently passes whole-order context.
- `apps/frontend/core/hooks/useShipments.ts` — existing shipment-level permission model that conflicts with current review write path.
- `packages/types/src/database.types.ts` — source of truth for `profiles`, `profiles_private`, `products`, and `reviews` columns/FKs.
- `packages/types/src/index.ts` — exported aliases used by hooks/components (`Tables`, `Profile`, `Product`, `ProductWithSeller`).

### Approaches
1. **Reputation data-contract hardening first** — Fix review ownership, review payload completeness, and cache invalidation before polishing UI.
   - Pros: Solves the highest-risk trust bugs; aligns client behavior with schema/spec intent; prevents bad seller reputation data from compounding.
   - Cons: Cross-cuts order detail, reviews, and public profile surfaces; likely needs proposal + design before implementation.
   - Effort: High

2. **UI stabilization only** — Add route guards, visible error states, i18n cleanup, and accessibility fixes without changing review semantics.
   - Pros: Lower implementation risk; faster user-facing improvement.
   - Cons: Leaves the core reputation-attribution bug unresolved; stale profile metrics would still exist.
   - Effort: Medium

### Recommendation
Recommend **Approach 1**. This flow is trust-sensitive, and the largest risk is not visual polish — it is incorrect seller reputation data. The next SDD phase should define the review ownership model (prefer shipment-safe semantics), then bundle cache invalidation, route guards, UI error states, and a11y/i18n cleanup as follow-on implementation tasks.

### Risks
- Seller ratings and review counts may already be wrong for multi-seller orders.
- Network/query failures can currently look like “no products” or “no reviews,” hiding real outages from users and support.
- Self-report/block actions can appear on the public profile route for the profile owner.
- The flow currently has little test coverage, so regressions are likely once fixes begin.

### Ready for Proposal
Yes — move to `sdd-propose` for `public-profile-production-audit`. Tell the user the proposal should start with **review attribution + cache invalidation as the trust-critical slice**, then cover public-profile UI/accessibility hardening as a second slice.
