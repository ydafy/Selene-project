# Delta Spec: favorites-page

> **Change**: favorites-page  
> **Type**: NEW capability (no existing spec to modify)  
> **Status**: Draft

---

## ADDED Requirements

### Requirement: FAUV-001 — Favorites Screen Rendering

**Priority**: HIGH

The system MUST provide a full-screen route at `/profile/favorites` that displays all favorited products for the authenticated user, not limited to a fixed count.

The screen SHALL follow the established pattern from `notifications.tsx` and `listings.tsx`: use `GlobalHeader` with a back button, `Stack.Screen options={{ headerShown: false }}`, and a data-driven list of products.

#### Scenario: Authenticated user navigates to favorites screen

- GIVEN user is authenticated with a valid session
- WHEN user navigates to `/profile/favorites`
- THEN the system renders a full-screen favorites list with `GlobalHeader` showing the translated title
- AND the back button returns to the previous screen

#### Scenario: Unauthenticated user navigates to favorites screen

- GIVEN user is NOT authenticated
- WHEN user navigates to `/profile/favorites`
- THEN the system redirects to login or shows a guest prompt (matching existing auth-guard patterns)

#### Scenario: Favorites screen renders with existing favorites data

- GIVEN user is authenticated and has 12 favorited products
- WHEN the favorites screen loads
- THEN all 12 products render in a virtualized list using `FlashList`
- AND each item displays via `ProductCard` component with correct product data

---

### Requirement: FAUV-002 — Pagination and Infinite Scroll

**Priority**: HIGH

The system MUST support paginated loading of favorites via Supabase range queries. Initial load fetches the first page; additional pages load automatically as the user scrolls near the end of the list.

The `useMyFavorites` hook SHALL accept an optional `options` parameter: `{ limit?: number }`. Default `limit` is `6` (backward compatible). When `limit` is `0` or undefined for the favorites screen call, the hook MUST fetch all favorites with cursor-based pagination using `from/to` range queries, loading in pages of 20 items.

#### Scenario: Initial page load fetches first batch

- GIVEN user has 50 favorited products
- WHEN the favorites screen mounts
- THEN the system fetches the first 20 products from Supabase using `.range(0, 19)`
- AND renders them in the list

#### Scenario: Scrolling triggers next page load

- GIVEN user has 50 favorited products and is viewing the first 20
- WHEN user scrolls near the end of the loaded items
- THEN the system fetches the next 20 products using `.range(20, 39)`
- AND appends them to the existing list without duplicating items

#### Scenario: All items loaded — no more fetching

- GIVEN user has 12 favorited products and all 12 are displayed
- WHEN user scrolls to the bottom of the list
- THEN no additional fetch is triggered
- AND the list shows all items without a loading indicator

#### Scenario: ProfileFavoritesGrid still shows only 6 items (backward compatibility)

- GIVEN the profile tab screen calls `useMyFavorites(userId)` with no options
- WHEN the hook returns data
- THEN only 6 products are returned (default limit)
- AND the profile grid renders exactly as before

---

### Requirement: FAUV-003 — Pull-to-Refresh

**Priority**: MEDIUM

The favorites screen MUST support pull-to-refresh using `RefreshControl` (matching the pattern in `notifications.tsx` and `listings.tsx`). Pulling down triggers a full re-fetch of the favorites list, replacing allcached data.

The screen SHALL use `RefreshControl` for native pull-to-refresh feedback, and show skeleton loading during both initial load and refresh. The skeleton shimmer provides clear visual confirmation that data is being refreshed, which feels faster than a static list with just a spinner.

#### Scenario: User pulls to refresh with favorites

- GIVEN user is viewing their favorites list
- WHEN user pulls down to refresh
- THEN the `RefreshControl` spinner appears
- AND the system re-fetches all favorites from the server
- AND the list updates with fresh data

#### Scenario: User pulls to refresh with empty favorites

- GIVEN user has no favorited products
- WHEN user pulls down to refresh
- THEN the refresh spinner appears and completes
- AND the empty state remains displayed

---

### Requirement: FAUV-004 — Empty State with CTA

**Priority**: HIGH

When the user has no favorited products, the screen MUST display an `EmptyState` component with:
- Icon: `heart-outline` (MaterialCommunityIcons)
- Title: `profile:favorites.emptyTitle`
- Message: `profile:favorites.emptyMsg`
- A CTA button that navigates to the home/browse screen

#### Scenario: User with no favorites views the screen

- GIVEN user is authenticated with zero favorited products
- WHEN the favorites screen loads
- THEN an `EmptyState` is rendered with icon `heart-outline`
- AND title displays the i18n key `favorites.emptyTitle`
- AND message displays the i18n key `favorites.emptyMsg`

#### Scenario: User taps the CTA in empty state

- GIVEN the empty state is displayed
- WHEN user taps the CTA button
- THEN the system navigates to the home/browse products screen (`/(tabs)`)

#### Scenario: User unfavorites their last item

- GIVEN user has exactly 1 favorited product
- WHEN user removes the favorite on the favorites screen
- AND the list becomes empty
- THEN the screen transitions from the product list to the empty state

---

### Requirement: FAUV-005 — Navigation Wiring

**Priority**: HIGH

The "Ver todos" button in `ProfileFavoritesGrid` MUST navigate to `/profile/favorites` via `router.push`. The home screen heart icon (if it exists) MUST also route to `/profile/favorites`.

#### Scenario: Tapping "Ver todos" on profile tab

- GIVEN user is viewing their profile tab with favorites visible
- WHEN user taps the "Ver todos" text button
- THEN `router.push('/profile/favorites')` is called
- AND the favorites screen renders with all favorites

#### Scenario: Tapping heart icon on home screen

- GIVEN user is on the home screen
- WHEN user taps the heart/favorites icon
- THEN `router.push('/profile/favorites')` is called
- AND the favorites screen renders

#### Scenario: Back navigation from favorites screen

- GIVEN user is on the favorites screen (navigated from profile)
- WHEN user taps the back button
- THEN the system navigates back to the previous screen

---

### Requirement: FAUV-006 — Optimistic Toggle on Favorites Page

**Priority**: MEDIUM

When a user unfavorites a product on the favorites screen, the item MUST be removed from the list with an optimistic UI update. The screen SHALL use the existing `useProductFavorite` hook's `toggleFavorite` mutation, which already invalidates the `my-favorites` query on success.

After the `my-favorites` query is invalidated by `useProductFavorite`, the favorites list SHALL re-fetch and reflect the removal. If the mutation fails, the item SHALL re-appear in the list.

#### Scenario: User unfavorites a product on the favorites screen

- GIVEN user is viewing their favorites list
- WHEN user taps the favorite button on a `ProductCard`
- THEN the product is immediately removed from the list (optimistic)
- AND the remaining products reflow in the virtualized list

#### Scenario: Unfavorite mutation fails — rollback

- GIVEN user unfavorites a product on the favorites screen
- WHEN the Supabase delete mutation returns an error
- THEN the product re-appears in the list at its original position
- AND a toast or visual indicator shows the failure (matching existing error patterns)

#### Scenario: User unfavorites their last product

- GIVEN user has 1 favorite remaining
- WHEN user unfavorites it
- AND the list query re-fetches returning 0 items
- THEN the screen transitions to the empty state

---

### Requirement: FAUV-007 — Internationalization

**Priority**: HIGH

All user-facing strings on the favorites screen MUST be defined as i18n keys in both `es/profile.json` and `en/profile.json`. The following keys SHALL be added:

| Key (ES) | Value (ES) | Key (EN) | Value (EN) |
|----------|-----------|----------|-----------|
| `favorites.title` | "Mis Favoritos" | `favorites.title` | "My Favorites" |
| `favorites.emptyTitle` | "Sin favoritos aún" | `favorites.emptyTitle` | "No favorites yet" |
| `favorites.emptyMsg` | "Explora productos y guarda los que te gusten aquí." | `favorites.emptyMsg` | "Browse products and save the ones you like here." |
| `favorites.cta` | "Explorar productos" | `favorites.cta` | "Browse products" |

#### Scenario: Spanish locale renders Spanish strings

- GIVEN device locale is `es`
- WHEN user views the favorites screen
- THEN title, empty state, and CTA all display in Spanish

#### Scenario: English locale renders English strings

- GIVEN device locale is `en`
- WHEN user views the favorites screen
- THEN title, empty state, and CTA all display in English

---

### Requirement: FAUV-008 — Loading and Error States

**Priority**: MEDIUM

The favorites screen MUST display a skeleton loading state while the initial fetch is in progress (matching the pattern in `notifications.tsx`). If the fetch fails, the screen SHALL display an `ErrorState` component with a retry button.

#### Scenario: Initial data loading

- GIVEN user navigates to favorites screen
- WHEN data is still loading (`isLoading` is true)
- THEN skeleton placeholders are displayed (matching `ProductCardSkeleton` pattern)
- AND no empty state or error state is shown

#### Scenario: Fetch error with retry

- GIVEN the favorites fetch fails with a network error
- WHEN the error state is reached
- THEN an `ErrorState` component is rendered
- AND tapping "Retry" re-triggers the fetch
- AND upon success, the product list replaces the error state

#### Scenario: Refresh during loaded state

- GIVEN user has favorites loaded and is viewing the list
- WHEN pull-to-refresh is triggered
- THEN the refresh spinner appears at the top
- AND skeletons replace the list content (providing visual confirmation of refresh)
- AND upon completion, the list updates with fresh data

---

## MODIFIED Requirements

_(None — this is a new capability with no existing spec to modify)_

---

## REMOVED Requirements

_(None)_