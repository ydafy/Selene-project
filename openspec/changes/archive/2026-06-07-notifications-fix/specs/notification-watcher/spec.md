# Delta for Notification Watcher

## ADDED Requirements

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

The system SHALL replace the mutable `useRef<boolean>` guard for `isInitialLoadDone` with a stable mechanism that correctly handles empty states. The guard SHALL NOT prevent processing of unread notifications when the initial fetch returns zero results but new notifications arrive via realtime.

#### Scenario: Initial load with unread notifications

- GIVEN the user has unread notifications on first mount
- WHEN the initial fetch returns data
- THEN the first notification is processed and the load-complete flag is set

#### Scenario: Initial load with zero unread — realtime still works

- GIVEN the user has zero unread notifications on first mount
- WHEN the initial fetch returns empty
- THEN the realtime subscription remains active and processes incoming notifications normally

#### Scenario: Guard survives component re-renders

- GIVEN the NotificationWatcher re-renders due to parent state changes
- WHEN the `isInitialLoadDone` flag is checked
- THEN the flag retains its value and does not reset to false

## MODIFIED Requirements

### Requirement: NotificationWatcher Realtime Integration

The NotificationWatcher SHALL consume notifications from the single realtime subscription and route them through the `NotificationService` abstraction (CONF-010), NOT directly to UI components. The watcher SHALL listen for both INSERT and UPDATE events on the notifications table.

#### Scenario: Watcher processes INSERT events

- GIVEN a new notification is inserted in the database
- WHEN the realtime channel fires an INSERT payload
- THEN the notification is passed to `NotificationService.dispatch()` for routing
(Previously: Watcher called `processIncoming()` directly with `payload.new as Notification`)

#### Scenario: Watcher processes UPDATE events for read state

- GIVEN an existing notification is marked as read from another device
- WHEN the realtime channel fires an UPDATE payload
- THEN the query cache is invalidated so the list reflects the new read state
(Previously: Watcher only listened for INSERT events)

### Requirement: Type Safety in Watcher

All notification payloads in the NotificationWatcher SHALL use the `Notification` type from `@selene/types`. The `/* eslint-disable @typescript-eslint/no-explicit-any */` directive SHALL be removed.

#### Scenario: Payload typed correctly

- GIVEN a realtime INSERT payload arrives
- WHEN the payload is processed
- THEN `payload.new` is cast as `Notification` — NO `any` type in the file
(Previously: File had `eslint-disable` for `no-explicit-any` and used `as any` casts)
