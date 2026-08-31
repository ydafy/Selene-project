# Exploration: notification-mvp-plus

## Executive Summary

The notification module has solid architectural bones (cursor pagination, single realtime channel, validated deep-link router) but ships with **one critical production bug** (English i18n file is double-nested, breaking the English UI), several **high-impact UX defects** (queue cancel silently drops unread notifications, badge shows a dot instead of count, no dismiss action despite schema support), and **spec drift** from the 2026-06-07 fix (the `isInitialLoadDone` ref that the spec required to be replaced is still present). The orchestrator's 11 findings are correct; this exploration adds 7 more and prioritizes everything for an MVP++ slice that stays within the 800-line review budget.

## Current State

**Architecture (5 layers)**
```
DB (12 SQL fn_* insert notifications)
  → Supabase postgres_changes realtime
    → NotificationWatcher (sole channel owner)
      → NotificationService.dispatch() → no subscribers (dead path)
        → processIncoming() → Toast.show() OR ConfirmDialog queue
```

**Module surface**
- `core/services/notification.ts` — `NotificationService` (dispatch/subscribe/unsubscribe) + `NotificationLinking` (validated router)
- `core/hooks/useNotificationsList.ts` — `useInfiniteQuery` with `(created_at, id)` cursor, 20 items/page
- `core/hooks/useNotificationMutations.ts` — `markAsRead` + `markAllAsRead` mutations
- `core/hooks/useUnreadNotifications.ts` — `useQuery` with `count: 'exact', head: true`
- `components/features/notifications/NotificationWatcher.tsx` — single realtime channel + dialog queue
- `components/features/notifications/NotificationItem.tsx` — list row with type-based icon
- `app/profile/notifications.tsx` — `FlashList` + pull-to-refresh
- `app/(tabs)/index.tsx` — header bell + red dot badge (count not shown)

**Notification creation (backend)**
- 12 SQL functions insert into `notifications` across orders, payments, products, disputes, shipments, returns
- All insert with `type` in `{'success','error','warning','info'}` and `action_path` in known route shapes
- `type` column is `string | null` in DB (not a Postgres enum) → no schema-level constraint

## Affected Areas

| File | Why affected |
|------|--------------|
| `apps/frontend/core/i18n/locales/en/notifications.json` | **CRITICAL bug** — has extra `notifications` wrapper, breaks English UI |
| `apps/frontend/core/i18n/locales/es/notifications.json` | Sibling to above; needs matching keys (e.g. `moreCount`) |
| `apps/frontend/components/features/notifications/NotificationWatcher.tsx` | Title-string classification, hardcoded Spanish, queue cancel semantics, dead `dispatch()` call, no error handling, `isInitialLoadDone` ref still present |
| `apps/frontend/core/hooks/useNotificationMutations.ts` | Duplicated `invalidateNotificationKeys`, no error toast, no optimistic update |
| `apps/frontend/core/hooks/useUnreadNotifications.ts` | Trivial — likely keep as-is |
| `apps/frontend/core/services/notification.ts` | `NotificationService` has zero subscribers → either wire it or document as push-ready scaffolding |
| `apps/frontend/app/profile/notifications.tsx` | Add "delete" action per item, hook into `useNotificationMutations` |
| `apps/frontend/app/(tabs)/index.tsx` | Replace dot with count badge (clip to 9+ for >9) |
| `apps/frontend/components/features/notifications/NotificationItem.tsx` | Add dismiss affordance, optional long-press menu |
| `openspec/changes/notification-mvp-plus/specs/notifications/spec.md` | New delta spec for delete-dismiss + count badge + i18n fix |
| `openspec/changes/notification-mvp-plus/specs/notifications-watcher/spec.md` | MODIFIED: classify by `type`/path (not title), fix cancel semantics, handle errors, add `notifications.moreCount` key, fix isInitialLoadDone |

## Findings (prioritized for MVP++)

### Critical (must fix — blocks production quality)

1. **[CRITICAL][Bug] English i18n file is double-nested** — `core/i18n/locales/en/notifications.json` has `{"notifications": {...}}` while the Spanish file is flat. With `t('notifications:title')` calls, English mode returns the wrapper object → the header shows `[object Object]` or undefined. This has been broken since the file was created. **Fix**: move keys up one level to match Spanish.

2. **[CRITICAL][UX] Queue cancel silently drops unread notifications** — `NotificationWatcher.tsx:162` `onCancel={() => setQueue([])}` clears ALL queued notifications when the user taps "Cancel" on a non-last item. The user might be mid-review of a 3-item queue and lose notifications 2 and 3 without a confirmation. **Fix**: `onCancel = prev => prev.slice(1)` (skip current), keep a separate "Skip all" action that requires a confirm step.

3. **[HIGH][Bug] `Toast.hide()` is not a static method on `react-native-toast-message` v2** — `NotificationWatcher.tsx:71` calls `Toast.hide()` as a static. v2 exposes `hide(id)` on the toast ref or you dismiss via `Toast.show({...})` overwriting. The current call is a no-op at best, runtime warning at worst. **Fix**: capture the toast id from `Toast.show(...)` and call `hide(id)` from the imported ref, or just `setTimeout(() => Toast.hide(), ...)` won't work either — must use the imperative API.

4. **[HIGH][UX] Title-string classification is fragile and locale-coupled** — `NotificationWatcher.tsx:42-53` uses `title.includes('verific')` / `title.includes('vendido')` / `title.includes('compra')` / `title.includes('pago')` to decide "needs dialog". These match Spanish DB rows only — if the i18n bug above is fixed and titles ever get translated, classification breaks. Also false-positive prone (`"verificadora"`, `"pago anticipado"`). **Fix**: classify by `notif.type` (`error`/`warning` already covered) and `action_path` patterns (`/orders`, `/wallet`, `/verify`) — drop the title string match entirely.

### High (in scope for MVP++)

5. **[HIGH][UX] No dismiss/delete action despite schema support** — `deleted_at` column exists, every query filters `is('deleted_at', null)`, but the only "delete" path is a back-end `mark_as_read`. Users have no way to clean up their inbox. **Fix**: add `dismissNotification(id)` mutation that sets `deleted_at`, expose via long-press menu or swipe on `NotificationItem`. Add header "Clear all" button on the list screen (with `ConfirmDialog` confirmation).

6. **[HIGH][UX] Badge shows a dot, not a count** — `app/(tabs)/index.tsx:165-179` renders a red 16×16 dot when `unreadCount > 0`. Users can't tell 1 from 99. **Fix**: render the number (`unreadCount` clipped to `9+` when ≥10) inside the dot.

7. **[HIGH][Spec drift] `isInitialLoadDone` ref still present** — `notification-watcher/spec.md` CONF-004 explicitly required replacing the mutable `useRef<boolean>` guard with a "stable mechanism". Current code (lines 27, 82, 95) still uses the ref. The spec was satisfied at the API level (race no longer surfaces) but the code is unchanged. **Fix**: either remove the ref + initial-load effect entirely (the realtime channel alone is enough) or update the spec to reflect that the current `useRef` is the accepted solution. Recommend: remove the initial-load fetch — realtime is the only signal that matters, and the existing unread count is already shown by the badge.

8. **[MEDIUM][Bug] Initial load fetches ALL unread, uses only `data[0]`** — `NotificationWatcher.tsx:84-90` returns every unread row, then only processes the first. If the user has 50 unread (e.g. returning from a week offline), this downloads 50 rows for nothing. **Fix**: `.limit(1)` — or remove the effect entirely (see #7).

9. **[MEDIUM][Code quality] `NotificationService` pub/sub is dead code** — `dispatch()` is called (line 117) but `subscribe()` has zero callers. The dispatch fires into an empty Map. The spec (CONF-010) requires "Dispatch routes to all subscribers" — technically satisfied (routes to 0), but the value is zero. **Fix**: either (a) document it as push-ready scaffolding with a comment, or (b) wire one real subscriber (e.g. an analytics event), or (c) remove `dispatch()` from the realtime callback since `processIncoming()` handles the UI directly. Recommendation: keep the service as scaffolding but add a `// eslint-disable-next-line no-console` log in `dispatch()` so future devs can see it's wired.

10. **[MEDIUM][UX] No error feedback on `markAsRead` failure** — `useNotificationMutations.ts:28-30` and `:47-49` log to `console.error` and that's it. User taps, nothing happens, no toast, no retry. **Fix**: call `Toast.show({ type: 'error', ... })` in the `onError` handler with a localized message.

11. **[MEDIUM][Bug] Toast type mapping drops error/warning visual** — `NotificationWatcher.tsx:66` maps anything that isn't `'success'` to `'info'`. So a DB row with `type: 'error'` is shown as a blue info toast. **Fix**: map `error` → `'error'`, `warning` → a custom config, `success` → `'success'`, else `'info'`. The `ToastConfig` already supports the `error` style.

### Medium (in scope if budget allows)

12. **[MEDIUM][Code quality] `invalidateNotificationKeys` duplicated** — Same 5-line function exists in `NotificationWatcher.tsx:32-38` and `useNotificationMutations.ts:7-13`. **Fix**: export from a shared helper (e.g. add to `core/hooks/useNotificationMutations.ts` and import from there, or extract to `core/services/notification.ts` as `NotificationCache.invalidate(queryClient, userId)`).

13. **[MEDIUM][Type safety] `Notification.type` is `string | null`** — `database.types.ts:908`. Code uses string literals (`'success' | 'error' | 'warning' | 'info' | 'default'`). Should be a Postgres enum (`notification_type`) or a TS union. **Fix**: out of MVP++ scope (DB migration), but document as a known gap. Workaround: add a TS-narrowing helper `asNotificationType(value: string | null): NotificationType`.

14. **[LOW][Spec drift] `router.push` not awaited in `NotificationLinking.navigate`** — `notification-linking/spec.md` CONF-011-B requires "Navigation SHALL be awaited to allow error handling" and "Navigation error triggers fallback". Current code: `router.push(resolved as ...)` — not awaited, no fallback on error. **Fix**: wrap in try/catch and fall back to `/profile/notifications` on throw.

15. **[LOW][UX] No "filter unread / filter all" toggle on the list** — Users see a flat list. **Out of scope** for MVP++; defer.

16. **[LOW][Code quality] `NotificationItem.getIcon` could be a lookup table** — At 4 cases it's not worth refactoring. **Out of scope**.

### Low (defer entirely)

17. **[LOW][Code quality] Hardcoded Spanish string in `NotificationWatcher.tsx:172`** — `+${queue.length - 1} mensajes más`. Will be fixed by introducing `notifications.moreCount` key (already implied by the i18n fix).

18. **[LOW][Code quality] No `onMutate` optimistic update on `markAsRead`** — Would feel snappier but is cosmetic. The current `invalidate` round-trip is <300ms on a good connection.

19. **[LOW][Accessibility] No `accessibilityLabel` on the bell-icon button** — Screen reader users hear "button" with no context. **Fix**: add `accessibilityLabel={t('notifications:openLabel')}` (new key).

## Spec Drift Summary

| Spec | Requirement | Current code | Status |
|------|-------------|--------------|--------|
| `notifications-list/spec.md` CONF-001 | Split hook into list+mutations | ✓ done | OK |
| `notifications-list/spec.md` CONF-007 | Skeleton only on initial load | ✓ done | OK |
| `notifications-list/spec.md` CONF-008 | `pressableShadow` typo fixed | ✓ done | OK |
| `notifications-list/spec.md` CONF-009 | Cursor pagination with `(created_at, id)` | ✓ done | OK |
| `notification-watcher/spec.md` CONF-002 | Single realtime subscription | ✓ done | OK |
| `notification-watcher/spec.md` CONF-004 | **Replace `isInitialLoadDone` `useRef<boolean>` with stable mechanism** | ref still present | **DRIFT** |
| `notification-watcher/spec.md` CONF-005 | `removeChannel` in cleanup | ✓ done (fire-and-forget) | OK |
| `notification-watcher/spec.md` | Watcher routes via `NotificationService.dispatch` | dispatch called + processIncoming called directly | OK (partial — see Finding 9) |
| `notification-mutations/spec.md` CONF-003 | `markAsRead` invalidates BOTH keys | ✓ done | OK |
| `notification-mutations/spec.md` CONF-006 | Zero `any` types | ✓ done | OK |
| `notification-pagination/spec.md` CONF-009-A/B/C | 20 items/page, pull-to-refresh, 30s staleTime | ✓ done | OK |
| `notification-linking/spec.md` CONF-011-A | Path validation against route map | ✓ done | OK |
| `notification-linking/spec.md` CONF-011-B | **`router.push` awaited + error fallback** | not awaited, no fallback | **DRIFT** |
| `notification-service/spec.md` CONF-010 | Service exposes dispatch/subscribe/unsubscribe | ✓ API done, no subscribers | OK (API-level) |

## Recommended Scope

**In scope (this change)**

- **i18n fix** (en + es): flatten English file, add `moreCount` key for the "+N más" string, add `dismiss`/`clearAll` action labels
- **Remove title-string classification** in `NotificationWatcher`: classify by `type` + `action_path` only
- **Fix queue cancel semantics**: `onCancel` skips current, add explicit "skip all" with confirm
- **Fix `Toast.hide` call** with the correct v2 API
- **Add `dismissNotification(id)` + `dismissAll()` mutations** + UI (long-press on item, header "Clear all" with confirm dialog)
- **Badge shows count** (clip to 9+) in `(tabs)/index.tsx`
- **Remove initial-load effect** + `isInitialLoadDone` ref (realtime + badge is sufficient)
- **Extract `invalidateNotificationKeys`** to a single helper
- **Fix Toast type mapping** to honor `error`/`warning`/`success`/`info`
- **Add `onError` Toast** in `useNotificationMutations`
- **Add `await` + try/catch in `NotificationLinking.navigate`**
- **Add `accessibilityLabel`** to the bell-icon button
- **Update specs** (delta) to cover delete-dismiss, count badge, and to record the spec changes (replacing CONF-004 with "remove initial-load effect")

**Out of scope (defer)**

- Push notifications integration (architecture is already push-ready)
- Notification preferences screen
- Postgres enum for `type` (DB migration)
- Filter unread/all toggle
- Notification grouping (5 new → single row)
- Any of the 12 backend SQL functions (they're working; only the i18n bug, classification logic, and delete mutation touch their output)

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Touching `NotificationWatcher` could regress the realtime flow (already fixed in 2026-06-07) | Med | Keep the existing `useEffect` shape, only change logic inside `processIncoming` + the cancel handler + remove the initial-load effect |
| `NotificationService.dispatch` has no tests — changes could silently break the (push-ready) contract | Low | Either remove dispatch() call or add a console.log so devs see it's wired; document in the spec |
| Backend uses Spanish titles — fixing classification by `type` requires `type` to be set correctly in all 12 SQL fns (audit) | Med | Spot-checked: orders/payments/disputes/products all set `type` explicitly ✓; spot-verdict in `fn_resolve_product_verdict.sql` sets it from a variable — verify the variable is always one of the 4 values |
| `Toast.hide()` fix changes the toast dismissal flow — if any user has a "swipe to dismiss" habit, behavior changes | Low | Document the change in verify-report |
| Removing the initial-load effect means users won't see dialogs for notifications inserted while the app was closed | Med | Acceptable — the list screen + badge is the source of truth. Or: replace initial-load with a query for the most recent 1 unread (`limit(1)`) for the dialog queue, but skip on cold-start and trust the badge |
| English file was double-nested from day 1 — fixing it could surface other components that depended on the broken structure | Low | Grep confirms only `app/profile/notifications.tsx` and the i18n index reference the namespace; no `t('notifications:notifications.title')` calls anywhere |

## Ready for Proposal

**Yes.** The scope is bounded, the orchestrator's findings are validated, and the additional 7 findings (3-11, 14, 19) all fit within the 800-line review budget. Recommend the next phase be `sdd-propose` to draft a focused MVP++ proposal.

## Artifacts Read (for traceability)

- `apps/frontend/core/services/notification.ts` (144 lines)
- `apps/frontend/core/hooks/useNotificationMutations.ts` (58 lines)
- `apps/frontend/core/hooks/useNotificationsList.ts` (74 lines)
- `apps/frontend/core/hooks/useUnreadNotifications.ts` (22 lines)
- `apps/frontend/components/features/notifications/NotificationWatcher.tsx` (178 lines)
- `apps/frontend/components/features/notifications/NotificationItem.tsx` (102 lines)
- `apps/frontend/app/profile/notifications.tsx` (146 lines)
- `apps/frontend/app/(tabs)/index.tsx` (274 lines)
- `apps/frontend/components/ui/ConfirmDialog.tsx` (131 lines)
- `apps/frontend/components/config/ToastConfig.tsx` (85 lines)
- `apps/frontend/core/i18n/locales/{es,en}/notifications.json`
- `apps/frontend/core/i18n/locales/{es,en}/common.json` (dialog keys)
- `apps/frontend/core/i18n/index.ts` (namespace wiring)
- `packages/types/src/index.ts` + `database.types.ts` (lines 895-935, Notification table)
- `openspec/specs/notifications-list/spec.md`
- `openspec/specs/notification-watcher/spec.md`
- `openspec/specs/notification-service/spec.md`
- `openspec/specs/notification-pagination/spec.md`
- `openspec/specs/notification-mutations/spec.md`
- `openspec/specs/notification-linking/spec.md`
- `openspec/changes/archive/2026-06-07-notifications-fix/proposal.md`
- `supabase/queries/{orders,disputes,payments,products,return,shipments}/*` (12 fn_* files inserting notifications)
- `supabase/migrations/20260711042329_stripe_fee_gross_up.sql` (latest insert sites)
