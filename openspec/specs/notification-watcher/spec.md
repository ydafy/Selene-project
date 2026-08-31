# Notification Watcher Specification

## Requirements

### Requirement: Single Realtime Subscription

**ID**: CONF-002
**Priority**: P0

The system SHALL maintain exactly ONE Supabase realtime subscription for notifications per user session. The `NotificationWatcher` component SHALL be the sole owner of this subscription. No other hook or component SHALL create a `notifications_*` channel.

#### Scenario: Only one channel exists after mount

- GIVEN the app mounts with `NotificationWatcher` in the component tree
- WHEN the watcher effect executes
- THEN exactly one Supabase channel named `notifications_realtime_watcher_{userId}` is subscribed

#### Scenario: No duplicate channels from hooks

- GIVEN `useNotificationsList` is called in the notification screen
- WHEN the hook initializes
- THEN NO Supabase channel is created — the hook is query-only

#### Scenario: Channel naming convention enforced

- GIVEN any code creates a Supabase channel for notifications
- WHEN the channel name is audited
- THEN it SHALL match the pattern `notifications_realtime_watcher_{userId}` — only from NotificationWatcher

### Requirement: removeChannel in Cleanup

**ID**: CONF-005
**Priority**: P1

The system SHALL call `supabase.removeChannel(channel)` in all useEffect cleanup functions that create Supabase realtime channels. The call SHALL be fire-and-forget (not awaited) per React's useEffect API — React does NOT support async cleanup functions. The channel removal SHALL be triggered before the effect re-runs or the component unmounts.

#### Scenario: Cleanup calls removeChannel on unmount

- GIVEN the NotificationWatcher component unmounts
- WHEN the cleanup effect executes
- THEN `supabase.removeChannel(channel)` is called

#### Scenario: No callback error on remount

- GIVEN the user navigates away from and back to a screen with realtime
- WHEN the component remounts and subscribes
- THEN no `cannot add postgres_changes callbacks` error is thrown

### Requirement: Fix isInitialLoadDone Race Condition

**ID**: CONF-004
**Priority**: P0

The system SHALL NOT perform an initial-fetch effect for unread notifications. The realtime subscription alone SHALL drive incoming notification processing; the unread badge and notification list provide existing state.

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

### Requirement: NotificationWatcher Realtime Integration

The NotificationWatcher SHALL consume notifications from the single realtime subscription and route them through the `NotificationService` abstraction (CONF-010), NOT directly to UI components. The watcher SHALL listen for both INSERT and UPDATE events on the notifications table.

#### Scenario: Watcher processes INSERT events

- GIVEN a new notification is inserted in the database
- WHEN the realtime channel fires an INSERT payload
- THEN the notification is passed to `NotificationService.dispatch()` for routing

#### Scenario: Watcher processes UPDATE events for read state

- GIVEN an existing notification is marked as read from another device
- WHEN the realtime channel fires an UPDATE payload
- THEN the query cache is invalidated so the list reflects the new read state

### Requirement: Type Safety in Watcher

All notification payloads in the NotificationWatcher SHALL use the `Notification` type from `@selene/types`. The `/* eslint-disable @typescript-eslint/no-explicit-any */` directive SHALL be removed.

#### Scenario: Payload typed correctly

- GIVEN a realtime INSERT payload arrives
- WHEN the payload is processed
- THEN `payload.new` is cast as `Notification` — NO `any` type in the file

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
