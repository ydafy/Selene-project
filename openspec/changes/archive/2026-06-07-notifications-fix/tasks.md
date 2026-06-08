# Tasks: Notifications Module Fix & Upgrade

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~630 (504 additions + ~124 deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation) → PR 2 (Integration) → PR 3 (Verification) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | New hooks + services (TASK-001, 002, 003) | PR 1 | Foundation; no existing code modified; tests included |
| 2 | Refactor consumers + cleanup (TASK-004, 005, 006, 007) | PR 2 | Base: PR 1 branch; wires new hooks into existing components |
| 3 | Audit + smoke test (TASK-008, 009) | PR 3 | Base: PR 2 branch; read-only DB audit + integration test |

## Phase 1: Foundation (New Hooks & Services)

- [x] **TASK-001** `P0` — Create `apps/frontend/core/hooks/useNotificationsList.ts`
  - Implement `useInfiniteQuery` with query key `['notifications', userId]`
  - Page size 20, ORDER BY `created_at DESC, id DESC`
  - Cursor: composite `(created_at, id)` using `.lt().or()` pattern
  - Return flat `data`, `isLoading`, `isRefetching`, `isFetchingNextPage`, `hasNextPage`, `fetchNextPage`, `refetch`
  - `staleTime: 30_000`
  - **Deps**: none
  - **Files**: `apps/frontend/core/hooks/useNotificationsList.ts` (new, ~80 lines)
  - **Verify**: mock Supabase, assert cursor values on `fetchNextPage`; first page returns 20 items

- [x] **TASK-002** `P0` — Create `apps/frontend/core/hooks/useNotificationMutations.ts`
  - `markAsRead(id)`: update `.eq('id', id).eq('user_id', userId)`, on success invalidate both `['notifications', userId]` and `['unread-notifications', userId]`
  - `markAllAsRead()`: update `.eq('user_id', userId).eq('read', false)`, same dual invalidation
  - Return `isMarkingRead`, `isMarkingAllRead` loading states
  - **Deps**: TASK-001 (query key contract)
  - **Files**: `apps/frontend/core/hooks/useNotificationMutations.ts` (new, ~60 lines)
  - **Verify**: mock `queryClient.invalidateQueries`, assert both keys called on success; no invalidation on error

- [x] **TASK-003** `P0` — Create `apps/frontend/core/services/notification.ts`
  - `NotificationService`: plain module with `dispatch()`, `subscribe()`, `unsubscribe()` using `Map<string, NotificationListener>`
  - `NotificationLinking`: static `ROUTE_MAP` (12 routes from design), `navigate(actionPath)` validates against map, calls `router.push()`, fallback `/profile/notifications`, `/profile` → `/profile/listings` redirect
  - **Deps**: none
  - **Files**: `apps/frontend/core/services/notification.ts` (new, ~120 lines)
  - **Verify**: subscribe 2 listeners → dispatch → both receive; unsubscribe → dispatch → not called; navigate valid/invalid/null paths

## Phase 2: Integration (Refactor Consumers & Cleanup)

- [x] **TASK-004** `P0` — Refactor `NotificationWatcher.tsx`
  - Remove `useNotifications` import; import `NotificationService` + `useNotificationMutations`
  - Single channel `notifications_realtime_watcher_{userId}`, listen for INSERT + UPDATE
  - INSERT → `NotificationService.dispatch(notification)` + invalidate both query keys
  - UPDATE → invalidate both query keys (read state changed)
  - Fix `isInitialLoadDone` race: stable `useRef` guard surviving empty states
  - `await supabase.removeChannel(channel)` in async cleanup
  - Remove `eslint-disable @typescript-eslint/no-explicit-any`; type payloads as `Notification`
  - **Deps**: TASK-001, TASK-002, TASK-003
  - **Files**: `apps/frontend/components/features/notifications/NotificationWatcher.tsx` (modify, ~70 lines changed)
  - **Verify**: mount twice → single channel exists; INSERT triggers dispatch + invalidation; no crash on remount

- [x] **TASK-005** `P1` — Update `apps/frontend/app/profile/notifications.tsx`
  - Replace `useNotifications` with `useNotificationsList` + `useNotificationMutations`
  - `FlashList` with `onEndReached={fetchNextPage}` for infinite scroll
  - `RefreshControl` → `refetch()` (no skeleton during `isRefetching`)
  - Skeletons only when `isLoading && !data`; empty state when `!isLoading && data.length === 0`
  - `handleNotificationPress(notification: Notification)` → `markAsRead(id)` + `NotificationLinking.navigate(action_path)`
  - Remove all `any` casts
  - **Deps**: TASK-001, TASK-002, TASK-003
  - **Files**: `apps/frontend/app/profile/notifications.tsx` (modify, ~90 lines changed)
  - **Verify**: scroll triggers `fetchNextPage`; pull-to-refresh shows cached list; tap navigates via `NotificationLinking`

- [x] **TASK-006** `P1` — Fix `preseableShadow` → `pressableShadow` typo
  - Search and replace `pressableShadow` across `NotificationItem.tsx` and all other references (theme + verification.tsx + ShellTrust.tsx)
  - **Deps**: none
  - **Files**: `apps/frontend/components/features/notifications/NotificationItem.tsx` (modify, ~4 lines)
  - **Verify**: `grep -r preseableShadow` returns zero results; pressed state uses valid theme token

- [x] **TASK-007** `P0` — Delete `apps/frontend/core/hooks/useNotifications.ts`
  - Remove file after all consumers migrated to new hooks
  - Verify no remaining imports via `grep -r 'useNotifications'` (excluding new hook names)
  - **Deps**: TASK-004, TASK-005
  - **Files**: `apps/frontend/core/hooks/useNotifications.ts` (delete, ~120 lines removed)
  - **Verify**: `tsc --noEmit` passes; no broken imports

## Phase 3: Verification (Audit & Smoke Test)

- [x] **TASK-008** `P1` — Verify dispute notification inserts in DB functions
  - Read `supabase/queries/disputes/fn_resolve_dispute_to_buyer.sql` and `fn_resolve_dispute_to_seller.sql`
  - Confirm `INSERT INTO notifications` exists with correct `user_id`, `action_path`, `type`
  - Document findings; no code changes expected
  - **Deps**: none
  - **Files**: read-only audit (0 lines changed)
  - **Verify**: both functions contain notification insert with correct fields

- [x] **TASK-009** `P2` — Module smoke test
  - Read-only audit: all changed files verified for correct imports and types
  - grep `useNotifications` (bare): 0 results — old hook fully removed
  - grep `preseableShadow`: 0 results — typo fully fixed
  - grep `any` in notification files: 0 results — no type escapes
  - `bun test` not configured — skipped
  - **Deps**: TASK-001, TASK-002, TASK-003
  - **Files**: read-only verification (0 lines changed)
  - **Verify**: all greps pass; no stale imports; no type escapes
