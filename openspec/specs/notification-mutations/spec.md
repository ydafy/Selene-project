# Notification Mutations Specification

## Requirements

### Requirement: markAsRead Dual Cache Invalidation

**ID**: CONF-003
**Priority**: P0

The system SHALL invalidate BOTH `['notifications', userId]` AND `['unread-notifications', userId]` query keys when `markAsRead(id)` completes successfully. Both invalidations SHALL occur through the shared invalidation helper.

#### Scenario: markAsRead updates list and badge

- GIVEN a user has 5 unread notifications (badge shows "5")
- WHEN the user marks one notification as read
- THEN the notification list refetches AND the unread badge updates to "4"

#### Scenario: markAsRead handles network error gracefully

- GIVEN the user attempts to mark a notification as read
- WHEN the Supabase update fails (network error, permission denied)
- THEN neither query key is invalidated, the error is logged, AND an error toast is shown

#### Scenario: markAsRead is scoped to user's notifications

- GIVEN a malicious actor attempts to mark another user's notification as read
- WHEN the mutation includes `.eq('user_id', userId)` filter
- THEN the update affects zero rows — the mutation is silently rejected

### Requirement: Type Safety in Mutations

**ID**: CONF-006
**Priority**: P1

The system SHALL use the `Notification` type from `@selene/types` for all notification-related parameters and return values in mutation hooks. Zero `any` types SHALL exist in notification mutation code.

#### Scenario: markAsRead accepts typed ID

- GIVEN `useNotificationMutations` returns `markAsRead`
- WHEN called with `markAsRead(notificationId: string)`
- THEN the parameter is typed as `string` — NO `any` cast required

#### Scenario: markAllAsRead returns typed result

- GIVEN `useNotificationMutations` returns `markAllAsRead`
- WHEN called with `markAllAsRead()`
- THEN the function returns `Promise<void>` — NO `any` in the return chain

### Requirement: markAllAsRead Cache Invalidation

**ID**: CONF-003-MOD
**Priority**: P0

The `markAllAsRead` mutation SHALL invalidate both `['notifications', userId]` and `['unread-notifications', userId]` query keys after successful completion through the shared invalidation helper. The mutation SHALL include the `.eq('read', false)` filter to avoid unnecessary writes.

#### Scenario: markAllAsRead clears badge and list

- GIVEN a user has 10 unread notifications
- WHEN `markAllAsRead()` completes successfully
- THEN both query keys are invalidated — list shows all read, badge shows "0"

#### Scenario: markAllAsRead skips already-read notifications

- GIVEN some notifications are already marked as read
- WHEN `markAllAsRead()` executes
- THEN only unread notifications are updated (`.eq('read', false)`) — no redundant writes

### Requirement: dismissNotification Mutation

**ID**: CONF-201
**Priority**: P1

The system SHALL provide a `dismissNotification(id)` mutation that sets `deleted_at` to the current timestamp for the notification matching `id` AND `user_id`. On success it SHALL invalidate both `['notifications', userId]` and `['unread-notifications', userId]` query keys.

#### Scenario: User dismisses one notification

- GIVEN a user owns a notification with `deleted_at: null`
- WHEN `dismissNotification(id)` executes
- THEN the row is updated with `deleted_at` set AND both query keys invalidate

#### Scenario: Dismiss is scoped to owner

- GIVEN a malicious actor calls `dismissNotification(otherUserNotificationId)`
- WHEN the mutation includes `.eq('user_id', userId)`
- THEN zero rows are affected AND the mutation is silently rejected

### Requirement: dismissAll Mutation

**ID**: CONF-202
**Priority**: P1

The system SHALL provide a `dismissAll()` mutation that sets `deleted_at` for all notifications owned by the user, regardless of read state or pagination visibility. On success it SHALL invalidate both notification query keys.

#### Scenario: User clears the entire inbox

- GIVEN a user has 50 notifications across read/unread and multiple pages
- WHEN `dismissAll()` executes
- THEN every row for that user gets `deleted_at` set AND both query keys invalidate

#### Scenario: dismissAll does not affect other users

- GIVEN another user has notifications in the same table
- WHEN `dismissAll()` runs for the current user
- THEN the other user's notifications remain undeleted

### Requirement: Shared Cache Invalidation Helper

**ID**: CONF-203
**Priority**: P2

The system SHALL expose a single helper function that invalidates `['notifications', userId]` and `['unread-notifications', userId]`. All notification mutations SHALL use this helper.

#### Scenario: Helper is reused by all mutations

- GIVEN `markAsRead`, `markAllAsRead`, `dismissNotification`, and `dismissAll` exist
- WHEN each mutation succeeds
- THEN it calls the same invalidation helper — NO duplicated logic

### Requirement: Mutation Error Feedback

**ID**: CONF-204
**Priority**: P1

The system SHALL surface a localized error toast when any notification mutation fails.

#### Scenario: markAsRead fails

- GIVEN the Supabase update for `markAsRead` fails
- WHEN the mutation's `onError` fires
- THEN `Toast.show({ type: 'error', ... })` displays a localized message

#### Scenario: dismissAll fails

- GIVEN the Supabase update for `dismissAll` fails
- WHEN the mutation's `onError` fires
- THEN an error toast is shown AND the list remains unchanged

### Requirement: Optimistic Badge Update on Dismiss

**ID**: CONF-205
**Priority**: P1

The system SHALL optimistically decrement the unread badge count when a dismiss mutation is invoked. If the mutation fails, the badge count SHALL revert to the server value.

#### Scenario: Dismiss unread notification

- GIVEN the badge shows "5" and the user dismisses an unread notification
- WHEN the mutation starts
- THEN the badge immediately shows "4"

#### Scenario: Dismiss failure reverts badge

- GIVEN the badge was optimistically decremented to "4"
- WHEN the dismiss mutation fails
- THEN the badge reverts to "5"
