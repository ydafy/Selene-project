```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:bede6e246bd570cdccfd9badf631e8adfdd001af8e0422b07fc12313eadf5ef6
verdict: fail
blockers: 0
critical_findings: 1
requirements: 7/19
scenarios: 21/39
test_command: bun test apps/frontend/components/features/notifications/__tests__/ apps/frontend/core/hooks/__tests__/useNotificationMutations.test.ts apps/frontend/core/utils/notificationBadge.test.ts
test_exit_code: 0
test_output_hash: sha256:0fe1aa8a4bcd8d7d7db47979f981f41a8346f3af0bf9050ac51c6c396cfbbfcc
build_command: cd apps/frontend && bunx tsc --noEmit
build_exit_code: 2
build_output_hash: sha256:5d6466e17b6bed7d124930213c07d39bfbcdecf56977a5fcaea43cdc6dbf27be
```

## Verification Report

**Change**: notification-mvp-plus
**Version**: N/A (pre-archive delta)
**Mode**: Strict TDD (openspec/config.yaml `strict_tdd: true`, runner `bun test` present)
**Cycle**: Remediation re-verify (2nd verification pass)

### Remediation Verification (previous 11 critical findings)

| Previous finding | Remediation claimed | Re-verify evidence | Status |
|------------------|---------------------|--------------------|--------|
| CONF-102-S2 cancelled clear-all UNTESTED | Screen cancel grep contract | `NotificationWatcher.test.ts > cancel clear-all closes dialog without mutation` passes; `onCancel={() => setShowClearAll(false)}` is mutation-free in source | ✅ RESOLVED (partial-strength test; see S-1) |
| CONF-103-S1 badge "3" UNTESTED | `notificationBadge.test.ts` | `formatNotificationBadgeCount(3) === '3'` passes; wired at `app/(tabs)/index.tsx` L187 | ✅ RESOLVED |
| CONF-103-S2 badge "9+" UNTESTED | `notificationBadge.test.ts` | `formatNotificationBadgeCount(10/24/999) === '9+'` passes | ✅ RESOLVED |
| CONF-104-S1 bell a11y UNTESTED | Home grep contract | grep passes (accessibilityLabel + openLabel); bell TouchableOpacity carries `accessibilityLabel={t('notifications:openLabel')}` (index.tsx L159); key exists in en+es | ✅ RESOLVED (partial-strength; see S-1) |
| CONF-104-S2 dismiss a11y UNTESTED | Item grep contract | grep passes; `accessibilityLabel={t('notifications:dismissLabel')}` (NotificationItem.tsx L65); key exists in en+es | ✅ RESOLVED (partial-strength; see S-1) |
| list MOD-S1 split-hook render UNTESTED | (screen contracts added) | Screen source contracts pass for the mutations-hook half (`dismissAll`, ConfirmDialog wiring); `useNotificationsList` consumption source-verified only (notifications.tsx L13/L39) — no test asserts it | ✅ RESOLVED as PARTIAL (see S-2) |
| markAsRead MOD-S3 user scoping UNTESTED | markAsRead tests | `markNotificationAsRead > updates read with id and user_id filters` asserts `.eq('id','notif-1')` + `.eq('user_id','user-1')` — runtime pass | ✅ RESOLVED |
| CONF-302-S1 skip one UNTESTED | `dialogActions.test.ts` | `resolveDialogControls(false)` → skip/skipAll passes; watcher consumes it (L157); `handleSkip` = `slice(1)` source-verified | ✅ RESOLVED |
| CONF-302-S2 skip all UNTESTED | `dialogActions.test.ts` | `resolveDialogControls(false)` confirm=skipAll passes; `handleSkipAll` = `setQueue([])` with no DB mutation source-verified | ✅ RESOLVED |
| CONF-303-S2 toast replacement UNTESTED | Spec wording fix | Spec corrected to v2 semantics (verified); Toast.show lifecycle grep contract passes; per-notification re-invocation source-verified | ✅ RESOLVED as PARTIAL |
| C-11 TDD Cycle Evidence table missing | (not remediated) | Apply-progress (Engram obs #990, current revision) still contains no "TDD Cycle Evidence" table | ❌ OPEN — CRITICAL |
| W-1 CONF-303 spec wording defective (warning) | Spec fix | Spec now mandates `visibilityTime` auto-dismiss and prohibits static `Toast.hide()` — matches implementation | ✅ RESOLVED |
| W-2 unused `_id` lint error (warning) | (fixed in logic file) | `void id;` statements present; eslint exit 0 across all 13 notification changed files | ✅ RESOLVED |

All ten previously UNTESTED scenarios now have passing covering tests at the project's available layers (runtime unit or approved source-grep contract). Zero scenarios remain UNTESTED.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 18 |
| Tasks complete | 18 |
| Tasks incomplete | 0 |

All 18 tasks across 6 phases remain checked in `tasks.md`; apply-progress (Engram obs #990) corroborates 18/18.

### Build & Tests Execution

**Build**: ❌ Failed (exit 2 — zero errors in files touched by this change)
```text
cd apps/frontend && bunx tsc --noEmit
24 type errors (down from 32 at first verify), all in files of other uncommitted in-flight
work (orders/report, checkout, sell schema, prepare/orders test utils). Zero errors match
notification-mvp-plus files (pattern filter over notification/Notification/dialogActions/
ToastConfig/classify returned no matches).
```

**Tests**: ✅ 50 passed / 0 failed / 0 skipped (focused — this change's tests)
```text
bun test apps/frontend/components/features/notifications/__tests__/ apps/frontend/core/hooks/__tests__/useNotificationMutations.test.ts apps/frontend/core/utils/notificationBadge.test.ts
→ 50 pass, 0 fail, 94 expect() calls across 4 files, exit 0.
Files: NotificationWatcher.test.ts (30), useNotificationMutations.test.ts (16),
dialogActions.test.ts (2), notificationBadge.test.ts (2).
Delta vs first verify: +16 tests (dialogActions 2, notificationBadge 2, markAsRead/markAll 4,
NotificationItem/NotificationsScreen/Home source contracts 8). 34 → 50.
(Stderr noise during the run is intentional console.error output from production onError
handlers exercised by tests.)
```

**Broader regression (spot-check)**: full `bun test` = 896 pass / 7 fail / 16 errors, 903 tests across 123 files, exit 1. Both failing tests belong to other concurrent work (`supabase/functions/generate-shipping-label/auth-order.test.ts` — envia label guard assertions; `post-purchase-label-generation-remediation` migration test). The 16 errors originate from `apps/frontend/tests/orders/*` and `tests/prepare/*` (other changes' untracked test files). Zero notification-related failures — the notification error output in the log is expected console.error noise from passing error-branch tests.

**Coverage**: changed-file average 93.42% (measurable files); `useNotificationMutations.logic.ts` at 73.68% lines — see Changed File Coverage.

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| CONF-101 Dismiss Notification Action | User dismisses a single notification | `useNotificationMutations.test.ts > dismissNotification` (payload+scope) + `NotificationItem source contracts` (onLongPress/ConfirmDialog/showConfirm); list filters `deleted_at IS NULL` | ✅ COMPLIANT |
| CONF-101 Dismiss Notification Action | Dismiss failure leaves item in place | `onError restores previous unread count and shows error toast`; item-remains structural (no optimistic list write; invalidation only onSuccess) | ⚠️ PARTIAL |
| CONF-102 Clear All Notifications | User clears the entire inbox | `dismissAllNotifications` runtime (user-scoped, no id filter) + screen contracts (ConfirmDialog/showClearAll/dismissAll) | ✅ COMPLIANT |
| CONF-102 Clear All Notifications | Cancelled clear-all leaves inbox unchanged | `cancel clear-all closes dialog without mutation` grep; mutation-free onCancel source-verified | ⚠️ PARTIAL |
| CONF-103 Unread Count Badge | Few unread notifications ("3") | `notificationBadge.test.ts > returns exact string for counts below 10` (3→"3") + Home usage grep | ✅ COMPLIANT |
| CONF-103 Unread Count Badge | Many unread notifications ("9+") | `notificationBadge.test.ts > clips to 9+ for counts of 10 or more` (10/24/999→"9+") | ✅ COMPLIANT |
| CONF-104 Accessibility Labels | Screen reader focuses bell | Home grep (accessibilityLabel + openLabel) + i18n key runtime tests; association on bell source-verified (index.tsx L159) | ⚠️ PARTIAL |
| CONF-104 Accessibility Labels | Screen reader focuses dismiss action | NotificationItem grep (accessibilityLabel + dismissLabel) + i18n key runtime tests; association source-verified (L65) | ⚠️ PARTIAL |
| notifications-list MOD Screen Integration | Screen renders with split hooks | Screen contracts cover mutations-hook actions; `useNotificationsList` consumption source-verified only | ⚠️ PARTIAL |
| notifications-list MOD Screen Integration | Notification press handles typed data | typecheck proves typed `Notification` param, no `any` (notifications.tsx L48); markAsRead + navigate runtime pieces | ⚠️ PARTIAL |
| notifications-list MOD Screen Integration | Dismiss and clear-all actions are wired | Item contracts (onLongPress/ConfirmDialog) + screen contracts (dismissAll) + mutation runtime tests + `onDismiss={dismissNotification}` source | ✅ COMPLIANT |
| CONF-201 dismissNotification Mutation | User dismisses one notification | `dismissNotification > updates deleted_at with id and user_id filters` + helper invalidation test | ✅ COMPLIANT |
| CONF-201 dismissNotification Mutation | Dismiss is scoped to owner | same test asserts `.eq('user_id', 'user-1')` | ✅ COMPLIANT |
| CONF-202 dismissAll Mutation | User clears the entire inbox | `dismissAllNotifications > updates deleted_at with only user_id filter` | ✅ COMPLIANT |
| CONF-202 dismissAll Mutation | dismissAll does not affect other users | same test asserts user scope, no id filter | ✅ COMPLIANT |
| CONF-203 Shared Cache Invalidation Helper | Helper is reused by all mutations | helper runtime-tested (both keys); all four pure mutationFns runtime-tested; builder onSuccess wiring source-verified (L102-138 uncovered) | ⚠️ PARTIAL |
| CONF-204 Mutation Error Feedback | markAsRead fails | `markNotificationAsRead > throws when supabase returns an error` runtime; `createMarkAsReadMutationOptions.onError` not directly exercised | ⚠️ PARTIAL |
| CONF-204 Mutation Error Feedback | dismissAll fails | `dismissAll onError restores previous unread count and shows error toast` runtime; list-unchanged structural | ⚠️ PARTIAL |
| CONF-205 Optimistic Badge Update | Dismiss unread notification | `onMutate decrements unread count and snapshots previous value` (5→4) | ✅ COMPLIANT |
| CONF-205 Optimistic Badge Update | Dismiss failure reverts badge | `onError restores previous unread count` (→5) | ✅ COMPLIANT |
| markAsRead MOD Dual Cache Invalidation | markAsRead updates list and badge | `markNotificationAsRead` runtime + helper invalidates both keys runtime; builder wiring source | ✅ COMPLIANT |
| markAsRead MOD Dual Cache Invalidation | markAsRead handles network error gracefully | error path source (no invalidation on error + console.error + showError); builder onError uncovered | ⚠️ PARTIAL |
| markAsRead MOD Dual Cache Invalidation | markAsRead is scoped to user's notifications | `markNotificationAsRead > updates read with id and user_id filters` asserts `.eq('user_id', 'user-1')` | ✅ COMPLIANT |
| CONF-301 Typed Classification | High-priority notification triggers dialog | `classify > error type always produces dialog` (+ path cases) | ✅ COMPLIANT |
| CONF-301 Typed Classification | Locale change does not break classification | classify pure on type/path (table tests) + grep: no `title.includes(` | ✅ COMPLIANT |
| CONF-302 Queue Skip Semantics | User skips one dialog | `dialogActions.test.ts > isLast=false offers skipAll + skip`; watcher consumes `resolveDialogControls` (L157), `handleSkip` = `slice(1)` | ✅ COMPLIANT |
| CONF-302 Queue Skip Semantics | User skips all dialogs | `dialogActions.test.ts` confirm=skipAll; `handleSkipAll` = `setQueue([])` with no DB mutation | ✅ COMPLIANT |
| CONF-303 Toast Lifecycle Fix | Toast auto-hides after configured duration | grep: `visibilityTime` present + no `Toast.hide()`; spec corrected to match implementation | ✅ COMPLIANT |
| CONF-303 Toast Lifecycle Fix | New toast replaces previous one | Toast.show lifecycle grep contract + classify→toast runtime; per-notification re-invocation source-verified; replacement per corrected spec is library behavior | ⚠️ PARTIAL |
| CONF-304 Toast Type Mapping | Error notification shows error toast | grep `type: 'error'` in watcher; toastType mapping branch source-only | ⚠️ PARTIAL |
| CONF-304 Toast Type Mapping | Warning notification shows warning toast | `ToastConfig warning type` greps (entry + #f59e0b); watcher mapping source-only | ⚠️ PARTIAL |
| CONF-305 Watcher Error Handling | Realtime subscription fails | grep `shows error toast on subscription catch`; catch wiring source-only | ⚠️ PARTIAL |
| CONF-306 Localized Overflow Count | Multiple queued notifications | grep: `notifications:moreCount` used, no hardcoded Spanish; key exists in en+es with `{{count}}` | ✅ COMPLIANT |
| watcher MOD Initial-Load Race | Cold start with no unread notifications | grep proves no `isInitialLoadDone`/`fetchUnread`; subscription-active source-only | ⚠️ PARTIAL |
| watcher MOD Initial-Load Race | Cold start with unread notifications | same absence proof; badge-instead-of-dialog source-only | ⚠️ PARTIAL |
| watcher MOD Initial-Load Race | Realtime notification arrives after mount | classify table tested; INSERT→processIncoming→classify wiring source-only | ⚠️ PARTIAL |
| CONF-011-B Navigation Execution | Navigation succeeds | grep: `await router.push` present; no runtime navigation test possible in bun | ⚠️ PARTIAL |
| CONF-011-B Navigation Execution | Navigation error triggers fallback | grep: try/catch + fallback string present | ⚠️ PARTIAL |
| CONF-011-B Navigation Execution | Synchronous router error is caught | same try/catch covers sync throws by language semantics | ⚠️ PARTIAL |

**Compliance summary**: 21/39 scenarios COMPLIANT, 18 PARTIAL, 0 UNTESTED (first verify: 9/20/10); 7/19 requirements fully compliant (CONF-103, CONF-201, CONF-202, CONF-205, CONF-301, CONF-302, CONF-306 — first verify: 5/19).

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| CONF-101/102 dismiss + clear-all UI | ✅ Implemented | Long-press → ConfirmDialog → `dismissNotification` (NotificationItem); header Clear all → ConfirmDialog → `dismissAll` (notifications.tsx). |
| CONF-103 count badge | ✅ Implemented | Extracted `formatNotificationBadgeCount` (`core/utils/notificationBadge.ts`); used in `app/(tabs)/index.tsx` L187. |
| CONF-104 a11y labels | ✅ Implemented | `openLabel` on bell TouchableOpacity (L159); `dismissLabel` on item Pressable (L65); keys present in en+es. |
| CONF-201/202 mutations | ✅ Implemented | `.update({deleted_at})` with `.eq('id')`+`.eq('user_id')` / user-only scope in `useNotificationMutations.logic.ts`. |
| CONF-203 shared helper | ✅ Implemented | `invalidateNotificationKeys` used by all four builders + watcher realtime handler. |
| CONF-204 error toasts | ✅ Implemented | `showError()` in every `onError`. |
| CONF-205 optimistic badge | ✅ Implemented | `snapshotBadge`/`rollbackBadge` with `Math.max(0, n-1)` clamp; dismissAll zeroes. |
| CONF-301 typed classify | ✅ Implemented | `classify.ts` pure function, no title strings. |
| CONF-302 skip semantics | ✅ Implemented | Extracted `resolveDialogControls` (`dialogActions.ts`); watcher: skip=slice(1), skip-all=setQueue([]), isLast: cancel=setQueue([]), confirm=action. |
| CONF-303 toast lifecycle | ✅ Implemented | `visibilityTime: 4000`, no `Toast.hide()` — spec now corrected to match (deviation closed). |
| CONF-304 toast mapping | ✅ Implemented | success/warning/error passthrough else info; `warning` entry (#f59e0b) in ToastConfig. |
| CONF-305 watcher errors | ✅ Implemented | try/catch in payload handler + subscribe error callback → error toast. |
| CONF-306 moreCount | ✅ Implemented | `t('notifications:moreCount', { count })`; no hardcoded Spanish remains. |
| watcher MOD no initial load | ✅ Implemented | No `isInitialLoadDone`, no initial-fetch effect; realtime-only processing (grep-proven). |
| CONF-011-B linking | ✅ Implemented | `navigate()` async, `await router.push` in try/catch, fallback `/profile/notifications`; `console.info` in `dispatch`. |
| i18n flatten (design #4) | ✅ Implemented | en/notifications.json flat; all required keys + `dismissConfirm` in en+es. |
| List dismiss visibility | ✅ Implemented | `useNotificationsList` filters `.is('deleted_at', null)` — dismissed items leave the list on invalidation+refetch. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1. Optimistic badge with rollback | ✅ Yes | onMutate/onError in logic file; runtime-tested. |
| 2. Long-press → ConfirmDialog | ✅ Yes | NotificationItem; now grep-contracted. |
| 3. Dynamic two-action dialog | ✅ Yes | Extracted to `resolveDialogControls`; consumed by watcher; runtime-tested. |
| 4. Flatten en JSON, add es keys | ✅ Yes | Plus extra `dismissConfirm` key used by item dialog. |
| 5. visibilityTime, remove Toast.hide | ✅ Yes | Spec wording corrected to match — deviation closed. |
| 6. Toast type passthrough + warning entry | ✅ Yes | ToastConfig `warning` with #f59e0b. |
| 7. Delete useRef + initial-load effect | ✅ Yes | grep-verified absent. |
| 8. Helper exported from hook, imported by watcher | ✅ Yes | Defined in `.logic.ts`, re-exported from `useNotificationMutations.ts`. |
| 9. Keep dispatch + console.info | ✅ Yes | `NotificationService.dispatch` logs id+type. |
| 10. Linking try/catch await fallback | ✅ Yes | Covers sync + async failures. |

Extraction note: `useNotificationMutations.logic.ts`, `classify.ts`, `dialogActions.ts`, and `notificationBadge.ts` were extracted as pure helpers for bun testability (Bun crashes on static RN imports) and are all consumed by their UI counterparts — consistent with design intent and the first verify's S-1/S-2 remediation guidance, though not listed as separate files in the design's File Changes table.

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ❌ | Apply-progress (Engram obs #990, re-checked this pass) still contains no "TDD Cycle Evidence" table despite `strict_tdd: true`. Remediation added the missing tests test-after (post-implementation), which cannot retroactively produce apply-phase RED evidence. |
| All tasks have tests | ✅ | 50 tests across 4 files cover all 18 tasks' behaviors at available layers (runtime unit + approved source-grep contracts); previously 0-case areas (badge clip, skip/skip-all, markAsRead scope) all have cases now. |
| RED confirmed (tests exist) | ⚠️ | All test files exist and pass; RED-first ordering unverifiable without the evidence table. |
| GREEN confirmed (tests pass) | ✅ | 50/50 pass on independent execution (exit 0). |
| Triangulation adequate | ✅ | classify 8 cases; mutations payload/scope/error/optimistic/rollback; badge 6 values (0/3/9/10/24/999); dialog controls both branches; markAsRead/markAll/dismiss/dismissAll all triangulated. |
| Safety Net for modified files | ➖ | Modified files had no prior tests (new test layer); full-suite baseline drift documented (other changes' work). |

**TDD Compliance**: 3/6 checks passed, 1 partial, 1 failed (evidence table), 1 N/A.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 50 | 4 | bun:test |
| Integration | 0 | 0 | not installed |
| E2E | 0 | 0 | not installed |
| **Total** | **50** | **4** | |

Project capabilities (config.yaml testing block) declare unit-only; no integration/E2E tooling exists, so RN UI scenarios have no runtime test layer available — source-grep contracts are the design-approved substitute.

### Changed File Coverage

| File | Line % | Funcs % | Uncovered Lines | Rating |
|------|--------|---------|-----------------|--------|
| `components/features/notifications/classify.ts` | 100% | 100% | — | ✅ Excellent |
| `components/features/notifications/dialogActions.ts` | 100% | 100% | — | ✅ Excellent |
| `core/utils/notificationBadge.ts` | 100% | 100% | — | ✅ Excellent |
| `core/hooks/useNotificationMutations.logic.ts` | 73.68% | 76.92% | L102-118, L122-138, L149-151, L180-182 | ⚠️ Low |
| RN-dependent files (NotificationWatcher.tsx, NotificationItem.tsx, ToastConfig.tsx, notification.ts, screens, i18n JSON) | not measurable | — | — | ➖ bun:test cannot import RN modules |

**Average changed file coverage (measurable)**: 93.42% (was 79.47%). The logic file improved from 58.94%: `markNotificationAsRead` (L23-35) and `markAllNotificationsAsRead` (L37-49) are now covered. Remaining uncovered: the four dynamic-import `mutationFn` wrappers and both mark-as-read option builders (`onSuccess`/`onError` — the dismiss builders' equivalents ARE tested; see S-3).

### Assertion Quality

New/updated test files audited: `dialogActions.test.ts` (4 value assertions on a pure function), `notificationBadge.test.ts` (6 value assertions with variance 0→999), new source-grep contracts in `NotificationWatcher.test.ts` (presence assertions on production source — the design-approved contract layer), `useNotificationMutations.test.ts` additions (exact call-chain assertions with value checks). No tautologies, no ghost loops, no assertions without production-code reads, no smoke-only tests, no orphan empty checks. 94 expect() calls across 50 tests; mock/assertion ratio healthy.

**Assertion quality**: ✅ All assertions verify real behavior (0 CRITICAL, 0 WARNING). Grep presence-assertions for a11y labels and cancel wiring are looser than mechanism-encoding greps — noted as S-1, not a defect.

### Quality Metrics

**Linter**: ✅ exit 0 across all 13 notification-changed files (first verify's W-2 unused `_id` resolved via `void id;` statements).
**Type Checker**: ⚠️ exit 2 with 24 errors (down from 32), zero in files touched by this change (all attributed to other uncommitted in-flight work).

### Issues Found

**CRITICAL**:
1. C-11 (carried, unresolved): Strict TDD was active but apply-progress (Engram obs #990) still contains no "TDD Cycle Evidence" table. The remediation closed all ten scenario-coverage gaps and the spec defect, but the apply-phase TDD protocol artifact was never reported and cannot be honestly reconstructed post-hoc. This is now the sole archive blocker and requires a maintainer decision: explicitly waive the TDD-evidence requirement for this change (documented process debt) or reconstruct the evidence before archive.

**WARNING**:
1. W-3 (carried, improved): `useNotificationMutations.logic.ts` line coverage 73.68% (< 80%), up from 58.94%. Uncovered regions are the four dynamic-import `mutationFn` wrappers (L149-151, L180-182 — not unit-testable without supabase mocking) and both mark-as-read option builders (L102-118, L122-138 — testable with the existing fakes; see S-3).
2. W-4 (carried): Proposal drift: "Out of Scope" still lists "Optimistic updates" while CONF-205 requires them and design decision #1 + task 2.3 implement them.
3. W-5 (carried, refreshed): Full-suite regression state: `bun test` exit 1 (896 pass / 7 fail / 16 errors across 903 tests). All failures/errors verified NOT caused by this change — they live in supabase shipping-label/migration/envia tests and untracked `apps/frontend/tests/orders/*`, `tests/prepare/*` files of other concurrent work. Zero notification failures.
4. W-6 (carried, refreshed): Typecheck exit 2 with 24 errors (was 32) — all outside this change's files. Design's rollout claim "tsc green" cannot hold in this dirty worktree regardless of this change.

**SUGGESTION**:
1. S-1: Strengthen the a11y/cancel grep contracts to assert full patterns — `accessibilityLabel={t('notifications:openLabel')}` in index.tsx, `accessibilityLabel={t('notifications:dismissLabel')}` in NotificationItem.tsx — upgrading CONF-104 and CONF-102-S2 from presence to mechanism encoding.
2. S-2: Add `expect(screenSource()).toContain('useNotificationsList')` to the screen contracts to complete list MOD-S1's split-hook coverage.
3. S-3: Exercise `createMarkAsReadMutationOptions`/`createMarkAllAsReadMutationOptions` onError/onSuccess with the existing fakes (mirrors the dismiss-builder tests) — closes the CONF-204-S1 partial and lifts the logic file above the 80% bar.
4. S-4 (carried S-5): `NotificationItem` puts `accessibilityLabel={dismissLabel}` on the entire item Pressable; screen readers announce only "Dismiss notification" for an item whose primary action is open. Consider an `accessibilityHint`.
5. S-5 (carried S-6): In `NotificationLinking.navigate`, the fallback `router.push('/profile/notifications')` inside catch (and the null-path branch) is not awaited; a failing fallback would become an unhandled rejection.
6. S-6 (carried S-7): Watcher auto-calls `markAsRead` for toast notifications; a failing auto-mark surfaces a user-facing error toast for an action the user never initiated.

### Verdict

FAIL
All ten previously UNTESTED scenarios now have passing covering tests (21/39 COMPLIANT, 0 UNTESTED), the CONF-303 spec defect is corrected, the lint error is fixed, and coverage improved to 93.42% — but the strict-TDD evidence table remains unreported (C-11), which is the sole remaining archive blocker and needs an explicit maintainer waiver or evidence reconstruction before sdd-archive.
