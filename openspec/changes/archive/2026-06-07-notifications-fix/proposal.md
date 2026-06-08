# Proposal: Notifications Module Fix & Upgrade

## Intent

Fix the production crash (`cannot add postgres_changes callbacks`) triggered when navigating to NotificationScreen, caused by duplicate realtime subscriptions from `useNotifications`. Then upgrade the entire notifications module to production quality, making it push-notification-ready without future UI/business-logic changes.

## Scope

### In Scope
- Split `useNotifications` into `useNotificationsList` (query) and `useNotificationMutations` (mutations)
- Centralize single realtime subscription in `NotificationWatcher`; remove duplicate channel from hook
- Fix `markAsRead` to invalidate both query keys (list + unread count)
- Fix `isInitialLoadDone` race condition and unawaited `removeChannel` cleanup
- Replace `any` types with `Notification` type in screen and watcher
- Fix UI skeleton anti-pattern during pull-to-refresh; fix `preseableShadow` typo
- Design notification service abstraction layer for push-ready routing
- Implement deep-linking from `action_path` via centralized linking service
- Add cursor-based infinite scroll pagination with pull-to-refresh
- Verify admin-web dispute notification insertion path (already exists for products, verify disputes)

### Out of Scope
- Expo Push Notifications SDK integration (architecture only must be ready)
- Backend changes to `notifications` table schema
- Notification preferences/settings screen
- Email/SMS notification channels

## Capabilities

### New Capabilities
- `notification-service`: Abstract service layer routing in-app vs future push notifications
- `notification-linking`: Deep-link handler mapping `action_path` to Expo Router paths
- `notification-pagination`: Cursor-based infinite scroll for notification list

### Modified Capabilities
- `notifications-list`: Split monolithic hook, add pagination, fix realtime, fix types
- `notification-watcher`: Single subscription source, fix initial-load race, fix cleanup
- `notification-mutations`: Correct cache invalidation, type safety

## Approach

1. **Bug fix**: Decouple query from realtime. `useNotificationsList` uses `useInfiniteQuery` with `cursor-based` pagination (created_at + id). `NotificationWatcher` owns the one Supabase realtime channel and invalidates query keys on INSERT/UPDATE. `useNotificationMutations` exposes `markAsRead`/`markAllAsRead`.
2. **Push-ready architecture**: Introduce `NotificationService` (frontend core) that consumes incoming notifications from any source (realtime DB listener today, Expo Push later). UI components receive notifications through this service, not directly from DB hooks.
3. **Deep linking**: `action_path` strings (e.g., `/profile/orders/123`) map through a validated router. Tapping a notification (Toast, Dialog, or List item) calls `NotificationLinking.navigate(action_path)`.
4. **Race conditions**: Replace `isInitialLoadDone` ref with a stable `useRef` guard that survives empty states. Await `supabase.removeChannel(channel)` in cleanup effects.
5. **Admin-web**: Reuse existing `supabase.from('notifications').insert(...)` pattern. Verify dispute resolution flows call it with correct `user_id`, `action_path`, and `type`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/frontend/core/hooks/useNotifications.ts` | Removed | Replaced by `useNotificationsList` + `useNotificationMutations` |
| `apps/frontend/components/features/notifications/NotificationWatcher.tsx` | Modified | Single realtime source, race fixes, push-ready service integration |
| `apps/frontend/app/profile/notifications.tsx` | Modified | Infinite scroll, skeleton fix, deep-link press, type safety |
| `apps/frontend/components/features/notifications/NotificationItem.tsx` | Modified | Fix `preseableShadow` typo |
| `apps/frontend/core/services/notification.ts` | New | Service abstraction + linking layer |
| `apps/admin-web/src/hooks/useDisputes.ts` (or similar) | Verify | Ensure dispute verdicts insert notifications |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pagination breaks unread badge logic | Low | Unread count uses separate `useUnreadNotifications` query; invalidate both on mutation |
| Deep-link path invalid or missing params | Med | Validate `action_path` against Expo Router route map; fallback to `/profile/notifications` |
| Realtime channel still duplicated elsewhere | Low | Audit all `.channel('notifications_*)` in codebase; enforce naming convention |
| Admin-web missing dispute notifications | Med | Audit dispute resolution hooks for `insert('notifications')` call |

## Rollback Plan

Revert to commit before this change. The realtime bug fix is additive (removing a channel, not adding schema), so rollback is safe. If pagination causes issues, switch `useInfiniteQuery` back to `useQuery` with `.limit(20)` while keeping the architecture fixes.

## Dependencies

- `@tanstack/react-query` (already installed) for `useInfiniteQuery`
- `expo-router` (already installed) for deep-link routing
- No new external dependencies

## Success Criteria

- [ ] Navigating to NotificationScreen never throws `cannot add postgres_changes callbacks`
- [ ] NotificationWatcher has exactly one realtime subscription
- [ ] `markAsRead` immediately updates both notification list and unread badge
- [ ] List supports infinite scroll (20 items/page) and pull-to-refresh without skeleton flash
- [ ] Tapping any notification navigates to `action_path` correctly; invalid paths fallback safely
- [ ] Admin-web inserts notifications for dispute verdicts with correct `action_path`
- [ ] All notification-related code uses `Notification` type; zero `any` casts
- [ ] `preseableShadow` typo fixed across project
