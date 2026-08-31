# Design: Notification MVP Plus

## Technical Approach

Single-PR frontend slice hardening the 5-layer notification architecture (DB → realtime → `NotificationWatcher` → toast/dialog queue) with no DB migration. Extract a single `invalidateNotificationKeys` helper; add `dismissNotification`/`dismissAll` with React Query optimistic badge updates; rewrite `NotificationWatcher` to classify by `type` + `action_path` (no title strings); fix v2 toast lifecycle and mapping; await `NotificationLinking.navigate`; ship a clipped count badge and a long-press dismiss on `NotificationItem`. Source-grep + chainable-mock unit tests in the existing `bun test` style.

## Architecture Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Badge update | Optimistic with rollback (CONF-205) | User product decision; mirrors `useProductManagement` pattern. |
| 2 | Dismiss affordance | Long-press → `ConfirmDialog` | Cheapest on FlashList; reuses existing dialog. |
| 3 | Skip / Skip all | Dynamic two-action `ConfirmDialog` | `queue>1`: cancel=Skip (slice(1)), confirm=Skip all. `isLast`: cancel=Cancel, confirm=action. |
| 4 | i18n shape | Flatten `en/notifications.json`; add matching es/en keys | es file is flat; loader uses `notifications:key`; fix at source. |
| 5 | Toast lifecycle | `Toast.show({ visibilityTime, ... })`; remove `Toast.hide()` | v2 `show()` returns void; `visibilityTime` covers auto-hide. |
| 6 | Toast mapping | `error/warning/success/info` passthrough | Adds `warning` to `ToastConfig`; preserves CONF-304. |
| 7 | Initial-load race | Delete `useRef` + initial-load `useEffect` | Badge + realtime carry the signal; closes CONF-004 drift. |
| 8 | Invalidation helper | Export from `useNotificationMutations`; import in watcher | Hook owns both keys; one-way dep. |
| 9 | `NotificationService.dispatch` | Keep + `console.info` log | Out of scope; log surfaces push-ready wiring. |
| 10 | Linking fallback | `try { await router.push(...) } catch { router.push('/profile/notifications') }` | Covers sync + async (CONF-011-B). |

## Data Flow

```
NotificationWatcher (sole channel)
  .channel(`notifications_realtime_watcher_${uid}`)
       │ INSERT                       │ UPDATE
       ▼                              ▼
classify(type, action_path)   invalidateNotificationKeys()
   needsDialog?  → enqueue       (list + badge cache)
       │
   ┌───┴────────────────┐
   ▼                    ▼
Toast.show            ConfirmDialog(queue[0])
(visibilityTime)         Skip      → slice(1)
                         Skip all  → setQueue([])
                         Confirm   → markAsRead → nav

User actions (app/profile/notifications.tsx)
  long-press item → ConfirmDialog → dismissNotification
  header Clear all → ConfirmDialog → dismissAll
  Both: optimistic badge update + invalidate on success + revert on error
```

## File Changes

| File | Action | Why |
|------|--------|-----|
| `core/i18n/locales/en/notifications.json` | Modify | Flatten; add 5 keys. |
| `core/i18n/locales/es/notifications.json` | Modify | Add matching 5 keys. |
| `core/hooks/useNotificationMutations.ts` | Modify | Export helper; add `dismissNotification`, `dismissAll`, error toasts, optimistic badge. |
| `components/features/notifications/NotificationWatcher.tsx` | Modify | Drop title classification; remove initial-load effect; fix toast lifecycle/mapping; skip/skip-all; localize `moreCount`; error toast; `console.info` in `dispatch`. |
| `components/features/notifications/NotificationItem.tsx` | Modify | `onLongPress`; `accessibilityLabel`. |
| `components/config/ToastConfig.tsx` | Modify | Add `warning` entry (orange `#f59e0b`). |
| `core/services/notification.ts` | Modify | Async `navigate` + `try/catch` fallback; `console.info` in `dispatch`. |
| `app/profile/notifications.tsx` | Modify | Header Clear-all; long-press confirm → `dismissNotification`. |
| `app/(tabs)/index.tsx` | Modify | Count badge (clip `9+`); bell `accessibilityLabel`. |
| `components/features/notifications/__tests__/NotificationWatcher.test.ts` | Create | Source-grep + classify() tests. |
| `core/hooks/__tests__/useNotificationMutations.test.ts` | Create | Mutation contract tests (chainable Supabase mock). |

## Interfaces / Contracts

```ts
// useNotificationMutations.ts
export function invalidateNotificationKeys(
  qc: QueryClient, userId: string | undefined,
): void;

interface UseNotificationMutations {
  markAsRead:        (id: string) => Promise<void>;
  markAllAsRead:     () => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;   // CONF-201
  dismissAll:        () => Promise<void>;                // CONF-202
  isDismissing: boolean;
  isClearingAll: boolean;
}

// NotificationWatcher.tsx (internal)
type NotificationKind = 'dialog' | 'toast';
function classify(n: Notification): NotificationKind {
  if (n.type === 'error' || n.type === 'warning') return 'dialog';
  const p = n.action_path ?? '';
  if (p.startsWith('/orders') || p.startsWith('/wallet') || p.startsWith('/verify')) return 'dialog';
  return 'toast';
}

// NotificationLinking
navigate(actionPath: string | null | undefined): Promise<void>;
```

## Testing Strategy

| Layer | Target | Approach |
|-------|--------|----------|
| Unit | `invalidateNotificationKeys` hits both keys | Mock `QueryClient`, assert `invalidateQueries` calls. |
| Unit | `dismissNotification` payload + RLS scope | Chainable Supabase mock; assert `.update({ deleted_at })`, `.eq('id',…)`, `.eq('user_id',…)`. |
| Unit | `dismissAll` has no `id` filter | Same mock; assert no `.eq('id', …)`. |
| Unit | Optimistic badge decrement + rollback | Capture `onMutate`/`onError`; assert `setQueryData` then restore. |
| Unit | `classify()` table | Pure function: `error/warning` & `/orders|/wallet|/verify` → `dialog`; else toast. |
| Grep | No `title.includes(` / `isInitialLoadDone` / `fetchUnread` in watcher | `readFileSync` + `.not.toContain`. |
| Grep | `en/notifications.json` flat (no `notifications` key) | Same. |
| Grep | `NotificationLinking.navigate` awaits + try/catch | Same. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

All-at-once in one PR. No DB migration, no remote change, no flag. RLS preserved; `bun test` + `bunx tsc --noEmit` green. Rollback = revert PR.

## Open Questions

None blocking. Soft call: add `dialog.skip` (es/en).
