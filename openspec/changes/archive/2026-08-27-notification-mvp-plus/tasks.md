# Tasks: Notification MVP Plus

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–800 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | single PR (size:exception) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

## Phase 1: Foundation — i18n + Shared Helper

- [x] 1.1 Flatten `core/i18n/locales/en/notifications.json` (remove nested `notifications` key); add `dismissLabel`, `clearAllLabel`, `clearAllConfirm`, `moreCount`, `openLabel` keys. Add matching es keys in `core/i18n/locales/es/notifications.json`. (~30 lines)
- [x] 1.2 Extract `invalidateNotificationKeys(qc, userId)` from `core/hooks/useNotificationMutations.ts`; refactor `markAsRead` and `markAllAsRead` to call it. (~25 lines)

## Phase 2: Mutations — Dismiss + Optimistic Badge

- [x] 2.1 Add `dismissNotification(id)` mutation: `.update({ deleted_at })`, `.eq('id', id)`, `.eq('user_id', userId)`, invalidate via helper. (~30 lines)
- [x] 2.2 Add `dismissAll()` mutation: `.update({ deleted_at })`, `.eq('user_id', userId)` (no id filter), invalidate via helper. (~25 lines)
- [x] 2.3 Add optimistic badge update: `onMutate` snapshots + `setQueryData` decrement on both `['unread-notifications', userId]`; `onError`/`onSettled` rollback. (~40 lines)
- [x] 2.4 Add `Toast.show({ type: 'error', ... })` in `onError` for all four mutations (CONF-204). (~20 lines)

## Phase 3: Watcher + Toast Fixes

- [x] 3.1 Rewrite `classify()` in `NotificationWatcher.tsx`: switch on `n.type` (`error`/`warning` → dialog) then `action_path` prefix (`/orders`, `/wallet`, `/verify` → dialog); else toast. Remove all `title.includes()` logic. (~30 lines)
- [x] 3.2 Delete `isInitialLoadDone` ref and initial-fetch `useEffect` from watcher. (~−15 lines)
- [x] 3.3 Fix toast lifecycle: use `Toast.show({ visibilityTime: 4000, ... })`; remove `Toast.hide()` calls. (~10 lines)
- [x] 3.4 Add `warning` toast type (orange `#f59e0b`) in `components/config/ToastConfig.tsx`. (~10 lines)
- [x] 3.5 Implement skip/skip-all: `queue > 1` → cancel=Skip (`setQueue(q => q.slice(1))`), confirm=Skip all (`setQueue([])`); `isLast` → cancel=Cancel, confirm=action. (~25 lines)
- [x] 3.6 Replace hardcoded Spanish `moreCount` with `t('notifications:moreCount', { count })`; add `Toast.show({ type: 'error' })` on subscription catch. (~15 lines)

## Phase 4: UI Integration

- [x] 4.1 `NotificationItem.tsx`: add `onLongPress` → `ConfirmDialog` → `dismissNotification(id)`; add `accessibilityLabel={t('notifications:dismissLabel')}`. (~25 lines)
- [x] 4.2 `app/profile/notifications.tsx`: header "Clear all" button → `ConfirmDialog` → `dismissAll()`. (~20 lines)
- [x] 4.3 `app/(tabs)/index.tsx`: bell badge shows `count >= 10 ? '9+' : String(count)`; add `accessibilityLabel={t('notifications:openLabel')}`. (~15 lines)

## Phase 5: Linking

- [x] 5.1 `core/services/notification.ts`: make `navigate()` async; wrap `await router.push(path)` in `try/catch`; on error → `router.push('/profile/notifications')`. Add `console.info` in `dispatch`. (~20 lines)

## Phase 6: Tests

- [x] 6.1 Create `components/features/notifications/__tests__/NotificationWatcher.test.ts`: `classify()` table (error/warning/path → dialog; else toast); source-grep asserts no `title.includes`, no `isInitialLoadDone`, no `fetchUnread`. (~80 lines)
- [x] 6.2 Create `core/hooks/__tests__/useNotificationMutations.test.ts`: chainable Supabase mock; assert `dismissNotification` payload + RLS scope; `dismissAll` no id filter; `invalidateNotificationKeys` hits both keys; optimistic badge decrement + rollback. (~100 lines)
