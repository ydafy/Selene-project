# Notification Linking Specification

## Purpose

Deep-link handler that maps notification `action_path` strings to validated Expo Router navigation paths with safe fallback behavior.

## Requirements

### Requirement: Path Validation

**ID**: CONF-011-A
**Priority**: P0

The system SHALL validate `action_path` strings against known Expo Router routes before navigation. Paths that do not match any registered route SHALL be rejected and trigger fallback navigation.

#### Scenario: Known route passes validation

- GIVEN `action_path` is `/profile/orders/123`
- WHEN the path is validated against the route map
- THEN validation passes — the route exists in the app

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

The system SHALL execute navigation via `await router.push(path)` from `expo-router` after path validation. Navigation calls SHALL be wrapped in `try/catch`; any thrown error SHALL trigger fallback navigation to `/profile/notifications`.

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
