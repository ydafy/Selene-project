# Phase 1 — Quick Cleanup

Delta spec for the admin dashboard audit & refactor. Phase 1 removes dead code, fixes the HTML title, removes debug logging, and patches a missing CSS utility.

## Requirements

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|-------------------|
| PH1-REQ-001 | Delete `ReturnLabelModal.tsx` | Remove the dead component file at `apps/admin-web/src/components/features/disputes/ReturnLabelModal.tsx`. No imports to this component exist anywhere in the codebase. | File is deleted. `git grep 'ReturnLabelModal' apps/admin-web/src` returns zero matches (excluding its own file). |
| PH1-REQ-002 | Delete `UserPassport.tsx` | Remove the dead component file at `apps/admin-web/src/components/features/users/UserPassport.tsx`. No imports to this component exist anywhere in the codebase. | File is deleted. `git grep 'UserPassport' apps/admin-web/src` returns zero matches (excluding its own file). |
| PH1-REQ-003 | Delete `App.css` | Remove the Vite boilerplate file at `apps/admin-web/src/App.css`. It is not imported by `main.tsx`, `App.tsx`, or any other file. Only `./index.css` is imported. | File is deleted. `git grep 'App.css' apps/admin-web/src` returns zero matches. Build (`bun run build` in `apps/admin-web`) passes without errors. |
| PH1-REQ-004 | Update HTML `<title>` | Change the document title in `apps/admin-web/index.html` from `admin-web` to `Selene Admin Panel`. | `<title>` element reads `Selene Admin Panel`. Opening the dashboard in a browser shows the new title in the browser tab. |
| PH1-REQ-005 | Remove debug logging from `usePendingProducts` | Delete all `console.log`, `console.warn`, and `console.error` calls from `apps/admin-web/src/hooks/usePendingProducts.ts`. Debug logging has no place in production code. | Zero `console.` statements remain in the file. The hook continues to work: data fetching, mutation, toast notifications, and cache invalidation are unchanged. |
| PH1-REQ-006 | Remove debug logging from `useProductLock` | Delete all `console.log`, `console.warn`, and `console.error` calls from `apps/admin-web/src/hooks/useProductLock.ts`. Debug logging has no place in production code. | Zero `console.` statements remain in the file. The hook continues to work: lock acquisition, lock release, lock status tracking, and toast warnings are unchanged. |
| PH1-REQ-007 | Add `scrollbar-hide` utility | Add a Tailwind v4 `@utility` in `apps/admin-web/src/index.css` that hides scrollbars while preserving scroll functionality. The class is used in 3 locations (`VerificationPage.tsx` lines 186, 487; `UsersPage.tsx` line 77) but is currently undefined. | `@utility scrollbar-hide` is defined in `index.css`. Build passes. Scrollable containers with `scrollbar-hide` class still scroll but show no visible scrollbar. |

## Constraints

- MUST NOT change any file outside `apps/admin-web/`.
- MUST NOT change any user-visible behavior except the HTML `<title>` (PH1-REQ-004).
- MUST NOT leave dangling imports — files removed in PH1-REQ-001 and PH1-REQ-002 must be confirmed unreferenced before deletion.
- MUST NOT modify the logic of any hook — only remove `console.*` statements.
- SHOULD preserve the `@utility scrollbar-hide` definition adjacent to the existing `@theme` and `@layer base` blocks in `index.css`.

## Verification Criteria

| Criterion | Method |
|-----------|--------|
| Dead files deleted | `git ls-files --deleted` shows the 3 files. No compilation errors. |
| No dangling imports | `git grep` for each deleted symbol returns zero matches. |
| Title updated | `grep '<title>'` in `index.html` outputs `Selene Admin Panel`. |
| No console.log in hooks | `grep -n 'console\.'` in both hook files returns zero matches. |
| scrollbar-hide works | `grep '@utility scrollbar-hide'` in `index.css` returns the definition. Build passes. |
| Build passes | `bun run build` in `apps/admin-web` exits with code 0. |
| Type-check passes | `bunx tsc -b` in `apps/admin-web` exits with code 0. |

## Scenarios

### PH1-REQ-001 — Delete `ReturnLabelModal.tsx`

**Scenario: Clean deletion**
- GIVEN the file `apps/admin-web/src/components/features/disputes/ReturnLabelModal.tsx` exists
- WHEN the file is deleted
- THEN no other file in `apps/admin-web/src` imports from it
- AND `bun run build` succeeds
- AND `bunx tsc -b` succeeds

### PH1-REQ-002 — Delete `UserPassport.tsx`

**Scenario: Clean deletion**
- GIVEN the file `apps/admin-web/src/components/features/users/UserPassport.tsx` exists
- WHEN the file is deleted
- THEN no other file in `apps/admin-web/src` imports from it
- AND `bun run build` succeeds
- AND `bunx tsc -b` succeeds

### PH1-REQ-003 — Delete `App.css`

**Scenario: Clean deletion**
- GIVEN the file `apps/admin-web/src/App.css` exists and is not imported by any source file
- WHEN the file is deleted
- THEN the dashboard renders identically (no visual change)
- AND `bun run build` succeeds

### PH1-REQ-004 — Update HTML `<title>`

**Scenario: Title updated in markup**
- GIVEN the file `apps/admin-web/index.html` exists with `<title>admin-web</title>`
- WHEN the title is changed to `Selene Admin Panel`
- THEN the browser tab displays "Selene Admin Panel" when the app is loaded
- AND no other `<title>` elements exist in the file

### PH1-REQ-005 — Remove debug logging from `usePendingProducts`

**Scenario: All console calls removed**
- GIVEN the file `apps/admin-web/src/hooks/usePendingProducts.ts` contains 10 `console.*` calls
- WHEN all 10 calls are removed
- THEN the hook still fetches data, handles errors, fires toasts, and invalidates query cache
- AND `bun run build` succeeds

**Scenario: Error-path logging removed without breaking error handling**
- GIVEN the `resolveMutation` error paths (lines 153-154, 188-189) previously used `console.error`
- WHEN those calls are removed
- THEN errors are still surfaced to the admin via `toast.error()` (already present on lines 154 and 189 error-handling flows)
- AND the mutation still completes the successful path even when audit log or notification insert fails

### PH1-REQ-006 — Remove debug logging from `useProductLock`

**Scenario: All console calls removed**
- GIVEN the file `apps/admin-web/src/hooks/useProductLock.ts` contains 10 `console.*` calls
- WHEN all 10 calls are removed
- THEN the hook still acquires locks, releases locks, shows `toast.warning` for locked-by-other, and returns `LockStatus`
- AND `bun run build` succeeds

### PH1-REQ-007 — Add `scrollbar-hide` utility

**Scenario: Utility defined and usable**
- GIVEN `scrollbar-hide` is not a built-in Tailwind utility
- WHEN `@utility scrollbar-hide { ... }` is added to `apps/admin-web/src/index.css`
- THEN existing `scrollbar-hide` class usage in `VerificationPage.tsx` and `UsersPage.tsx` resolves to the custom utility
- AND scrollable containers still scroll but hide the scrollbar visually
- AND `bun run build` succeeds

**Scenario: No existing usage breaks**
- GIVEN `scrollbar-hide` is a brand-new utility
- WHEN the utility is added
- THEN no existing component loses its scroll functionality
- AND no existing component gains an unintended scrollbar
