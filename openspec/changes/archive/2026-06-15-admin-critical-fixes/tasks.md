# Tasks: Admin Critical Fixes

**Change**: `admin-critical-fixes`
**Date**: 2026-05-28
**Forecast**: ~90 net lines (within ~95 budget)

---

## Task Index

| ID | Title | Specs | Effort | Deps | Files |
|----|-------|-------|--------|------|-------|
| ACF-TASK-001 | Lock release refactor: useRef caching for admin ID | ACF-REQ-006 | M | None | `useProductLock.ts`, `useDisputeActions.ts` |
| ACF-TASK-002 | Session expiry handler with onAuthStateChange | ACF-REQ-001 | S | ACF-TASK-001 | `App.tsx` |
| ACF-TASK-003 | StatCard: href navigation + goal trend targets | ACF-REQ-008, ACF-REQ-009 | M | None | `StatCard.tsx` |
| ACF-TASK-004 | DashboardHome: error guards + KPI wiring | ACF-REQ-003, ACF-REQ-008, ACF-REQ-009 | S | ACF-TASK-003 | `DashboardHome.tsx` |
| ACF-TASK-005 | UsersPage: reset page on sort change | ACF-REQ-005 | XS | None | `UsersPage.tsx` |
| ACF-TASK-006 | DisputesPage: error state with retry | ACF-REQ-004 | XS | None | `DisputesPage.tsx` |
| ACF-TASK-007 | Pending products: audit surfacing + lock re-check | ACF-REQ-002, ACF-REQ-007 | M | None | `usePendingProducts.ts` |

---

## Checklist

- [x] ACF-TASK-001 — Lock release refactor: useRef caching for admin ID (ACF-REQ-006)
- [x] ACF-TASK-002 — Session expiry handler with onAuthStateChange (ACF-REQ-001)
- [x] ACF-TASK-003 — StatCard: href navigation + goal trend targets (ACF-REQ-008, ACF-REQ-009)
- [x] ACF-TASK-004 — DashboardHome: error guards + KPI wiring (ACF-REQ-003, ACF-REQ-008, ACF-REQ-009)
- [x] ACF-TASK-005 — UsersPage: reset page on sort change (ACF-REQ-005)
- [x] ACF-TASK-006 — DisputesPage: error state with retry (ACF-REQ-004)
- [x] ACF-TASK-007 — Pending products: audit surfacing + lock re-check (ACF-REQ-002, ACF-REQ-007)

---

## ACF-TASK-001 — Lock release refactor: useRef caching for admin ID

- **Spec**: ACF-REQ-006
- **Title**: Lock release does not depend on reactive user state
- **Files**:
  - `apps/admin-web/src/hooks/useProductLock.ts`
  - `apps/admin-web/src/hooks/useDisputeActions.ts`
- **Effort**: M (~11 net lines)
- **Dependencies**: None

### Description

Both `useProductLock` and `useDisputeActions.useDisputeLock` have a stale-closure bug: `releaseLock` captures `user?.id` via `useCallback` deps. When the session expires and `user` becomes `null`, the guard `if (!user?.id || !productId) return;` causes an early return — the unlock RPC never fires, leaking the lock server-side for 10 minutes.

Fix both hooks with the same pattern: cache the admin ID in a `useRef` at lock-acquisition time. `releaseLock` reads from the ref instead of the reactive `user?.id`.

### Steps

#### useProductLock.ts

1. **Import `useRef`**: add to the existing import from `'react'` on line 1.
2. **Add ref**: after `const { user } = useAuthStore();` (line 13), add:
   ```typescript
   const adminIdRef = useRef<string | null>(null);
   ```
3. **Cache on acquire**: inside `acquireLock`, after the `setLockStatus(...)` call on success (line 45-49) and before `return true`, add:
   ```typescript
   adminIdRef.current = user.id;
   ```
4. **Replace releaseLock guard**: change line 75 from:
   ```typescript
   if (!user?.id || !productId) return;
   ```
   to:
   ```typescript
   if (!adminIdRef.current || !productId) return;
   ```
5. **Replace releaseLock RPC arg**: change line 79 from `p_admin_id: user.id` to `p_admin_id: adminIdRef.current`.
6. **Clear ref after release**: after the `setLockStatus(...)` call in `releaseLock` (line 82-86) and before the closing brace of `try`, add:
   ```typescript
   adminIdRef.current = null;
   ```
7. **Stabilize deps**: change `releaseLock`'s `useCallback` deps from `[user?.id]` (line 91) to `[]`.

#### useDisputeActions.ts

Apply the identical pattern to the `useDisputeLock` section (lines 8-68):
1. Import `useRef` from `'react'`.
2. Add `adminIdRef` after `const { user }` (line 9).
3. Set ref after success in `acquireLock` (after line 29).
4. Change `releaseLock` guard to read from ref (line 52).
5. Change RPC call to use ref value (line 56).
6. Clear ref after successful release (after line 58).
7. Change deps to `[]` (line 64).

### Acceptance Criteria

- `acquireLock` succeeds → `adminIdRef.current` is set to `user.id`.
- `releaseLock` reads `adminIdRef.current` — NOT `user?.id` — and never has `user` in its dep array.
- After `releaseLock` succeeds, `adminIdRef.current` is cleared.
- If session expires while a lock is held, `releaseLock` still fires with the correct admin ID (ref survives `user → null`).
- If `acquireLock` fails (lock held by another), `adminIdRef.current` stays `null` — `releaseLock` correctly early-returns.

---

## ACF-TASK-002 — Session expiry handler with onAuthStateChange

- **Spec**: ACF-REQ-001
- **Title**: Add onAuthStateChange subscription in App.tsx
- **Files**: `apps/admin-web/src/App.tsx`
- **Effort**: S (~18 net lines)
- **Dependencies**: ACF-TASK-001 (ensures lock cleanup survives session clearance)

### Description

The admin dashboard has no `onAuthStateChange` listener. When a Supabase session expires (token refresh fails, user signs out from another tab, JWT expires), the UI stays in a "logged in" state — stale data remains visible and API calls silently fail with 401s.

Add a second `useEffect` in `App.tsx` that subscribes to `supabase.auth.onAuthStateChange`, handles `SIGNED_OUT` and failed `TOKEN_REFRESHED` events, and redirects to `/login`.

### Steps

1. **Add `useNavigate` import**: add to the existing `react-router-dom` import on line 3:
   ```typescript
   import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
   ```

2. **Add navigate hook**: inside the `App` function body (after `const initialize = useAuthStore(...)` on line 24), add:
   ```typescript
   const navigate = useNavigate();
   ```

3. **Add auth listener useEffect**: after the existing `useEffect(() => { initialize(); }, [])` (lines 26-28), add a new `useEffect`:
   ```typescript
   useEffect(() => {
     const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
       // INITIAL_SESSION is handled by initialize() above — don't duplicate
       if (event === 'INITIAL_SESSION') return;

       if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
         useAuthStore.getState().setUser(null, null);
         toast.warning('Sesión expirada. Redirigiendo al login...');
         navigate('/login');
       }
     });

     return () => subscription.unsubscribe();
   }, []);
   ```

4. **Add missing imports**: ensure `supabase` is imported (from `../lib/supabase` or wherever it's available), and `toast` from `'sonner'`. If App.tsx doesn't already have these imports, add them. (Check: `toast` is used by `Toaster` from sonner on line 2, so sonner is imported. `supabase` needs the correct import from the project's lib.)

### Acceptance Criteria

- `SIGNED_OUT` event → `setUser(null, null)` called, warning toast shown, URL changes to `/login`.
- `TOKEN_REFRESHED` with null session (refresh failed) → same treatment as SIGNED_OUT.
- `INITIAL_SESSION` event → ignored (the existing `initialize()` handles initial session restore).
- Listener cleanup unsubscribes on component unmount.
- Lock cleanup from VerificationPage/DisputeDetailPage (ACF-REQ-006) fires before the redirect — guaranteed by React's commit-phase cleanup ordering.

---

## ACF-TASK-003 — StatCard: href navigation + goal trend targets

- **Spec**: ACF-REQ-008, ACF-REQ-009
- **Title**: Add href and goal props to StatCard component
- **Files**: `apps/admin-web/src/components/ui/StatCard.tsx`
- **Effort**: M (~25 net lines)
- **Dependencies**: None

### Description

Add two new optional props to `StatCard`:

1. **`href`** (ACF-REQ-008): When provided, clicking the card navigates to that route. Adds cursor-pointer styling, click handler via `useNavigate()`, role="button" for accessibility, and keyboard (Enter/Space) handler.

2. **`goal`** (ACF-REQ-009): When provided alongside a non-neutral `trend`, renders a goal comparison text next to the trend badge (e.g. `"goal: 0%"`). Colors green (`text-forest`) if the goal is met, red (`text-fire`) if not. Includes `lowerIsBetter` flag for metrics where a downward trend is positive (disputes, pending products).

### Steps

1. **Add import**: at the top of the file, add:
   ```typescript
   import { useNavigate } from 'react-router-dom';
   ```

2. **Extend Props interface**: add after line 22 (or after `sparklineData` on line 22):
   ```typescript
   /** Navigate to this route on click */
   href?: string;
   /** Trend goal comparison */
   goal?: {
     value: number;
     label: string;
     /** For metrics where a downward trend is positive (e.g. disputes count) */
     lowerIsBetter?: boolean;
   } | null;
   ```

3. **Add navigate hook**: inside the `StatCard` destructuring (line 109-119), before the return statement:
   ```typescript
   const navigate = useNavigate();
   ```

4. **Destructure new props**: add `href` and `goal` to the destructuring on lines 109-119.

5. **Update outer div** — change from a single self-closing tag to a multi-line opening tag with:
   - `className` updated to conditionally append `cursor-pointer` when `href` is set
   - `onClick` handler using `navigate(href)` when `href` exists, `undefined` otherwise
   - `role={href ? 'button' : undefined}`
   - `tabIndex={href ? 0 : undefined}`
   - `onKeyDown` handler for Enter/Space keys when `href` exists

6. **Add goal rendering**: after the `TrendBadge` section (lines 138-142), add:
   ```tsx
   {!isLoading && goal && trend && trend.direction !== 'neutral' && (
     <span className={`text-xs font-semibold ml-2 ${
       (goal.lowerIsBetter && trend.direction === 'down') ||
       (!goal.lowerIsBetter && trend.direction === 'up' && trend.percentage >= goal.value)
         ? 'text-forest'
         : 'text-fire'
     }`}>
       goal: {goal.value}{goal.label ? ` (${goal.label})` : ''}
     </span>
   )}
   ```

### Acceptance Criteria

- `href` provided → card shows `cursor-pointer`, click navigates via `useNavigate`. Enter/Space triggers navigation.
- `href` not provided → no cursor change, no navigation, no keyboard listener — identical to current behavior.
- `goal` + `trend` (non-neutral) → goal text renders after the trend badge with correct green/red coloring.
- `goal` without `trend`, or `trend.direction === 'neutral'` → no goal text renders.
- `goal` not provided → no change from current behavior.
- TypeScript compiles without errors (existing `target` prop is untouched — `goal` is distinct).

---

## ACF-TASK-004 — DashboardHome: error guards + KPI wiring

- **Spec**: ACF-REQ-003, ACF-REQ-008 (wiring), ACF-REQ-009 (wiring)
- **Title**: Add error state guards and wire href/goal props on DashboardHome
- **Files**: `apps/admin-web/src/pages/DashboardHome.tsx`
- **Effort**: S (~12 net lines)
- **Dependencies**: ACF-TASK-003 (StatCard must accept `href` and `goal` props)

### Description

Three changes to `DashboardHome.tsx`:

1. **Error state guards** (ACF-REQ-003): Wrap the three data-dependent sections (operational KPIs grid, strategic metrics, activity summary) in `{!isError && (...)}` — when `isError` is true, only the existing error banner remains visible. No zero-value stat cards on error.

2. **KPI drilldown hrefs** (ACF-REQ-008 wiring): Pass `href="/verify"`, `href="/disputes"`, and `href="/payments"` to the respective operational StatCards.

3. **Trend goal props** (ACF-REQ-009 wiring): Pass `goal` objects to Pendientes de Verificación, Disputas Activas, and Ventas del Mes StatCards.

### Steps

1. **Error guard — operational KPIs grid** (lines 42-75): add `{!isError && (` before line 43 and `)}` after line 75.

2. **Error guard — strategic metrics section** (lines 77-103): add `{!isError && (` before line 78 and `)}` after line 103.

3. **Error guard — activity/chart section** (lines 105-139): add `{!isError && (` before line 106 and `)}` after line 139.

4. **Pendientes de Verificación** (lines 44-51): add after line 50:
   ```typescript
   href="/verify"
   goal={{ value: 0, label: 'ideal: 0', lowerIsBetter: true }}
   ```

5. **Disputas Activas** (lines 52-59): add after line 58:
   ```typescript
   href="/disputes"
   goal={{ value: 0, label: 'ideal: 0', lowerIsBetter: true }}
   ```

6. **Por Dispersar** (lines 60-66): add after line 65:
   ```typescript
   href="/payments"
   ```

7. **Ventas del Mes** (lines 67-74): add after line 73:
   ```typescript
   goal={{ value: stats?.trends.monthlySales?.percentage ?? 0, label: 'vs mes ant.', lowerIsBetter: false }}
   ```

### Acceptance Criteria

- `isError` true → operational KPI grid, strategic metrics, and activity summary are NOT rendered. Only the error banner (already existing) is visible. No zero-value stat cards.
- `isLoading` true, `isError` false → skeletons render as before (unchanged).
- `isError` becomes false after `refetch` → all three sections reappear with correct data.
- Clicking "Pendientes de Verificación" navigates to `/verify`.
- Clicking "Disputas Activas" navigates to `/disputes`.
- Clicking "Por Dispersar" navigates to `/payments` (placeholder).
- Clicking "Ventas del Mes" does nothing (no href) — purely visual.
- "Ventas del Mes" StatCard shows goal comparison next to its trend.
- Strategic metric cards (Usuarios Registrados, Productos Verificados, Total Productos) remain unchanged — no href, no goal.

---

## ACF-TASK-005 — UsersPage: reset page on sort change

- **Spec**: ACF-REQ-005
- **Title**: Add setPage(0) in sort onChange handler
- **Files**: `apps/admin-web/src/pages/UsersPage.tsx`
- **Effort**: XS (~1 net line)
- **Dependencies**: None

### Description

The sort `<select>` handler only calls `setSortBy` but NOT `setPage(0)`. If an admin is on page >0 and changes sort order, the query fires with a stale page number — returning incorrect data or empty results.

Fix: add `setPage(0)` in the same `onChange` handler alongside `setSortBy`.

### Steps

1. **Modify line 105**: change from:
   ```typescript
   onChange={(e) => setSortBy(e.target.value)}
   ```
   to:
   ```typescript
   onChange={(e) => {
     setSortBy(e.target.value);
     setPage(0);
   }}
   ```

### Acceptance Criteria

- Admin on page 3, changes sort → page resets to 0, query fires with correct range for page 0 under the new sort.
- Admin on page 0, changes sort → `setPage(0)` is redundant but harmless.
- React batches `setSortBy` and `setPage(0)` into a single render — TanStack Query deduplicates into one query with correct params (satisfies NFR-PERF-03).
- Existing page resets on search change and status filter change continue to work unchanged.

---

## ACF-TASK-006 — DisputesPage: error state with retry

- **Spec**: ACF-REQ-004
- **Title**: Wire isError/refetch from useActiveDisputes, render ErrorState banner
- **Files**: `apps/admin-web/src/pages/DisputesPage.tsx`
- **Effort**: XS (~5 net lines)
- **Dependencies**: None

### Description

`DisputesPage` only destructures `data` and `isLoading` from `useActiveDisputes`. When the query fails, disputes is `undefined`, the table renders empty, and "Casos en Pantalla" shows 0 — no failure indication.

Fix: destructure `isError` and `refetch` (both already available from `useQuery` — no hook changes needed), and render `<ErrorState onRetry={() => refetch()} />` between the header and filter tabs.

### Steps

1. **Add `ErrorState` import**: after line 6 (current last import), add:
   ```typescript
   import { ErrorState } from '../components/ui/ErrorState';
   ```

2. **Expand destructure** (line 14): change from:
   ```typescript
   const { data: disputes, isLoading } = useActiveDisputes(
   ```
   to:
   ```typescript
   const { data: disputes, isLoading, isError, refetch } = useActiveDisputes(
   ```

3. **Add error state banner**: after the closing `</div>` of the header section (line 36) and before the filter tabs comment (line 38), add:
   ```tsx
   {isError && (
     <ErrorState onRetry={() => refetch()} />
   )}
   ```

### Acceptance Criteria

- API succeeds → no `ErrorState`. Full dispute list renders. No visual change from current behavior.
- API fails → heading ("Centro de Disputas") and "Casos en Pantalla" stat remain visible. `ErrorState` banner appears between the heading and the filter tabs with a retry button.
- Clicking retry calls `refetch()`. On success, `isError` → false, banner disappears, dispute list renders.
- Filter/sort change during error state: query refires with new params, `isError` resets (TanStack Query behavior).
- The `useActiveDisputes` hook itself is NOT modified — `isError` and `refetch` are already exposed by `useQuery`.

---

## ACF-TASK-007 — Pending products: audit surfacing + lock re-check

- **Spec**: ACF-REQ-002, ACF-REQ-007
- **Title**: Surface audit/notification errors and add lock re-check before verdict
- **Files**: `apps/admin-web/src/hooks/usePendingProducts.ts`
- **Effort**: M (~12 net lines)
- **Dependencies**: None

### Description

Two changes in the same `resolveMutation.mutationFn` function:

1. **ACF-REQ-002**: Replace the two empty `if (logError) { }` and `if (notifError) { }` blocks with `console.error` + `toast.warning` calls to surface audit trail and notification errors.

2. **ACF-REQ-007**: Before the `products.update()` call, add an RPC call to `fn_lock_product` to verify the current admin still holds the soft lock. If the lock is expired or held by another admin, throw an error — the product status is NOT changed.

### Steps

1. **Add lock re-check** — at the top of `mutationFn` body (after `const isRejection = verdict === 'REJECT';` on line 97 and BEFORE the `products.update()` at line 99), add:
   ```typescript
   // Verify lock is still held
   const { data: lockData, error: lockError } = await supabase.rpc('fn_lock_product', {
     p_product_id: id,
     p_admin_id: user?.id,
   });
   if (lockError) throw lockError;
   const lockResult = lockData[0];
   if (!lockResult.success) {
     throw new Error('Tu sesión de revisión expiró. Selecciona el producto nuevamente.');
   }
   ```

2. **Replace audit log empty block** (lines 127-129): change from:
   ```typescript
   if (logError) {
     // Audit log insertion was non-critical; product already updated
   }
   ```
   to:
   ```typescript
   if (logError) {
     console.error('Error registrando auditoría:', logError);
     toast.warning('Audit log no registrado. Contacta a soporte.');
   }
   ```

3. **Replace notification error empty block** (lines 163-165): change from:
   ```typescript
   if (notifError) {
     // Notification delivery non-critical; product already updated
   }
   ```
   to:
   ```typescript
   if (notifError) {
     console.error('Error notificando al vendedor:', notifError);
     toast.warning('Notificación no enviada al vendedor.');
   }
   ```

### Acceptance Criteria

**ACF-REQ-002**:
- Audit log insert fails → `console.error` with full error + `toast.warning("Audit log no registrado...")`.
- Notification insert fails → `console.error` with full error + `toast.warning("Notificación no enviada...")`.
- Both succeed → no additional toasts beyond existing success toast.
- Warning toasts do NOT block `onSuccess` from firing — success toast still shows.
- Mutation does NOT throw on audit/notification errors — they remain fire-and-forget.

**ACF-REQ-007**:
- Lock check RPC returns `success: true` → mutation proceeds to `products.update()`.
- Lock check RPC returns `success: false` → throws `Error("Tu sesión de revisión expiró...")` → `onError` shows toast with that message. `products.update()` is NOT called.
- Lock check RPC returns an error → `if (lockError) throw lockError` → `onError` shows the RPC error.
- `user?.id` is undefined (session already expired) → `fn_lock_product` with undefined admin_id returns an RPC error → caught by `onError`.

---

## Review Workload Forecast

| Task | Spec(s) | Files | Net Lines | Effort |
|------|---------|-------|-----------|--------|
| ACF-TASK-001 | ACF-REQ-006 | `useProductLock.ts`, `useDisputeActions.ts` | ~11 | M |
| ACF-TASK-002 | ACF-REQ-001 | `App.tsx` | ~18 | S |
| ACF-TASK-003 | ACF-REQ-008, ACF-REQ-009 | `StatCard.tsx` | ~25 | M |
| ACF-TASK-004 | ACF-REQ-003, ACF-REQ-008, ACF-REQ-009 | `DashboardHome.tsx` | ~12 | S |
| ACF-TASK-005 | ACF-REQ-005 | `UsersPage.tsx` | ~1 | XS |
| ACF-TASK-006 | ACF-REQ-004 | `DisputesPage.tsx` | ~5 | XS |
| ACF-TASK-007 | ACF-REQ-002, ACF-REQ-007 | `usePendingProducts.ts` | ~12 | M |
| **Total** | **9 specs** | **8 files** | **~84** | — |

**Chained PRs**: NOT recommended. Total ~84 net lines is well under the 400-line threshold. A single PR with work-unit commits is appropriate.

**Dependency graph**:
```
ACF-TASK-001 (lock refactor) ──→ ACF-TASK-002 (session handler)
ACF-TASK-003 (StatCard) ──────→ ACF-TASK-004 (DashboardHome wiring)
ACF-TASK-005, 006, 007 ─────── independent (no deps)
```

Tasks 5, 6, and 7 can be implemented in any order after 1-4 are complete. Tasks 1 and 3 are fully independent and can be parallelized.
