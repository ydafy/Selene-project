# Design: Notifications Module Fix & Upgrade

## Technical Approach

Split the monolithic `useNotifications` hook into query-only (`useNotificationsList`) and mutation-only (`useNotificationMutations`) hooks. Centralize realtime in `NotificationWatcher` as the single subscription owner. Introduce a `NotificationService` pub/sub module as the push-ready abstraction layer between realtime events and UI consumers. Add cursor-based pagination via `useInfiniteQuery` and a `NotificationLinking` service for deep-link routing. Fix race conditions, type safety, and cache invalidation bugs.

## Architecture Decisions

### Decision: Hook Split Strategy

**Choice**: Two separate hooks — `useNotificationsList` (query + pagination) and `useNotificationMutations` (markAsRead/markAllAsRead)
**Alternatives considered**: Single hook with selectable options object; keep monolithic with pagination bolted on
**Rationale**: The root cause of the duplicate-channel crash is `useNotifications` being called from two consumers (NotificationWatcher + NotificationScreen). Splitting forces consumers to only import what they need — NotificationWatcher skips the query entirely, eliminating redundant fetches and preventing channel duplication.

### Decision: NotificationService as Pub/Sub Module

**Choice**: Plain module with `dispatch()`/`subscribe()`/`unsubscribe()` — no React context, no Zustand store
**Alternatives considered**: Zustand store slice; React Context provider; EventEmitter
**Rationale**: NotificationService is a pure routing layer, not state. Consumers already use TanStack Query for state. A pub/sub module is push-ready (Expo Push tokens route through `dispatch()` identically to realtime events), zero-boilerplate, and requires no provider wrapping. Follows existing `OrderService` class pattern in `core/services/`.

### Decision: Cursor = (created_at, id) Composite

**Choice**: Cursor derived from `created_at + id` using Supabase `.lt('created_at', cursor).or('created_at.eq.{cursor},id.lt.{cursorId}')` filter
**Alternatives considered**: Offset-based pagination; single-column cursor on `created_at` only
**Rationale**: `created_at` alone can have collisions (multiple notifications in the same millisecond). The composite `(created_at, id)` cursor guarantees stable ordering. Supabase doesn't natively support cursor pagination, so the `.lt/.or` pattern is the only correct approach.

### Decision: Realtime Channel Singleton

**Choice**: Single channel named `notifications_realtime_watcher_{userId}` created only in `NotificationWatcher`, with async `removeChannel` in cleanup
**Alternatives considered**: Channel per hook (current broken approach); global channel outside React tree
**Rationale**: The crash is caused by two hooks creating the same channel topic then both calling `.on('postgres_changes')`. Making `NotificationWatcher` the sole owner and removing the channel creation from `useNotifications` eliminates the root cause. Async cleanup prevents the remount crash.

### Decision: NotificationLinking as Validated Router

**Choice**: Static route map validated with `router.push()`, fallback to `/profile/notifications`, handling `/profile` → `/profile/listings` redirect
**Alternatives considered**: `Linking.openURL()` deep links; no validation (just `router.push(action_path)`)
**Rationale**: `router.push()` is the Expo Router way for internal navigation. Invalid `action_path` values would crash or show blank screens — validation with fallback prevents this. The `/profile` → `/profile/listings` redirect preserves existing behavior from the current `NotificationWatcher`.

## Data Flow

```
Supabase Realtime ──INSERT/UPDATE──→ NotificationWatcher
                                            │
                                     NotificationService.dispatch(notification)
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼              ▼
                        Toast/Dialog    Badge Counter   Query Invalidation
                     (via Notification   (useUnread      (TanStack Query
                      Watcher queue)    Notifications)   key invalidation)

User Action ──tap notification──→ NotificationLinking.navigate(action_path)
                                        │
                                   router.push(validated_path)
                                        │
                               fallback → /profile/notifications

Admin Web ──resolve dispute──→ resolve-dispute Edge Function
                                        │
                                  supabaseAdmin.rpc('fn_resolve_dispute_to_buyer/seller')
                                        │
                                  DB function inserts notifications atomically ✅
```

### Query Key Strategy

```
['notifications', userId]          → useInfiniteQuery (paginated list)
['unread-notifications', userId]   → useQuery (badge count)

Invalidation triggers:
├── NotificationWatcher INSERT event  → invalidate BOTH keys
├── NotificationWatcher UPDATE event → invalidate BOTH keys (read state changed)
├── markAsRead mutation success      → invalidate BOTH keys
└── markAllAsRead mutation success   → invalidate BOTH keys
```

### Pagination Data Flow

```
Screen mounts ──→ useInfiniteQuery({ queryKey: ['notifications', userId] })
                         │
                    fetch page 1 (20 items, ORDER BY created_at DESC, id DESC)
                         │
                    user scrolls to bottom
                         │
                    fetchNextPage() → cursor = last item's (created_at, id)
                         │
                    .lt('created_at', cursorDate)
                    .or('created_at.eq.{cursorDate},id.lt.{cursorId}')
                    .limit(20)
                         │
                    pull-to-refresh → invalidateQueries(['notifications', userId])
                                      → resets to page 1
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/frontend/core/hooks/useNotifications.ts` | **Delete** | Replaced by two new hooks |
| `apps/frontend/core/hooks/useNotificationsList.ts` | **Create** | `useInfiniteQuery`-based paginated list hook — query-only, no realtime |
| `apps/frontend/core/hooks/useNotificationMutations.ts` | **Create** | `markAsRead(id)` and `markAllAsRead()` mutations with dual key invalidation |
| `apps/frontend/core/services/notification.ts` | **Create** | `NotificationService` pub/sub module (`dispatch`, `subscribe`, `unsubscribe`) + `NotificationLinking` navigation module |
| `apps/frontend/components/features/notifications/NotificationWatcher.tsx` | **Modify** | Remove `useNotifications` import, consume `NotificationService` + `useNotificationMutations`, single realtime channel, fix race condition, remove `any` |
| `apps/frontend/app/profile/notifications.tsx` | **Modify** | Replace `useNotifications` with `useNotificationsList` + `useNotificationMutations`, add `FlashList` infinite scroll, fix skeleton anti-pattern, typed press handler |
| `apps/frontend/components/features/notifications/NotificationItem.tsx` | **Modify** | Fix `preseableShadow` → `pressableShadow` typo |
| `supabase/queries/disputes/fn_resolve_dispute_to_buyer.sql` | **Verify** | Already inserts notifications atomically — no changes needed |
| `supabase/queries/disputes/fn_resolve_dispute_to_seller.sql` | **Verify** | Already inserts notifications atomically — no changes needed |

## Interfaces / Contracts

### useNotificationsList

```typescript
interface NotificationsListPage {
  items: Notification[];
  cursor: { created_at: string; id: string } | null;
}

function useNotificationsList(userId: string | undefined): {
  data: Notification[];              // Flat list from all pages
  isLoading: boolean;                // First load only
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}
```

### useNotificationMutations

```typescript
function useNotificationMutations(userId: string | undefined): {
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  isMarkingRead: boolean;
  isMarkingAllRead: boolean;
}
```

### NotificationService

```typescript
type NotificationListener = (notification: Notification) => void;

const NotificationService = {
  dispatch(notification: Notification): void;
  subscribe(listener: NotificationListener): string;   // returns listenerId
  unsubscribe(listenerId: string): void;
};
```

### NotificationLinking

```typescript
const ROUTE_MAP = [
  // Redirects
  { pattern: '/profile', redirectTo: '/profile/listings' },
  // Static routes
  { pattern: '/profile/listings', params: [] },
  { pattern: '/profile/orders', params: [] },
  { pattern: '/profile/wallet', params: [] },
  { pattern: '/profile/favorites', params: [] },
  { pattern: '/profile/notifications', params: [] },
  { pattern: '/profile/support', params: [] },
  { pattern: '/help/verification', params: [] },
  // Dynamic routes
  { pattern: '/product/[id]', params: ['id'] },
  { pattern: '/profile/[id]', params: ['id'] },
  { pattern: '/profile/orders/[id]', params: ['id'] },
  { pattern: '/verify/[id]', params: ['id'] },
];

const NotificationLinking = {
  navigate(actionPath: string | null | undefined): void;
  // Validates against ROUTE_MAP, falls back to /profile/notifications
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `useNotificationsList` pagination cursors | Mock Supabase, verify cursor values on `fetchNextPage` |
| Unit | `useNotificationMutations` dual invalidation | Mock `queryClient.invalidateQueries`, verify both keys called |
| Unit | `NotificationService.dispatch` routes to subscribers | Subscribe 2 listeners, dispatch, verify both receive |
| Unit | `NotificationService.unsubscribe` prevents delivery | Subscribe then unsubscribe, dispatch, verify not called |
| Unit | `NotificationLinking.navigate` valid paths | Mock `router.push`, verify correct path navigation |
| Unit | `NotificationLinking.navigate` invalid paths | Mock `router.push`, verify fallback to `/profile/notifications` |
| Unit | `NotificationLinking.navigate` `/profile` redirect | Verify `/profile` maps to `/profile/listings` |
| Integration | No duplicate channels after mount/remount | Mount `NotificationWatcher` twice, verify single channel exists |
| Integration | `markAsRead` updates both list + badge | Fire mutation, verify both query keys invalidated |
| E2E | Notification tap → deep link navigation | Tap notification item, verify screen transition |
| Manual | `resolve-dispute` inserts notifications | Resolve dispute in admin-web, verify buyer/seller receive notification |

## Migration / Rollout

No migration required. The changes are purely frontend refactoring. Dispute notification inserts already exist in DB functions (verified). The `notifications` table schema is unchanged. Strategy:
1. Create new hooks and services (additive, no breakage)
2. Update `NotificationWatcher` to consume new services
3. Update `notifications.tsx` screen to use new hooks
4. Delete `useNotifications.ts`
5. Verify dispute notification inserts exist in DB functions (they do — no code change needed)

Rollback: Revert to commit before this change. The realtime fix removes a channel (not adding schema), so rollback is safe.

## Open Questions

- [x] Where to insert dispute notifications? **Resolved**: Already in DB functions `fn_resolve_dispute_to_buyer/seller` (atomic). No changes needed.
- [x] Valid Expo Router routes for NotificationLinking? **Resolved**: 12 routes audited above (4 dynamic, 7 static, 1 redirect).