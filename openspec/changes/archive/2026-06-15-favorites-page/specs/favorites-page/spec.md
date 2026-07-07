# Delta for Favorites Page

## ADDED Requirements

### Requirement: FAUV-001 — Favorites Screen Rendering

The system MUST provide a full-screen route at `/profile/favorites` that displays all favorited products for the authenticated user, not limited to a fixed count. The screen SHALL follow the existing mobile screen pattern with `GlobalHeader`, a back button, hidden native stack header, and a data-driven list of products.

#### Scenario: Authenticated user navigates to favorites screen

- GIVEN user is authenticated with a valid session
- WHEN user navigates to `/profile/favorites`
- THEN the system renders the favorites list with translated title and back navigation

#### Scenario: Favorites screen renders existing favorites data

- GIVEN user has favorited products
- WHEN the favorites screen loads
- THEN all available favorites render in a virtualized list using existing product card UI

### Requirement: FAUV-002 — Pagination and Infinite Scroll

The system MUST support paginated loading of favorites via Supabase range queries. The profile favorites preview MUST remain backward-compatible with the existing default limit, while the dedicated favorites screen MUST load full results in pages.

#### Scenario: Initial page load fetches first batch

- GIVEN user has more favorites than one page
- WHEN the favorites screen mounts
- THEN the system fetches the first page using a bounded range query

#### Scenario: Scrolling triggers next page load

- GIVEN more favorites are available
- WHEN user scrolls near the end of the loaded list
- THEN the system fetches the next page and appends it without duplicates

#### Scenario: Profile preview remains limited

- GIVEN the profile tab renders favorites preview
- WHEN the preview hook is called without full-list options
- THEN the preview remains limited for backward compatibility

### Requirement: FAUV-003 — Pull-to-Refresh

The favorites screen MUST support native pull-to-refresh and re-fetch favorites while preserving a clear loading/refreshing state.

#### Scenario: User pulls to refresh

- GIVEN user is viewing favorites
- WHEN user pulls down to refresh
- THEN the system re-fetches favorites and updates the visible list

### Requirement: FAUV-004 — Empty State with CTA

When the user has no favorited products, the screen MUST display an empty state with a heart icon, translated title/message, and a CTA that navigates to the browse/home screen.

#### Scenario: User with no favorites views the screen

- GIVEN user has zero favorites
- WHEN the favorites screen loads
- THEN an empty state with translated copy and browse CTA is displayed

#### Scenario: User taps the CTA

- GIVEN the empty state is displayed
- WHEN user taps the CTA
- THEN the system navigates to the home/browse screen

### Requirement: FAUV-005 — Navigation Wiring

The profile favorites “View all” entry point and any existing home favorites entry point MUST navigate to `/profile/favorites`.

#### Scenario: Tapping view-all on profile

- GIVEN user is viewing the profile favorites preview
- WHEN user taps the view-all action
- THEN the app navigates to `/profile/favorites`

### Requirement: FAUV-006 — Optimistic Toggle on Favorites Page

When a user unfavorites a product on the favorites screen, the item MUST be removed optimistically and the favorites query MUST be invalidated/refetched through the existing favorite mutation path.

#### Scenario: User unfavorites a product

- GIVEN user is viewing favorites
- WHEN user toggles a favorite off
- THEN the product is removed from the visible list immediately
- AND server/query state is refreshed after mutation settlement

#### Scenario: Unfavorite mutation fails

- GIVEN the optimistic removal is active
- WHEN the mutation fails
- THEN the item is restored or refreshed back into the list according to existing error handling

### Requirement: FAUV-007 — Internationalization

All user-facing favorites screen strings MUST be defined in both Spanish and English profile locale files.

#### Scenario: Spanish locale renders Spanish strings

- GIVEN locale is Spanish
- WHEN user views the favorites screen
- THEN title, empty state, and CTA use Spanish translations

#### Scenario: English locale renders English strings

- GIVEN locale is English
- WHEN user views the favorites screen
- THEN title, empty state, and CTA use English translations

### Requirement: FAUV-008 — Loading and Error States

The favorites screen MUST display a skeleton or loading state during initial load, an error state with retry when fetch fails, and a refresh state during pull-to-refresh.

#### Scenario: Initial data loading

- GIVEN data is still loading
- WHEN the screen renders
- THEN loading placeholders are displayed

#### Scenario: Fetch error with retry

- GIVEN the favorites fetch fails
- WHEN the error state is reached
- THEN an error state with retry is rendered

## MODIFIED Requirements

_(None — this is a new capability.)_

## REMOVED Requirements

_(None.)_
