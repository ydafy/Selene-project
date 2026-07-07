# Proposal: Favorites Page

## Intent

The `/profile/favorites` route is referenced by the home screen header and the "Ver todos" button on the profile page, but **the screen file does not exist**. Users who tap either entry point hit a dead-end. This change creates the dedicated favorites screen and wires up the existing data layer so users can browse ALL their favorited products with pagination, pull-to-refresh, and an empty-state CTA.

## Scope

### In Scope
- Create `apps/frontend/app/profile/favorites.tsx` — full-screen favorites list
- Add `limit` parameter to `useMyFavorites` (or create `useAllFavorites`) to remove the `.limit(6)` hardcode
- Wire `ProfileFavoritesGrid` "Ver todos" `TouchableOpacity` to navigate to `/profile/favorites`
- Wire home screen heart icon to `/profile/favorites` (already routes there — verify it resolves)
- Add i18n keys for the dedicated screen (title, empty state with CTA)
- Reuse existing components: `ProductCard`, `GlobalHeader`, `EmptyState`, `FlashList`, pull-to-refresh

### Out of Scope
- New database tables or RLS policies (favorites table already exists)
- New toggle/unfavorite logic (useProductFavorite already works)
- Admin dashboard changes
- Search/filter within favorites (future enhancement)
- Batch remove or reorder favorites (future enhancement)

## Capabilities

> Research of `openspec/specs/` — only `shipments/spec.md` exists. No existing favorites capability spec.

### New Capabilities
- `favorites-page`: Dedicated screen for browsing all favorited products with pagination, pull-to-refresh, and empty-state CTA

### Modified Capabilities
- None (no existing spec-level capability is changing — this is purely additive UI)

## Approach

1. **Hook update**: Add an optional `limit` param to `useMyFavorites(userId, options?)` where `options.limit` defaults to `6` for backward compatibility. When omitted or set to `0`, fetches all favorites with pagination via Supabase range queries.
2. **Screen creation**: Create `favorites.tsx` following the pattern from `notifications.tsx` and `listings.tsx` — `GlobalHeader` with back button, `FlashList` of `ProductCard` items (masonry-ish grid or list), `RefreshControl`, skeleton loading, `EmptyState` with CTA.
3. **Navigation wiring**: Add `onPress` to `ProfileFavoritesGrid`'s "Ver todos" button → `router.push('/profile/favorites')`.
4. **i18n**: Add `favorites.title`, `favorites.emptyTitle`, `favorites.emptyMsg` keys to both `es/profile.json` and `en/profile.json`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/frontend/app/profile/favorites.tsx` | New | New screen file |
| `apps/frontend/core/hooks/useMyFavorites.ts` | Modified | Add `limit` param, default `6`, support unlimited |
| `apps/frontend/components/features/profile/ProfileFavoritesGrid.tsx` | Modified | Wire "Ver todos" onPress handler |
| `apps/frontend/core/i18n/locales/es/profile.json` | Modified | Add `favorites.*` keys |
| `apps/frontend/core/i18n/locales/en/profile.json` | Modified | Add `favorites.*` keys |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Performance with large favorite lists | Low | FlashList handles virtualization; Supabase pagination via range queries |
| Race condition: toggle favorite while on favorites page | Low | `useProductFavorite` already invalidates `my-favorites` query on toggle |
| Route not resolving (no `_layout.tsx` in profile/) | Medium | Profile routes use root `_layout.tsx` Stack — verify by testing navigation |

## Rollback Plan

Delete `favorites.tsx`, revert `useMyFavorites.ts` to hardcode `.limit(6)`, remove `onPress` from "Ver todos", remove i18n keys. Zero database changes = zero migration risk.

## Dependencies

- Existing `useMyFavorites` hook
- Existing `useProductFavorite` hook (for toggle within the page)
- Existing `ProductCard` component
- Existing `GlobalHeader`, `EmptyState` components
- Expo Router Stack in `app/_layout.tsx`

## Success Criteria

- [ ] Navigating to `/profile/favorites` renders the full favorites screen
- [ ] Tapping "Ver todos" on profile navigates to favorites screen
- [ ] Tapping heart icon on home screen navigates to favorites screen
- [ ] Favorites screen shows all favorites (not limited to 6)
- [ ] Pull-to-refresh works and re-fetches favorites
- [ ] Empty state shows CTA to browse products
- [ ] Toggling a favorite on this screen updates the list with optimistic UI
- [ ] Existing profile page grid still shows 6 favorites (backward compatible)