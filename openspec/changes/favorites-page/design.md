# Design: Favorites Page

## Technical Approach

Create a dedicated `/profile/favorites` screen that renders the authenticated user's complete favorites list with infinite scroll, pull-to-refresh, optimistic unfavorite removal, and empty-state CTA. Reuse existing screen patterns (`notifications.tsx`, `listings.tsx`) and components (`ProductCard`, `GlobalHeader`, `EmptyState`, `ErrorState`). Split the data layer: `useMyFavorites` keeps its current `useQuery` + configurable `limit` for backward compatibility; a new `useAllFavorites` hook uses `useInfiniteQuery` with 20-item pages for the full-screen list.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Hook strategy | Keep `useMyFavorites` (`useQuery`, limit param) + new `useAllFavorites` (`useInfiniteQuery`) | Single hook with union return type | Clean separation of concerns; avoids type complexity and conditional hook logic |
| Pagination | `useInfiniteQuery` with offset-based `.range(from, to)` | Cursor-based (Supabase `cursor`) | Matches existing `useSearchProducts` pattern; favorites are naturally ordered by `created_at DESC` |
| List container | `FlashList` single-column list | `FlatList` or masonry grid | `FlashList` is spec-mandated and already used in `notifications.tsx`; `ProductCard` has `width: 100%` and works in a single column |
| Optimistic unfavorite | Screen-level `removingIds` Set + `toggleFavoriteAsync` | TanStack Query cache surgery on infinite pages | Simpler, less error-prone, and follows the existing `useProductFavorite` mutation pattern |
| ProductCard callback | Add optional `onFavoriteToggle?: (productId, willBeFavorite) => void` | Wrap `ProductCard` or build custom list item | Minimally invasive; keeps `ProductCard` reusable across the app |

## Data Flow

```
Supabase (favorites + products!inner)
    ↓
useAllFavorites — useInfiniteQuery, pageParam × 20, .range(from, to)
    ↓
favorites.tsx — flattens pages, applies optimistic removingIds filter
    ↓
FlashList → ProductCard (onPress → router.push, onFavoriteToggle → remove)
    ↓
useProductFavorite — mutate → invalidate ['my-favorites'] & ['all-favorites']
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/frontend/app/profile/favorites.tsx` | Create | New screen: GlobalHeader, FlashList, ProductCard, EmptyState with CTA, ErrorState with retry, RefreshControl, skeleton loading |
| `apps/frontend/core/hooks/useAllFavorites.ts` | Create | `useInfiniteQuery` hook, 20/page, `.range()`, `count: 'exact'`, queryKey `['all-favorites', userId]` |
| `apps/frontend/core/hooks/useMyFavorites.ts` | Modify | Add optional `limit` param (default 6), keep `useQuery` |
| `apps/frontend/core/hooks/useProductFavorite.ts` | Modify | Expose `isToggling` and `toggleFavoriteAsync`; invalidate `['all-favorites']` prefix on settled |
| `apps/frontend/components/features/product/ProductCard.tsx` | Modify | Add optional `onFavoriteToggle` prop forwarded to `ProductFavoriteButton` |
| `apps/frontend/components/features/profile/ProfileFavoritesGrid.tsx` | Modify | Wire `TouchableOpacity` "Ver todos" → `router.push('/profile/favorites')` |
| `apps/frontend/core/i18n/locales/es/profile.json` | Modify | Add `favorites.title`, `favorites.emptyTitle`, `favorites.emptyMsg`, `favorites.cta` |
| `apps/frontend/core/i18n/locales/en/profile.json` | Modify | Same keys in English |

## Interfaces / Contracts

```typescript
// useAllFavorites.ts
export const useAllFavorites = (userId: string | undefined) =>
  useInfiniteQuery<{
    data: Product[];
    nextPage: number | undefined;
  }>({...});

// ProductCard.tsx — additive change
type ProductCardProps = {
  product: Product;
  onPress: (product: Product) => void;
  imageHeight: number;
  index?: number;
  onFavoriteToggle?: (productId: string, willBeFavorite: boolean) => void;
};
```

## State Management

- **Server state**: TanStack Query exclusively (`useAllFavorites`, `useProductFavorite`). No Zustand store needed.
- **Optimistic filter**: Local `useState<Set<string>>` for `removingIds`. When `onFavoriteToggle` fires with `willBeFavorite === false`, add `productId` to the set and call `toggleFavoriteAsync()`. On error, delete from set. On success, let query invalidation refetch and clear the set.
- **Refresh**: `useSeleneRefresh(refetch)` coordinates the RefreshControl spinner.

## Navigation

- `ProfileFavoritesGrid`: `router.push('/profile/favorites')` on "Ver todos" tap.
- Home screen heart icon already routes to `/profile/favorites` (verified in `index.tsx`).
- Expo Router auto-discovers `app/profile/favorites.tsx`; no `_layout.tsx` changes required because `profile/` sits under the root `Stack`.

## Error Handling

- **Initial load error**: Render `<ErrorState onRetry={refetch} />` (matches `notifications.tsx` pattern).
- **Refresh error**: Handled by TanStack Query; list keeps existing data and shows the refresh spinner stopping.
- **Mutation error**: `toggleFavoriteAsync` throws on failure; screen catches, removes id from `removingIds`, and item reappears. Optionally show a toast.
- **Auth**: Unauthenticated users hitting the route are handled by existing auth patterns (the `AuthProvider` / `AuthModalProvider` guards).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `useAllFavorites` pagination math | Mock Supabase client, assert `.range(from, to)` calls |
| Unit | `useMyFavorites` backward compat | Assert default `.limit(6)` and custom limit |
| Integration | Favorites screen render → list → empty state | Render with MSW/TanStack Query test utils |
| Integration | Optimistic unfavorite + rollback | Trigger toggle, assert item hidden, mock error, assert item restored |

## Migration / Rollout

No database or backend changes. Purely additive UI. Rollback: delete `favorites.tsx`, `useAllFavorites.ts`, revert hooks and i18n, remove `onFavoriteToggle` prop.

## Open Questions

- None — all technical decisions resolved.
