# Notification Pagination Specification

## Purpose

Cursor-based infinite scroll pagination for the notification list, enabling efficient loading of large notification histories without fetching all records at once.

## Requirements

### Requirement: Cursor-Based Pagination Query

**ID**: CONF-009-A
**Priority**: P0

The system SHALL use `useInfiniteQuery` from `@tanstack/react-query` with a page size of 20 items. The cursor SHALL be derived from the last item's `(created_at, id)` tuple to ensure stable ordering across pages.

#### Scenario: First page fetches 20 most recent

- GIVEN a user has 100 notifications
- WHEN the first page query executes
- THEN 20 notifications are returned, ordered by `created_at DESC, id DESC`

#### Scenario: Next page uses cursor from last item

- GIVEN page 1 returned items with last item `(created_at: '2024-01-15', id: 'uuid-abc')`
- WHEN `fetchNextPage()` is called
- THEN the query uses `.lt('created_at', '2024-01-15').or('created_at.eq.2024-01-15,id.lt.uuid-abc')` and returns the next 20 items

#### Scenario: No more pages when cursor reaches end

- GIVEN all notifications have been loaded
- WHEN `fetchNextPage()` is called
- THEN zero items are returned and `hasNextPage` is false

### Requirement: Pull-to-Refresh Integration

**ID**: CONF-009-B
**Priority**: P1

The system SHALL support pull-to-refresh via `RefreshControl` that invalidates the entire infinite query cache and resets to page 1.

#### Scenario: Pull-to-refresh resets pagination

- GIVEN the user has loaded 3 pages (60 items)
- WHEN the user pulls to refresh
- THEN the cache is invalidated, page 1 refetches, and subsequent pages re-fetch on scroll

#### Scenario: Pull-to-refresh preserves existing list during fetch

- GIVEN the user has cached notifications
- WHEN pull-to-refresh triggers
- THEN the existing list remains visible — NO skeleton flash during refetch

### Requirement: Performance Threshold

**ID**: CONF-009-C
**Priority**: P2

The system SHALL maintain a `staleTime` of 30 seconds for the notification list query to balance freshness with network efficiency.

#### Scenario: Query uses cached data within stale window

- GIVEN the list was fetched 15 seconds ago
- WHEN the component remounts
- THEN cached data is displayed — no refetch

#### Scenario: Query refetches after stale window

- GIVEN the list was fetched 60 seconds ago
- WHEN the component remounts
- THEN a background refetch is triggered
