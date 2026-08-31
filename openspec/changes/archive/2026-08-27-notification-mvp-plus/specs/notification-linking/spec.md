# Delta for Notification Linking

## MODIFIED Requirements

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

## Delta from Existing Spec

- Strengthens CONF-011-B to explicitly await `router.push` and handle both synchronous and asynchronous errors with fallback navigation.
