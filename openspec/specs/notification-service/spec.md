# Notification Service Specification

## Purpose

Abstract service layer that routes notifications from any source (realtime DB listener today, Expo Push later) to UI consumers. Decouples notification delivery mechanism from UI presentation.

## Requirements

### Requirement: Service Abstraction Interface

**ID**: CONF-010
**Priority**: P0

The system SHALL provide a `NotificationService` module at `core/services/notification.ts` that exposes: `dispatch(notification: Notification)` for incoming notifications, `subscribe(listener: NotificationListener)` for UI consumers, and `unsubscribe(listenerId: string)` for cleanup.

#### Scenario: Dispatch routes to all subscribers

- GIVEN two UI components subscribe to `NotificationService`
- WHEN `dispatch(notification)` is called
- THEN both subscribers receive the notification in their callback

#### Scenario: Unsubscribe prevents further delivery

- GIVEN a component subscribed and then called `unsubscribe(listenerId)`
- WHEN `dispatch(notification)` is called
- THEN the unsubscribed component does NOT receive the notification

#### Scenario: Service accepts notifications from any source

- GIVEN the service receives a notification from realtime DB
- WHEN `dispatch()` is called
- THEN the notification is routed to subscribers — source is opaque to consumers

#### Scenario: Service is push-notification ready

- GIVEN Expo Push Notifications are integrated in the future
- WHEN a push notification arrives and is parsed to `Notification` type
- THEN `dispatch()` routes it identically to realtime-sourced notifications — NO UI changes needed

### Requirement: Notification Linking Service

**ID**: CONF-011
**Priority**: P0

The system SHALL provide a `NotificationLinking` module that validates `action_path` strings against the Expo Router route map and navigates to the resolved path. Invalid or missing `action_path` values SHALL fallback to `/profile/notifications`.

#### Scenario: Valid action_path navigates correctly

- GIVEN a notification with `action_path: '/profile/orders/123'`
- WHEN `NotificationLinking.navigate(action_path)` is called
- THEN the app navigates to `/profile/orders/123` via `router.push()`

#### Scenario: Invalid action_path falls back safely

- GIVEN a notification with `action_path: '/nonexistent/route'`
- WHEN `NotificationLinking.navigate(action_path)` is called
- THEN the app navigates to `/profile/notifications` (fallback) — no crash

#### Scenario: Missing action_path falls back

- GIVEN a notification with `action_path: null` or `undefined`
- WHEN `NotificationLinking.navigate(action_path)` is called
- THEN the app navigates to `/profile/notifications` (fallback)

#### Scenario: Profile path redirects to listings

- GIVEN a notification with `action_path: '/profile'`
- WHEN `NotificationLinking.navigate(action_path)` is called
- THEN the app navigates to `/profile/listings` — NOT `/profile` (legacy redirect preserved)
