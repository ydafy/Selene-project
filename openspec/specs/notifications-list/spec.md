# Notifications List Specification

## Requirements

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

The system SHALL implement cursor-based infinite scroll pagination using `useInfiniteQuery` with a page size of 20 items. The cursor SHALL be derived from `(created_at, id)` with the grouped tuple predicate defined in `notification-pagination/spec.md`; a timestamp-only filter drops ties.

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

### Requirement: Notification Item Presentation

**ID**: CONF-101
**Priority**: P1

Each item SHALL retain its semantic event icon, unread indicator, title, message, timestamp, and accessible tap callback. Items SHALL NOT expose separate mark-read or dismiss controls or a per-item confirmation dialog. Only safely validated typed `product.approved_with_note` and `product.rejected` events SHALL italicize the whole message. No message parsing, extracted note, new public payload field, or blanket dispute emphasis is permitted; invalid or legacy metadata uses ordinary message styling.

#### Scenario: User taps a notification

- GIVEN a visible notification item
- WHEN the user taps it
- THEN the screen marks it read and navigates to its validated destination

### Requirement: Clear All Notifications

**ID**: CONF-102
**Priority**: P1

The system SHALL provide a "Clear all" action on the notifications screen. The action SHALL be user-scoped, affect the entire inbox including notifications not yet loaded by pagination, and require explicit confirmation via `ConfirmDialog`.

#### Scenario: User clears the entire inbox

- GIVEN the user has unread and read notifications across multiple pages
- WHEN the user taps "Clear all" and confirms the dialog
- THEN `dismissAll()` marks every user notification as deleted AND the list becomes empty

#### Scenario: Cancelled clear-all leaves inbox unchanged

- GIVEN the clear-all confirmation dialog is visible
- WHEN the user taps "Cancel"
- THEN no mutation runs AND the list remains unchanged

### Requirement: Unread Count Badge

**ID**: CONF-103
**Priority**: P1

The system SHALL render the count of owner-visible, non-dismissed unread notifications inside the bell badge. The displayed count SHALL clip to `9+` when the count is 10 or greater. Opening the inbox, displaying a toast, or showing a digest SHALL NOT change the count; explicit mark-read or dismiss SHALL refresh it.

#### Scenario: Few unread notifications

- GIVEN the user has 3 unread notifications
- WHEN the bell badge renders
- THEN it displays "3"

#### Scenario: Many unread notifications

- GIVEN the user has 24 unread notifications
- WHEN the bell badge renders
- THEN it displays "9+"

### Requirement: Accessibility Labels

**ID**: CONF-104
**Priority**: P2

The system SHALL provide localized accessibility labels for the bell button, notification item taps, and header mark-all/clear-all actions.

#### Scenario: Screen reader focuses bell

- GIVEN a screen reader is active
- WHEN the user focuses the notifications bell
- THEN it announces `notifications:openLabel`

#### Scenario: Screen reader focuses a notification item

- GIVEN a screen reader is active
- WHEN the user focuses a notification item
- THEN it announces the localized read state, event state, title, and message

### Requirement: Notification Screen Integration

The screen SHALL consume `useNotificationsList` for owner-visible data and `useNotificationMutations` for actions, including `markAsRead`, `markAllAsRead`, and `dismissAll`. It SHALL expose a global mark-all-read action distinct from confirmed clear-all. Item taps mark read and navigate; no separate per-card read/dismiss actions are exposed. Clear-all hides items without falsely marking them read. Read state and dismiss state remain independent.

#### Scenario: Screen renders with split hooks

- GIVEN the notifications screen mounts
- WHEN it calls both `useNotificationsList` and `useNotificationMutations`
- THEN the list displays paginated data AND all actions work correctly

#### Scenario: Notification press handles typed data

- GIVEN a notification item is pressed
- WHEN `handleNotificationPress(notification: Notification)` is called
- THEN the notification is marked as read and deep-link navigation is triggered — NO `any` cast

#### Scenario: Header clear-all is wired

- GIVEN the notifications screen renders
- WHEN the user confirms clear-all from the header
- THEN `dismissAll` from `useNotificationMutations` is called
