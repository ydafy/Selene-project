# Tasks: Favorites Page

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 340–380 |
| 800-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full favorites-page feature | Single PR | All phases; well under 800-line budget |

---

## Phase 1: Foundation (i18n + Hooks)

- [x] **1.1** Add `favorites.*` i18n keys to `apps/frontend/core/i18n/locales/es/profile.json` — `favorites.title`, `favorites.emptyTitle`, `favorites.emptyMsg`, `favorites.cta` (Spanish values per spec FAUV-007)
- [x] **1.2** Add same `favorites.*` keys to `apps/frontend/core/i18n/locales/en/profile.json` (English values per spec FAUV-007)
- [x] **1.3** Modify `apps/frontend/core/hooks/useMyFavorites.ts` — add optional `options?: { limit?: number }` param; default `limit` = 6; when `limit` is `0`, omit `.limit()` call entirely. Keep `useQuery` and queryKey `['my-favorites', userId]` unchanged (FAUV-002 backward compat)
- [x] **1.4** Modify `apps/frontend/core/hooks/useProductFavorite.ts` — (a) expose `toggleFavoriteAsync: mutation.mutateAsync` alongside existing `toggleFavorite`; (b) add `queryClient.invalidateQueries({ queryKey: ['all-favorites'] })` in `onSettled` alongside existing `['my-favorites']` invalidation (FAUV-006)
- [x] **1.5** Create `apps/frontend/core/hooks/useAllFavorites.ts` — `useInfiniteQuery` with queryKey `['all-favorites', userId]`, PAGE_SIZE=20, `.range(from, to)`, `count: 'exact'`, `getNextPageParam` using `count` check (mirror `useSearchProducts` pattern). Select `product:products!inner(*)` filtered by `user_id` + `is('products.deleted_at', null)`, ordered by `created_at DESC` (FAUV-001, FAUV-002)

## Phase 2: Component Wiring

- [x] **2.1** Modify `apps/frontend/components/features/product/ProductFavoriteButton.tsx` — add optional `onFavoriteToggle?: (productId: string, willBeFavorite: boolean) => void` prop; call it after `toggleFavorite()` with `(productId, !isFavorite)` (FAUV-006)
- [x] **2.2** Modify `apps/frontend/components/features/product/ProductCard.tsx` — add optional `onFavoriteToggle` to `ProductCardProps`; forward it to `<ProductFavoriteButton>` (FAUV-006)
- [x] **2.3** Modify `apps/frontend/components/features/profile/ProfileFavoritesGrid.tsx` — add `onPress={() => router.push('/profile/favorites')}` to the "Ver todos" `<TouchableOpacity>` at line 86 (FAUV-005)

## Phase 3: Screen Implementation

- [x] **3.1** Create `apps/frontend/app/profile/favorites.tsx` — full screen following `notifications.tsx` pattern:

## Phase 4: Testing (Strict TDD — bun:test)

- [x] **4.1** Create `apps/frontend/core/hooks/useAllFavorites.test.ts` — mock Supabase client; assert `.range(0, 19)` on first page; assert `.range(20, 39)` on second pageParam; assert `nextPage` is `undefined` when all items loaded
- [x] **4.2** Create `apps/frontend/core/hooks/useMyFavorites.test.ts` — mock Supabase; assert `.limit(6)` called by default; assert `.limit(N)` with custom option; assert no `.limit()` when `limit: 0`

---

### FAUV-TASK-001: Add i18n keys for favorites screen

**Priority**: HIGH
**Depends on**: none
**Estimated lines**: 12
**Files**:
- `apps/frontend/core/i18n/locales/es/profile.json` — modify, add `favorites` object
- `apps/frontend/core/i18n/locales/en/profile.json` — modify, add `favorites` object

**Description**: Add 4 i18n keys under `favorites` namespace in both locale files per spec FAUV-007 table.

**Acceptance criteria**:
- [x] `favorites.title` exists in both locales
- [x] `favorites.emptyTitle` exists in both locales
- [x] `favorites.emptyMsg` exists in both locales
- [x] `favorites.cta` exists in both locales

### FAUV-TASK-002: Add configurable limit to useMyFavorites

**Priority**: HIGH
**Depends on**: none
**Estimated lines**: 8
**Files**:
- `apps/frontend/core/hooks/useMyFavorites.ts` — modify, add options param

**Description**: Add optional `options?: { limit?: number }` parameter. Default limit=6 for backward compat. When limit=0, omit `.limit()` entirely.

**Acceptance criteria**:
- [x] `useMyFavorites(userId)` still returns max 6 items (backward compat)
- [x] `useMyFavorites(userId, { limit: 10 })` returns max 10 items
- [x] `useMyFavorites(userId, { limit: 0 })` returns all items without limit

**Acceptance criteria**:
- [x] `toggleFavoriteAsync` is returned and returns a Promise
- [x] `onSettled` invalidates both `['my-favorites']` and `['all-favorites']` query prefixes
- [x] Existing `toggleFavorite` (sync mutate) still works unchanged

**Acceptance criteria**:
- [x] Returns `data.pages[]` with `{ data: Product[], nextPage: number | undefined }`
- [x] First page uses `.range(0, 19)`
- [x] `getNextPageParam` returns `undefined` when all items loaded
- [x] queryKey is `['all-favorites', userId]`
- [x] Disabled when `userId` is undefined

**Acceptance criteria**:
- [x] ProductFavoriteButton calls `onFavoriteToggle(productId, !isFavorite)` after toggle
- [x] ProductCard accepts and forwards `onFavoriteToggle` to ProductFavoriteButton
- [x] Both components work identically when prop is omitted (backward compat)

**Acceptance criteria**:
- [x] Tapping "Ver todos" navigates to `/profile/favorites`
- [x] `router` is already imported (confirmed in existing code)

**Acceptance criteria**:
- [x] Route `/profile/favorites` renders the screen
- [x] FlashList renders all favorites (not limited to 6)
- [x] Infinite scroll loads next pages of 20
- [x] Pull-to-refresh re-fetches data
- [x] Optimistic unfavorite removes item immediately; rollback on error
- [x] Empty state shows `heart-outline` icon + CTA navigating to `/(tabs)`
- [x] Skeleton loading during initial fetch
- [x] ErrorState with retry button on fetch failure

**Acceptance criteria**:
- [x] Test: first page calls `.range(0, 19)`
- [x] Test: pageParam=1 calls `.range(20, 39)`
- [x] Test: `nextPage` is undefined when `count <= to + 1`

**Acceptance criteria**:
- [x] Test: default call applies `.limit(6)`
- [x] Test: `{ limit: 10 }` applies `.limit(10)`
- [x] Test: `{ limit: 0 }` omits `.limit()` call
