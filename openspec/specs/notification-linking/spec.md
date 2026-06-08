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

The system SHALL execute navigation via `router.push()` from `expo-router` after path validation. Navigation SHALL be awaited to allow error handling.

#### Scenario: Navigation succeeds

- GIVEN a validated `action_path`
- WHEN `router.push(path)` is called
- THEN the screen transitions to the target route

#### Scenario: Navigation error triggers fallback

- GIVEN a validated path that fails at runtime (missing params)
- WHEN `router.push(path)` throws
- THEN the app navigates to `/profile/notifications` — no unhandled error
