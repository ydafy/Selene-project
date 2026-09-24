# Notification Linking Specification

## Purpose

Deep-link handler that maps notification `action_path` strings to validated Expo Router navigation paths with safe fallback behavior.

## Requirements

### Requirement: Path Validation

**ID**: CONF-011-A
**Priority**: P0

The system SHALL validate `action_path` strings against known Expo Router routes before navigation. New business-event producers SHALL target `/product/{productId}`, `/verify/{productId}`, or `/profile/orders/{orderId}` as specified by the event catalogue. The client SHALL continue accepting safe, registered legacy routes such as `/profile/listings`, `/profile/orders`, and `/profile/wallet` for existing persisted rows. The legacy `/profile` target SHALL redirect to `/profile/listings` rather than falling back or opening `/profile`. Dynamic routes require one nonempty, well-formed ID segment; arbitrary suffixes, queries, external URLs, and schemes SHALL fall back to `/profile/notifications`. Navigation does not grant authorization to view a resource; destination screens enforce access independently.

#### Scenario: Known route passes validation

- GIVEN `action_path` is `/profile/orders/123`
- WHEN the path is validated against the route map
- THEN validation passes — the route exists in the app

#### Scenario: Legacy profile redirect remains valid

- GIVEN an existing notification has `action_path: '/profile'`
- WHEN its destination is resolved
- THEN the app navigates to `/profile/listings`

#### Scenario: Registered legacy destination remains valid

- GIVEN an existing notification has `action_path: '/profile/wallet'`
- WHEN its destination is validated
- THEN navigation is allowed without admitting unregistered paths

#### Scenario: Unknown route fails validation

- GIVEN `action_path` is `/admin/secret-page`
- WHEN the path is validated against the route map
- THEN validation fails — fallback to `/profile/notifications`

#### Scenario: Path with params is valid

- GIVEN `action_path` is `/product/abc-123`
- WHEN the path is validated
- THEN validation passes — dynamic route segments are accepted

### Requirement: Navigation Execution

**ID**: CONF-011-B
**Priority**: P0

The system SHALL execute navigation via `router.push(path)` from `expo-router` after path validation. Catch synchronous errors and, if navigation returns a promise, asynchronous rejection; fallback to `/profile/notifications` without a recursive fallback loop. Missing, unsafe, or unregistered legacy paths also fall back.

#### Scenario: Navigation succeeds

- GIVEN a validated `action_path`
- WHEN `await router.push(path)` resolves
- THEN the screen transitions to the target route

#### Scenario: Navigation error triggers fallback

- GIVEN a validated path that fails at runtime (missing params or invalid state)
- WHEN `await router.push(path)` rejects
- THEN the app navigates to `/profile/notifications` — no unhandled error

#### Scenario: Synchronous router error is caught

- GIVEN `router.push` throws synchronously before returning a promise
- WHEN the navigation wrapper catches the throw
- THEN the app navigates to `/profile/notifications`
