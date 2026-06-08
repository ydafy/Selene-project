# Delta for Notification Mutations

## ADDED Requirements

### Requirement: markAsRead Dual Cache Invalidation

**ID**: CONF-003
**Priority**: P0

The system SHALL invalidate BOTH `['notifications', userId]` AND `['unread-notifications', userId]` query keys when `markAsRead(id)` completes successfully. Both invalidations SHALL occur in the same mutation handler.

#### Scenario: markAsRead updates list and badge

- GIVEN a user has 5 unread notifications (badge shows "5")
- WHEN the user marks one notification as read
- THEN the notification list refetches AND the unread badge updates to "4"

#### Scenario: markAsRead handles network error gracefully

- GIVEN the user attempts to mark a notification as read
- WHEN the Supabase update fails (network error, permission denied)
- THEN neither query key is invalidated and the error is logged

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

## MODIFIED Requirements

### Requirement: markAllAsRead Cache Invalidation

The `markAllAsRead` mutation SHALL invalidate both `['notifications', userId]` and `['unread-notifications', userId]` query keys after successful completion. The mutation SHALL include the `.eq('read', false)` filter to avoid unnecessary writes.

#### Scenario: markAllAsRead clears badge and list

- GIVEN a user has 10 unread notifications
- WHEN `markAllAsRead()` completes successfully
- THEN both query keys are invalidated — list shows all read, badge shows "0"
(Previously: markAllAsRead invalidated both keys correctly — no change needed, confirmed)

#### Scenario: markAllAsRead skips already-read notifications

- GIVEN some notifications are already marked as read
- WHEN `markAllAsRead()` executes
- THEN only unread notifications are updated (`.eq('read', false)`) — no redundant writes
(Previously: Mutation already included `.eq('read', false)` filter — behavior confirmed)
