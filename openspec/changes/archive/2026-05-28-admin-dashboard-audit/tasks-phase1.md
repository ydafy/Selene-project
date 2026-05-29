# Phase 1 — Quick Cleanup: Task Breakdown

## 1. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Total files touched | 7 (3 deleted, 3 edited, 1 created/modified CSS) |
| Lines added | ~8 (scrollbar-hide `@utility`) |
| Lines removed | ~230 (dead components + App.css + console.log) |
| Net lines delta | **~−222** (net negative — deletions dominate) |
| 400-line review budget risk | **None**. Net negative change, well under budget. |
| Chained PR recommendation | **Single PR**. All changes are mechanical, independent, and individually revertable. No stacked PR needed. |

## 2. Task List

### T-001 — Delete `ReturnLabelModal.tsx`

| Field | Value |
|-------|-------|
| **Description** | Delete the dead component file `apps/admin-web/src/components/features/disputes/ReturnLabelModal.tsx`. Verified at task-writing time: `git grep 'ReturnLabelModal' apps/admin-web/src` returns zero matches (excluding the file itself). No import cleanup needed. |
| **Requirements** | PH1-REQ-001 |
| **Files** | Delete: `apps/admin-web/src/components/features/disputes/ReturnLabelModal.tsx` |
| **Dependencies** | None |
| **Verification** | `git ls-files --deleted \| grep ReturnLabelModal` shows the file. `git grep 'ReturnLabelModal' apps/admin-web/src --include='*.{ts,tsx}'` returns 0 matches. `bun run build` passes. |
| **Effort** | XS (< 5 lines, 1 file, delete only) |

---

### T-002 — Delete `UserPassport.tsx`

| Field | Value |
|-------|-------|
| **Description** | Delete the dead component file `apps/admin-web/src/components/features/users/UserPassport.tsx`. Verified at task-writing time: `git grep 'UserPassport' apps/admin-web/src` returns zero matches (excluding the file itself). No import cleanup needed. |
| **Requirements** | PH1-REQ-002 |
| **Files** | Delete: `apps/admin-web/src/components/features/users/UserPassport.tsx` |
| **Dependencies** | None |
| **Verification** | `git ls-files --deleted \| grep UserPassport` shows the file. `git grep 'UserPassport' apps/admin-web/src --include='*.{ts,tsx}'` returns 0 matches. `bun run build` passes. |
| **Effort** | XS (< 5 lines, 1 file, delete only) |

---

### T-003 — Delete `App.css`

| Field | Value |
|-------|-------|
| **Description** | Delete the Vite boilerplate file `apps/admin-web/src/App.css`. Verified at task-writing time: `App.css` is not imported by `main.tsx` (only `./index.css` is imported), not by `App.tsx`, and not by any other file. This file only contains default Vite styles that are overridden by the project's Tailwind design system. |
| **Requirements** | PH1-REQ-003 |
| **Files** | Delete: `apps/admin-web/src/App.css` |
| **Dependencies** | None |
| **Verification** | `git ls-files --deleted \| grep App.css` shows the file. `git grep 'App.css' apps/admin-web/src --include='*.{ts,tsx,js,jsx}'` returns 0 matches. Dashboard renders identically (no visual regressions — the deleted styles were Vite defaults, unused in the project's dark theme). `bun run build` passes. |
| **Effort** | XS (< 5 lines, 1 file, delete only) |

---

### T-004 — Update HTML `<title>`

| Field | Value |
|-------|-------|
| **Description** | Change `<title>admin-web</title>` to `<title>Selene Admin Panel</title>` in `apps/admin-web/index.html`. Current value at task-writing time: `admin-web`. |
| **Requirements** | PH1-REQ-004 |
| **Files** | Modify: `apps/admin-web/index.html` (line 5, single attribute change) |
| **Dependencies** | None |
| **Verification** | `grep '<title>' apps/admin-web/index.html` outputs `<title>Selene Admin Panel</title>`. Opening the dev server shows the new title in the browser tab. |
| **Effort** | XS (1 line changed) |

---

### T-005 — Remove debug logging from `usePendingProducts`

| Field | Value |
|-------|-------|
| **Description** | Delete all 10 `console.*` calls from `apps/admin-web/src/hooks/usePendingProducts.ts`. Current at task-writing time: 8 `console.log` (lines 12, 23, 33, 43, 49, 58, 65, 74) + 2 `console.error` (lines 154, 189). **Do not change hook logic.** Error paths already surface to the admin via `toast.error()` (lines 154, 189 error-handling flows). The `console.error` calls only duplicate what the toast already communicates. |
| **Requirements** | PH1-REQ-005 |
| **Files** | Modify: `apps/admin-web/src/hooks/usePendingProducts.ts` (remove lines 12, 23, 33, 43, 49, 58, 65, 74, 154, 189 — exact console.* lines) |
| **Dependencies** | None |
| **Verification** | `grep -n 'console\.' apps/admin-web/src/hooks/usePendingProducts.ts` returns 0 matches. Hook still fetches data, handles errors (via `toast.error()`), and fires `resolveMutation` correctly. `bun run build` passes. |
| **Effort** | S (< 20 lines changed, simple deletions, same file) |

---

### T-006 — Remove debug logging from `useProductLock`

| Field | Value |
|-------|-------|
| **Description** | Delete all 10 `console.*` calls from `apps/admin-web/src/hooks/useProductLock.ts`. Current at task-writing time: 6 `console.log` (lines 28, 42, 48, 56, 89, 98) + 1 `console.warn` (line 36) + 3 `console.error` (lines 51, 77, 106). **Do not change hook logic.** Error paths already surface to the admin via `toast.warning()` and `toast.error()`. The `console.*` calls only duplicate what toasts already communicate. |
| **Requirements** | PH1-REQ-006 |
| **Files** | Modify: `apps/admin-web/src/hooks/useProductLock.ts` (remove lines 28, 36, 42, 48, 51, 56, 77, 89, 98, 106 — exact console.* lines) |
| **Dependencies** | None |
| **Verification** | `grep -n 'console\.' apps/admin-web/src/hooks/useProductLock.ts` returns 0 matches. Hook still acquires locks, releases locks, shows `toast.warning` for locked-by-other, and returns `LockStatus`. `bun run build` passes. |
| **Effort** | S (< 20 lines changed, simple deletions, same file) |

---

### T-007 — Add `scrollbar-hide` custom utility

| Field | Value |
|-------|-------|
| **Description** | Add a Tailwind v4 `@utility scrollbar-hide` definition to `apps/admin-web/src/index.css`. The class is used in 3 locations (VerificationPage.tsx lines 186, 487; UsersPage.tsx line 77) but is currently undefined. Tailwind v4 uses CSS-native `@utility` instead of the v3 JavaScript plugin API. Insert after the `@layer base` block (line 33). |
| **Requirements** | PH1-REQ-007 |
| **Files** | Modify: `apps/admin-web/src/index.css` (append after line 33) |
| **Dependencies** | None |
| **Verification** | `grep '@utility scrollbar-hide' apps/admin-web/src/index.css` returns the definition. `bun run build` passes. Scrollable containers with `scrollbar-hide` class still scroll but show no visible scrollbar. |
| **Effort** | XS (< 10 lines added, 1 file) |

---

## 3. Execution Order

All 7 tasks are **fully independent** — no task depends on another. They can be implemented in any order.

However, for clean commit organization, the recommended execution order is:

```
T-001 ────┐
T-002 ────┤
T-003 ────┤  (all independent)
T-004 ────┤
T-005 ────┤
T-006 ────┤
T-007 ────┘
```

### Suggested grouping for a single commit:

1. **Commit 1** — `Delete dead component files and Vite boilerplate` (T-001, T-002, T-003)
2. **Commit 2** — `Remove debug logging from hooks` (T-005, T-006)
3. **Commit 3** — `Fix HTML title and add scrollbar-hide utility` (T-004, T-007)

Or as a **single commit**: `Phase 1 — Quick Cleanup`

### Delivery recommendation

Deliver as a **single PR** targeting `main`. The 400-line review budget is not at risk (~220 net deletions, ~8 lines added). Each change is independently revertable via `git checkout` if any issue is discovered during review.
