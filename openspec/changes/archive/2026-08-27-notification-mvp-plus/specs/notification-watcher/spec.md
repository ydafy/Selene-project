# Delta for Notification Watcher

## ADDED Requirements

### Requirement: Typed Notification Classification

**ID**: CONF-301
**Priority**: P0

The system SHALL classify incoming realtime notifications by `type` and `action_path` values. Classification SHALL NOT depend on localized title text.

#### Scenario: High-priority notification triggers dialog

- GIVEN a realtime INSERT with `type: 'error'` and `action_path: '/orders/123'`
- WHEN the watcher processes the payload
- THEN it enqueues a dialog because the type/path indicate required action

#### Scenario: Locale change does not break classification

- GIVEN the app locale switches from Spanish to English
- WHEN a notification with the same `type` and `action_path` arrives
- THEN classification produces the same result — NO title-string matching

### Requirement: Queue Skip Semantics

**ID**: CONF-302
**Priority**: P0

The system SHALL provide "Skip" and "Skip all" actions on notification dialogs. "Skip" SHALL advance to the next queued notification. "Skip all" SHALL clear the queue WITHOUT deleting notifications from the database.

#### Scenario: User skips one dialog

- GIVEN three notifications are queued
- WHEN the user taps "Skip"
- THEN the current dialog closes AND the next queued notification is shown

#### Scenario: User skips all dialogs

- GIVEN three notifications are queued
- WHEN the user taps "Skip all"
- THEN all dialogs close AND the notifications remain in the database

### Requirement: Toast Lifecycle Fix

**ID**: CONF-303
**Priority**: P0

The system SHALL rely on `visibilityTime` for automatic toast dismissal. The `react-native-toast-message` v2 `show()` method returns void and does not support id-based `Toast.hide()`. Static `Toast.hide()` calls are prohibited.

#### Scenario: Toast auto-hides after configured duration

- GIVEN a toast is shown with `Toast.show({ visibilityTime: 4000, ... })`
- WHEN the visibility timer expires
- THEN the toast dismisses automatically without any imperative hide call

#### Scenario: New toast replaces previous one

- GIVEN a toast is currently visible
- WHEN a new notification arrives that should show a toast
- THEN `Toast.show(...)` is called again — the v2 library handles replacement internally

### Requirement: Toast Type Mapping

**ID**: CONF-304
**Priority**: P1

The system SHALL map notification `type` values to the corresponding toast type so that `error`, `warning`, `success`, and `info` are visually distinct.

#### Scenario: Error notification shows error toast

- GIVEN a notification with `type: 'error'`
- WHEN the watcher decides to show a toast
- THEN `Toast.show({ type: 'error', ... })` is called

#### Scenario: Warning notification shows warning toast

- GIVEN a notification with `type: 'warning'`
- WHEN the watcher decides to show a toast
- THEN a warning-styled toast is shown — NOT mapped to info

### Requirement: Watcher Error Handling

**ID**: CONF-305
**Priority**: P1

The system SHALL surface a localized error toast if the realtime subscription or any payload handler throws.

#### Scenario: Realtime subscription fails

- GIVEN the Supabase channel subscription throws
- WHEN the error is caught
- THEN `Toast.show({ type: 'error', ... })` displays a localized message

### Requirement: Localized Overflow Count

**ID**: CONF-306
**Priority**: P2

The system SHALL render the remaining queue count using the `notifications:moreCount` key. Hardcoded Spanish strings in the watcher are prohibited.

#### Scenario: Multiple queued notifications

- GIVEN two notifications remain in the queue
- WHEN the dialog renders the overflow indicator
- THEN it displays the localized string for `notifications:moreCount` with count 2

## MODIFIED Requirements

### Requirement: Fix isInitialLoadDone Race Condition

The system SHALL NOT perform an initial-fetch effect for unread notifications. The realtime subscription alone SHALL drive incoming notification processing; the unread badge and notification list provide existing state.
(Previously: The system required a stable mechanism to guard initial load and process the first unread notification.)

#### Scenario: Cold start with no unread notifications

- GIVEN the app starts with zero unread notifications
- WHEN the watcher mounts
- THEN no initial fetch runs AND the realtime subscription remains active

#### Scenario: Cold start with unread notifications

- GIVEN the app starts with existing unread notifications
- WHEN the watcher mounts
- THEN no dialog is auto-shown from an initial fetch AND the user sees the unread badge instead

#### Scenario: Realtime notification arrives after mount

- GIVEN the watcher is active
- WHEN a new notification arrives via realtime
- THEN it is processed through typed classification normally

## Delta from Existing Spec

- Replaces CONF-004 with removal of the initial-load effect and `isInitialLoadDone` ref.
- Adds typed classification (CONF-301), queue skip semantics (CONF-302), toast lifecycle (CONF-303), toast type mapping (CONF-304), watcher error handling (CONF-305), and localized overflow count (CONF-306).
