# Delta for Notifications List

## ADDED Requirements

### Requirement: Split Monolithic Hook

**ID**: CONF-001
**Priority**: P0

The system SHALL provide two separate hooks: `useNotificationsList` (query-only, returns `useInfiniteQuery` result) and `useNotificationMutations` (mutations-only, exposes `markAsRead` and `markAllAsRead`). The legacy `useNotifications` hook SHALL be removed.

#### Scenario: Consumer uses list hook without side effects

- GIVEN a component needs to display the notification list
- WHEN the component calls `useNotificationsList(userId)`
- THEN it receives paginated data, loading states, and fetch functions — NO realtime channel is created

#### Scenario: Consumer uses mutations hook independently

- GIVEN a component needs to mark notifications as read
- WHEN the component calls `useNotificationMutations(userId)`
- THEN it receives `markAsRead(id)` and `markAllAsRead()` functions — NO query is triggered

#### Scenario: Legacy hook is removed

- GIVEN the codebase references `useNotifications`
- WHEN a developer imports from `core/hooks/useNotifications`
- THEN the import SHALL fail — the file no longer exists

### Requirement: Cursor-Based Infinite Scroll Pagination

**ID**: CONF-009
**Priority**: P0

The system SHALL implement cursor-based infinite scroll pagination using `useInfiniteQuery` with a page size of 20 items. The cursor SHALL be derived from `(created_at, id)` to ensure stable ordering.

#### Scenario: Initial page loads 20 items

- GIVEN a user opens the notifications screen with 50+ notifications
- WHEN the list hook executes the first page query
- THEN it returns the 20 most recent notifications ordered by `created_at DESC, id DESC`

#### Scenario: Fetch next page with cursor

- GIVEN the user has loaded page 1 and scrolls to the bottom
- WHEN `fetchNextPage()` is called
- THEN the query uses the last item's `(created_at, id)` as cursor and returns the next 20 items

#### Scenario: Pull-to-refresh resets pagination

- GIVEN the user has loaded multiple pages
- WHEN the user performs a pull-to-refresh gesture
- THEN the query cache is invalidated and pagination resets to page 1

### Requirement: Skeleton Anti-Pattern Fix

**ID**: CONF-007
**Priority**: P1

The system SHALL display skeleton loaders ONLY during the initial load (`isLoading === true`). During refetch or pull-to-refresh (`isRefetching === true`), the system SHALL render the existing cached list without skeleton overlay.

#### Scenario: Skeletons shown on initial load

- GIVEN the notification list has no cached data
- WHEN `isLoading` is true
- THEN skeleton placeholders are rendered

#### Scenario: No skeletons during refetch

- GIVEN the notification list has cached data from a previous load
- WHEN `isRefetching` is true (pull-to-refresh or background refetch)
- THEN the existing cached list is displayed — NO skeleton overlay appears

#### Scenario: Empty state after initial load completes

- GIVEN the query completes with zero results
- WHEN `isLoading` becomes false and `data` is empty
- THEN the empty state component is rendered — NOT skeletons

### Requirement: Fix pressableShadow Typo

**ID**: CONF-008
**Priority**: P1

The system SHALL use the correct theme token `pressableShadow` (not `preseableShadow`) for pressed-state background colors in notification list items.

#### Scenario: Typo corrected in NotificationItem

- GIVEN the NotificationItem component renders a pressed state
- WHEN the user presses a notification item
- THEN the background color uses `theme.colors.pressableShadow` — no undefined token fallback

## MODIFIED Requirements

### Requirement: Notification Screen Integration

The screen SHALL consume `useNotificationsList` for data and `useNotificationMutations` for actions, replacing the monolithic `useNotifications` hook.

#### Scenario: Screen renders with split hooks

- GIVEN the notifications screen mounts
- WHEN it calls both `useNotificationsList` and `useNotificationMutations`
- THEN the list displays paginated data and mark-as-read actions work correctly
(Previously: Screen used single `useNotifications` hook combining query + mutations + realtime)

#### Scenario: Notification press handles typed data

- GIVEN a notification item is pressed
- WHEN `handleNotificationPress(notification: Notification)` is called
- THEN the notification is marked as read and deep-link navigation is triggered — NO `any` cast
(Previously: Handler used `notif: any` parameter with `as never` cast on router.push)
