# Design: Public Profile Production Audit

## Technical Approach

Harden the mobile public seller profile read path without changing review creation yet. `app/profile/[id].tsx` becomes a guarded, public-only composition of `useProfile`, `useProducts`, and `useSellerReviews`; hooks expose typed query state so the screen can separate loading, errors, empty states, and valid data. Review creation remains a documented dependency on the orders/multi-seller fix; this change only makes public trust display honest.

## Architecture Decisions

| Topic | Options / tradeoff | Decision |
|------|---------------------|----------|
| Review verification | Infer from order/product fallback vs require durable linkage | Verified badge requires both `shipment_id` and `product_id`; no `order.items[0]` fallback because false trust is worse than missing badge. |
| Review display | Hide all unlinked history vs preserve history | Legacy comment reviews remain visible without badge; rating-only rows affect profile aggregates but are filtered out of the card list. |
| Query shape | Add RPC/view vs client Supabase joins | Keep current Supabase table joins for smallest safe boundary; revisit RPC/view only if query logic expands. |
| Scope boundary | Fix creation now vs defer | Defer full review creation until orders/multi-seller work can pass shipment/product context safely. |

## Data Flow

```text
ProductSellerCard -> /profile/[id]
  -> validate scalar sellerId
  -> useProfile(sellerId)        -> profiles public fields only
  -> useProducts({sellerId,...}) -> products where deleted_at is null and status=VERIFIED
  -> useSellerReviews(sellerId)  -> reviews + reviewer profile + optional product
  -> ProfileHeader / listings / UserReviewCard
```

Invalid route params must stop all data reads and render a retry/back error. Product and review query failures render retryable tab-level errors, not empty states.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/frontend/app/profile/[id].tsx` | Modify | Validate `id`, derive owner from `useAuthContext`, pass `isOwner`, render retryable profile/products/reviews errors, and keep listings/reviews empty states distinct. |
| `apps/frontend/core/hooks/useProducts.ts` | Modify | Add `enabled` option or caller-safe guard so invalid public-profile routes cannot load generic catalog data. |
| `apps/frontend/core/hooks/useSellerReviews.ts` | Modify | Select `shipment_id`, `product_id`, `created_at`; return strict display DTO with `isVerifiedPurchase`, nullable `comment`, and `displayReviews` filtering. |
| `apps/frontend/components/features/users/UserReviewCard.tsx` | Modify | Render verified badge only when `isVerifiedPurchase`; show localized date from `created_at`; improve accessibility label without claiming verification for legacy rows. |
| `apps/frontend/components/ui/SegmentedControl.tsx` | Modify | Fix selected text contrast and add accessible tab/button labels/state. |
| `apps/frontend/core/i18n/locales/{en,es}/profile.json` | Modify | Add public-profile empty/error/retry/tab/review/date/a11y copy keys. |
| `apps/frontend/components/features/profile/ReviewModal.tsx`, `apps/frontend/core/hooks/useReviewAction.ts`, `apps/frontend/app/profile/orders/[id].tsx` | Follow-up | Replace order-first review creation only after orders/multi-seller fix provides `(shipment_id, product_id, seller_id)`. |

## Interfaces / Contracts

```ts
type SellerReviewDisplay = {
  id: string;
  created_at: string; // confirmed in reviews Row
  rating: number;
  comment: string | null;
  shipment_id: string | null;
  product_id: string | null;
  isVerifiedPurchase: boolean; // shipment_id && product_id
  reviewer: { username: string | null; avatar_url: string | null } | null;
  product: { name: string } | null;
};
```

Query requirements: reviews read by `.eq('seller_id', sellerId)`. Public listings read by seller id, `deleted_at IS NULL`, and `status = 'VERIFIED'`. No review filtering/sorting UI is introduced.

## Error, Privacy, Accessibility, and i18n Design

Profile errors block the screen with retry/back. Products and reviews errors are scoped to their tab with retry. Empty listings/reviews remain neutral empty states. The public route reads only `profiles`, `products`, and `reviews`; never `profiles_private`. Owner views hide `OptionsMenu`. Interactive product cards and segmented controls expose roles, labels, selected state, and minimum touch targets. All new visible strings and accessibility labels use i18n keys; dates use locale-aware formatting.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | `useSellerReviews` mapping: linked, legacy, rating-only, nullable comments | `bun test` with mocked Supabase response and DTO assertions. |
| Component | Public profile route guard, owner menu hiding, error vs empty states, verified badge/date rendering | React Native Testing Library where available; otherwise focused component tests. |
| Integration | Products query remains seller-scoped and verified-only; retry refetches correct query | Hook tests with query client and Supabase mock. |

## Migration / Rollout

No data migration required. Roll out as a client-only hardening slice. Existing unlinked reviews remain visible without verified badges. Follow-up must complete review creation with `(reviewer_id, shipment_id, product_id)` once orders/multi-seller shipment item context is fixed.

## Open Questions

- None blocking. Follow-up dependency: orders/multi-seller review creation completion.
