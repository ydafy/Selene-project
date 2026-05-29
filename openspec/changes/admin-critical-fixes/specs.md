# Specs: Admin Critical Fixes

**Change**: `admin-critical-fixes`
**File**: `openspec/changes/admin-critical-fixes/specs.md`
**Date**: 2026-05-28

---

## Specs Index

| ID | Title | Severity |
|----|-------|----------|
| ACF-REQ-001 | Session expiry handler | CRITICAL |
| ACF-REQ-002 | Audit trail and notification errors surfaced | CRITICAL |
| ACF-REQ-003 | Dashboard error state hides data | HIGH |
| ACF-REQ-004 | DisputesPage error state | HIGH |
| ACF-REQ-005 | Sort resets pagination on UsersPage | MEDIUM |
| ACF-REQ-006 | Lock release does not depend on user state | MEDIUM |
| ACF-REQ-007 | Lock re-check before verdict | MEDIUM |
| ACF-REQ-008 | KPI drilldown navigation | HIGH |
| ACF-REQ-009 | Trend targets | MEDIUM |

---

## ACF-REQ-001 — Session expiry handler

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Priority** | 1 |
| **Status** | Draft |

### Description

The admin dashboard has no `onAuthStateChange` listener. When a Supabase session expires (token refresh fails, user signed out from another tab, JWT expires), the UI stays in a "logged in" state — stale data remains visible and any subsequent API call gets a 401. Admins can think actions succeeded when they didn't.

`ProtectedRoute` does re-evaluate via Zustand subscription, but there is currently no mechanism that triggers the session clear + redirect. The auth listener fills this gap.

### Acceptance Criteria

1. `App.tsx` registers a `supabase.auth.onAuthStateChange` listener inside a `useEffect`, scoped to the component lifecycle.
2. On `SIGNED_OUT` event: call `useAuthStore.getState().setUser(null, null)`, show `toast.warning("Sesión expirada. Redirigiendo al login...")`, and navigate to `/login` using `useNavigate()`.
3. On `TOKEN_REFRESHED` event where the new session is `null` (refresh failed): same treatment as `SIGNED_OUT`.
4. The listener must guard against processing the initial `INITIAL_SESSION` event as a sign-out. The `initialize()` call in `useEffect` already handles the initial session restore — `onAuthStateChange` must not duplicate or undo that.
5. The `useNavigate` call must be stable (obtained from a component that is always mounted, such as `App` itself, or via a navigation utility).
6. Session expiry → admin sees a warning toast + redirect to `/login` within 5 seconds of the `SIGNED_OUT` event.
7. Lock release cleanup (`useEffect` cleanup in `VerificationPage` / `DisputeDetailPage`) runs before React commits the redirect — this is guaranteed by React's commit phase execution order and requires no explicit coordination beyond stable callback references (see ACF-REQ-006).

### Files Affected

| File | Change |
|------|--------|
| `src/App.tsx` | Add `onAuthStateChange` subscription + session expiry handler |

### Scenarios

**Happy Path**: Admin is on `/verify`, session expires. Supabase fires `SIGNED_OUT`. Handler sets user→null, shows warning toast, navigates to `/login`. `ProtectedRoute` re-evaluates and redirects. Admin sees login page with the toast still visible.

**Edge Case**: Admin is submitting a verdict when the session expires. The `supabase.from('products').update()` call returns a 401. The mutation `onError` fires with `toast.error("Error: ...")`. Then the auth listener fires and redirects to `/login`. Admin sees both toasts: the 401 error and the session expiry warning. No data corruption — the server-side RLS rejects the write.

---

## ACF-REQ-002 — Audit trail and notification errors surfaced

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Priority** | 2 |
| **Status** | Draft |

### Description

In `usePendingProducts.ts`, the `resolveMutation.mutationFn` contains two empty conditional blocks that silently swallow DB errors from audit log insertion and notification creation:

```typescript
if (logError) {
  // Audit log insertion was non-critical; product already updated
}
if (notifError) {
  // Notification delivery non-critical; product already updated
}
```

These suppress errors that erode audit integrity and leave sellers uninformed about product status changes.

### Acceptance Criteria

1. Replace `if (logError) { /* silent */ }` with:
   - `console.error("Error registrando auditoría:", logError)`
   - `toast.warning("Audit log no registrado. Contacta a soporte.")`
2. Replace `if (notifError) { /* silent */ }` with:
   - `console.error("Error notificando al vendedor:", notifError)`
   - `toast.warning("Notificación no enviada al vendedor.")`
3. The warning toasts must NOT block the mutation success flow — the `onSuccess` callback still fires and shows `toast.success("Veredicto enviado correctamente")`.
4. If both operations succeed, no additional toasts appear beyond the existing success toast.
5. The mutation does NOT throw on audit/notification errors — they remain fire-and-forget.

### Files Affected

| File | Change |
|------|--------|
| `src/hooks/usePendingProducts.ts` | Replace empty error blocks in `resolveMutation.mutationFn` |

### Scenarios

**Happy Path**: Admin approves a product. Both `admin_audit_logs.insert()` and `notifications.insert()` succeed. Admin sees only the standard success toast.

**Edge Case**: Admin rejects a product. `admin_audit_logs.insert()` fails (e.g. FK violation). `notifications.insert()` succeeds. Product status is already `REJECTED` (the product update ran first). Admin sees: success toast + "Audit log no registrado" warning. Console shows the full error details for debugging.

---

## ACF-REQ-003 — Dashboard error state hides data

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Priority** | 3 |
| **Status** | Draft |

### Description

On `DashboardHome`, when `useAdminStats` fails (`isError: true`), the stat cards display `0` for every metric due to the `?? 0` fallback. An admin seeing all zeros cannot distinguish between "empty system" and "API failure", which erodes dashboard trust.

### Acceptance Criteria

1. When `isError` is true, render only the error banner (already present at the top with "Reintentar" button) — DO NOT render stat card grids, strategic metrics section, or the activity summary block that reads from `stats`.
2. Stat cards must not appear with zero values. The entire card grid sections are hidden.
3. Loading state (skeletons) behavior is unchanged — when `isLoading` is true and `isError` is false, skeletons still render.
4. After a successful `refetch()`, `isError` becomes false, `data` populates, and stat cards reappear with correct values.

### Files Affected

| File | Change |
|------|--------|
| `src/pages/DashboardHome.tsx` | Wrap stat card grids and activity summary in `!isError && ...` guard |

### Scenarios

**Happy Path**: Dashboard loads, API succeeds. Admin sees all stat cards with real data, error banner hidden.

**Edge Case**: Dashboard loads, API times out. Admin sees only the error banner with "Reintentar" button. No stat cards, no zeros. Clicks "Reintentar", API succeeds, cards appear with correct data.

---

## ACF-REQ-004 — DisputesPage error state

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Priority** | 4 |
| **Status** | Draft |

### Description

`DisputesPage` uses `useActiveDisputes` but only destructures `data` and `isLoading`. When the query fails, `disputes` is `undefined`, the table renders empty, and the "Casos en Pantalla" count shows 0. The admin has no indication of a failure.

### Acceptance Criteria

1. Destructure `isError` and `refetch` from the `useActiveDisputes` return value alongside the existing `data` and `isLoading`.
2. When `isError` is true, render `<ErrorState onRetry={() => refetch()} />` at the top of the page content, above the filter tabs but below the `<h2>` heading.
3. The `ErrorState` component (already exists at `src/components/ui/ErrorState.tsx`) shows a retry button that calls `refetch()`.
4. After a successful retry (`isError` → false), the `ErrorState` disappears and the disputes list renders normally.
5. The error state is a banner, not a full-page replacement — the heading ("Centro de Disputas") and the "Casos en Pantalla" stat remain visible.
6. The `useActiveDisputes` hook needs no changes — `useQuery` already exposes `isError` and `refetch`.

### Files Affected

| File | Change |
|------|--------|
| `src/pages/DisputesPage.tsx` | Destructure `isError`/`refetch`; conditionally render `<ErrorState>` |

### Scenarios

**Happy Path**: Disputes page loads, API succeeds. Admin sees full dispute list with filters, search, sort. No error state.

**Edge Case**: API fails on initial load. Page heading and "Casos en Pantalla" stat are shown. Between the heading and the filter tabs, an `ErrorState` banner appears with retry button. Admin clicks retry, API succeeds, banner disappears, disputes list renders.

---

## ACF-REQ-005 — Sort resets pagination on UsersPage

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Priority** | 5 |
| **Status** | Draft |

### Description

On `UsersPage`, the sort `<select onChange>` handler calls `setSortBy(e.target.value)` but NOT `setPage(0)`. If an admin is on page >0 and changes sort order, the query fires with a stale page number under the new sort — resulting in incorrect data or empty results.

Both the search input handler and status filter tab clicks already correctly call `setPage(0)`.

### Acceptance Criteria

1. In the sort `<select onChange>` handler, add `setPage(0)` alongside the existing `setSortBy` call:
   ```typescript
   onChange={(e) => {
     setSortBy(e.target.value);
     setPage(0);
   }}
   ```
2. Admin on page >0, changes sort → page resets to 0, new query fires with correct range for page 0 under the new sort.
3. Existing page resets (search, status filter) continue to work unchanged.

### Files Affected

| File | Change |
|------|--------|
| `src/pages/UsersPage.tsx` | Add `setPage(0)` in sort `<select onChange>` handler |

### Scenarios

**Happy Path**: Admin is on page 3, sorted by "Más recientes". Changes to "Mayor saldo". Page resets to 0. Query fires with `sortBy='balance'`, `page=0`. Users sorted by balance display correctly.

**Edge Case**: Admin is on page 0, changes sort. `setPage(0)` is called redundantly but harmlessly. Query fires correctly.

---

## ACF-REQ-006 — Lock release does not depend on user state

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Priority** | 6 |
| **Status** | Draft |

### Description

In both `useProductLock` and `useDisputeLock`, `releaseLock` captures `user?.id` from the `useAuthStore()` hook subscription via `useCallback`'s closure. The callback has `user?.id` in its dependency array, so when the session expires and user becomes `null`, `releaseLock` is recreated with `user?.id = undefined`. The guard `if (!user?.id || !productId) return;` then causes an early return — the unlock RPC is never called, leaking the lock server-side until the 10-minute TTL expires.

### Approach

Use a `useRef<string | null>` to cache the `admin_id` at lock acquisition time. When `acquireLock` succeeds, store `user.id` in the ref. `releaseLock` reads from the ref instead of from the reactive `user` state. This guarantees:
- The ref persists even after the auth store clears `user` on session expiry.
- `releaseLock` does not need `user?.id` in its dependency array — the ref is a stable object reference.
- The cleanup effect in `VerificationPage`/`DisputeDetailPage` can successfully release locks regardless of session state.

### Acceptance Criteria

1. `useProductLock` gains a `useRef<string | null>` to cache the admin ID (e.g. `adminIdRef`).
2. After a successful `acquireLock` call (when RPC returns `success: true`), set `adminIdRef.current = user.id`.
3. `releaseLock` reads `adminIdRef.current` instead of `user?.id` from the hook subscription.
4. `releaseLock`'s `useCallback` dependency array excludes `user?.id` — the ref object is a stable dependency.
5. `acquireLock` continues to use the reactive `user?.id` from the subscription (it's only called during explicit admin interaction).
6. `useDisputeLock` (inside `useDisputeActions.ts`) receives the same treatment.
7. `VerificationPage`'s cleanup effect (`useEffect` return that calls `releaseLock(selectedProduct.id)`) and `DisputeDetailPage`'s cleanup effect (`useEffect` return that calls `releaseLock(id)`) must both successfully release locks after session expiry.

### Files Affected

| File | Change |
|------|--------|
| `src/hooks/useProductLock.ts` | Decouple `releaseLock` from reactive `user?.id`; stabilize callback deps |
| `src/hooks/useDisputeActions.ts` | Same change for `releaseLock` inside `useDisputeLock` |

### Scenarios

**Happy Path**: Admin reviews a product, navigates away. `VerificationPage`'s cleanup fires `releaseLock`. Admin ID is available, unlock RPC succeeds.

**Edge Case**: Session expires while admin has a product open. Auth listener (ACF-REQ-001) sets `user` to null. Admin navigates away (or redirect happens). Cleanup fires `releaseLock`. With the fix, the admin ID (cached at lock time or read independently) is still available. Unlock RPC succeeds with the correct `admin_id`. No lock leak.

---

## ACF-REQ-007 — Lock re-check before verdict

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Priority** | 7 |
| **Status** | Draft |

### Description

In `usePendingProducts.ts`, `resolveMutation.mutationFn` updates the product status directly via `supabase.from('products').update()`. There is no check whether the current admin still holds the soft lock on that product. The lock could have expired (10-minute TTL) or been taken by another admin (e.g. via admin override). If expired, the mutation proceeds anyway — two admins could approve/reject the same product simultaneously.

### Acceptance Criteria

1. Before the `supabase.from('products').update()` call in `resolveMutation.mutationFn`, call the lock status RPC (`fn_lock_product` with `p_product_id` and `p_admin_id`) to verify the current admin still holds the lock.
2. If the RPC returns `success: false` (lock held by another admin or expired), THROW an error — do not proceed with the product update.
3. The thrown error message must be: `"Tu sesión de revisión expiró. Selecciona el producto nuevamente."`
4. The mutation's `onError` handler shows this message as a `toast.error()`.
5. If the lock check returns `success: true`, the mutation proceeds normally.
6. The lock check RPC call must have a short timeout (<5 seconds) to avoid blocking the verdict flow.

### Files Affected

| File | Change |
|------|--------|
| `src/hooks/usePendingProducts.ts` | Add lock status check RPC call before product update in `resolveMutation.mutationFn` |

### Scenarios

**Happy Path**: Admin holds the lock, clicks approve. Lock check RPC returns `success: true`. Mutation proceeds, product status updates to `VERIFIED`. Audit log and notification fire.

**Edge Case**: Admin holds the lock but the 10-minute TTL expired 2 minutes ago (another admin has since acquired it). Lock check RPC returns `success: false` with `current_locker_name`. Mutation throws with the expiry error toast. No product status change occurs. Admin must select the product again to re-acquire the lock.

---

## ACF-REQ-008 — KPI drilldown navigation

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Priority** | 8 |
| **Status** | Draft |

### Description

The dashboard stat cards are purely visual — clicking them does nothing. For operational KPIs, admins should navigate to the relevant management page with a single click. This turns the dashboard from a static view into a functional starting point.

### Acceptance Criteria

1. Add an optional `href` prop to `StatCard`: `href?: string`.
2. When `href` is provided, clicking the card calls `useNavigate()` from `react-router-dom` to navigate to that route.
3. When `href` is provided, the card cursor changes to `pointer` (`cursor-pointer`) on hover.
4. When `href` is NOT provided, the card behaves exactly as before — no navigation, default cursor.
5. On `DashboardHome`, wire these operational KPIs:
   - "Pendientes de Verificación" → `/verify`
   - "Disputas Activas" → `/disputes`
   - "Por Dispersar (Vendedores)" → `/payments` (placeholder page)
   - "Ventas del Mes" → no href (data-only metric, no dedicated page yet)
6. Strategic metric cards ("Usuarios Registrados", "Productos Verificados", "Total Productos") remain static (no href).

### Implementation Note

The `onClick` handler must use `useNavigate` inside the component body (StatCard body), not at the caller site. This avoids passing navigate callbacks as props.

### Files Affected

| File | Change |
|------|--------|
| `src/components/ui/StatCard.tsx` | Add optional `href` prop + click + cursor handling |
| `src/pages/DashboardHome.tsx` | Add `href` prop to operational StatCards |

### Scenarios

**Happy Path**: Admin clicks "Pendientes de Verificación" on the dashboard. Browser navigates to `/verify`. The metrics page renders.

**Edge Case**: Admin clicks "Ventas del Mes" stat card. No `href` is provided. Nothing happens (no cursor change, no navigation). The card remains purely visual.

---

## ACF-REQ-009 — Trend goals

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Priority** | 9 |
| **Status** | Draft |

### Description

KPI cards with trends show direction and percentage (e.g. "▲ 12%") but provide no context about whether that trend is good or bad relative to a goal. Adding an optional `goal` prop that renders a goal comparison in the trend line gives admins immediate, actionable context.

### ⚠️ Design Note — Prop Name

`StatCard` already has a `target` prop of type `{ current: number; max: number; label?: string }` — this is a progress bar (current/max). The new prop described here has a different shape and purpose. To avoid collision, we use `goal` as the prop name for trend targets. This is semantically distinct: `target` = progress bar fill, `goal` = trend comparison.

### Acceptance Criteria

1. Add an optional `goal` prop to `StatCard`: `{ value: number; label: string } | null`.
2. When `goal` is provided AND `trend` is also provided and `trend.direction` is not `'neutral'`:
   - Show the goal comparison text next to the trend percentage, e.g.: `"▲ 12%  goal: 15%"`
   - Color the comparison text green (`text-forest`) if the trend percentage is ≥ goal value (meeting/exceeding).
   - Color the comparison text red (`text-fire`) if the trend percentage is < goal value (below goal).
   - If `trend.direction` is `'down'` for a metric where lower is better (e.g. disputes, pending products), the comparison logic is inverted — meeting goal means trend ≤ goal value.
3. When `goal` is NOT provided (null/undefined), the trend displays exactly as before — no comparison text.
4. When `trend.direction` is `'neutral'`, no goal comparison text is shown (there's nothing to compare).
5. On `DashboardHome`, wire these goals:
   - "Pendientes de Verificación" → goal: `{ value: 0, label: "ideal: 0" }` (zero backlog)
   - "Disputas Activas" → goal: `{ value: 0, label: "ideal: 0" }` (zero active disputes)
   - "Ventas del Mes" → goal: `{ value: stats?.trends.monthlySales.percentage ?? 0, label: "vs mes ant." }` (maintain growth — goal equals previous period)

### Files Affected

| File | Change |
|------|--------|
| `src/components/ui/StatCard.tsx` | Add `goal` prop + rendering logic |
| `src/pages/DashboardHome.tsx` | Pass `goal` props to applicable StatCards |

### Scenarios

**Happy Path**: Disputes trend shows "▲ 5%" with goal `{ value: 0, label: "ideal: 0" }`. Since this is a metric where up is bad, and 5% > 0 (below goal), the comparison text is red: `"▲ 5%  goal: 0%"`.

**Edge Case**: "Por Dispersar" has no trend (currently doesn't pass `trend` prop) and no `goal` — the card renders exactly as before. No change.

---

## Non-functional Requirements

### Security

| ID | Requirement | Related Specs |
|----|------------|---------------|
| NFR-SEC-01 | The `onAuthStateChange` listener must NOT expose admin session tokens to console or toast messages | ACF-REQ-001 |
| NFR-SEC-02 | Lock release must use the same `admin_id` that was used during lock acquisition — never a different admin's ID | ACF-REQ-006 |
| NFR-SEC-03 | The lock re-check (ACF-REQ-007) must call the RPC with the service_role client or with sufficient RLS permissions to read lock status — verify the RPC is callable by the `authenticated` role | ACF-REQ-007 |

### Performance

| ID | Requirement | Related Specs |
|----|------------|---------------|
| NFR-PERF-01 | Lock re-check RPC must complete in <1 second; the mutation should not be perceptibly delayed | ACF-REQ-007 |
| NFR-PERF-02 | `onAuthStateChange` handler must not cause additional network requests (it only reacts to existing Supabase events) | ACF-REQ-001 |
| NFR-PERF-03 | Sort + page reset must not cause a double-fetch (the new `page=0` and new `sortBy` values should be applied in the same render cycle so TanStack Query deduplicates) | ACF-REQ-005 |

### Testing

| ID | Requirement | Related Specs |
|----|------------|---------------|
| NFR-TST-01 | Session expiry flow must be testable via local Supabase emulator: force token expiry, verify toast + redirect | ACF-REQ-001 |
| NFR-TST-02 | Lock release test: mock `supabase.rpc('fn_unlock_product')`, verify it is called even after store user is null | ACF-REQ-006 |
| NFR-TST-03 | Lock re-check test: mock lock RPC returns `success: false`, verify mutation throws and product status is NOT changed | ACF-REQ-007 |
| NFR-TST-04 | Sort/page test: render `UsersPage`, set page to 3, change sort, verify `setPage(0)` was called and query has correct range | ACF-REQ-005 |
| NFR-TST-05 | Error state tests: mock API failure, verify error banner renders and stat cards are hidden for DashboardHome; verify ErrorState renders for DisputesPage | ACF-REQ-003, ACF-REQ-004 |

---

## Out of Scope

The following are explicitly NOT included in this change:

- **Backend RPC changes**: No modifications to `fn_lock_product`, `fn_unlock_product`, `fn_lock_dispute`, `fn_unlock_dispute`, or any Edge Function.
- **Atomic audit+notification transactions**: The audit log and notification insertions remain fire-and-forget. A future change may wrap them in a single RPC for atomicity.
- **Retry logic for failed audit/notification**: Failed inserts are surfaced to the admin but not retried automatically.
- **DB-level cascade for lock cleanup**: Lock TTL (10 minutes) remains the server-side expiry mechanism. No trigger-based cleanup.
- **Version-based optimistic concurrency for products**: No `version` column or `updated_at` check on product updates — the lock re-check (ACF-REQ-007) is the only guard.
- **Actual payments page**: The `/payments` route remains a placeholder. ACF-REQ-008 wires navigation to it, but building the payments page is separate work.
- **Dispute detail page lock re-check**: Only the product verdict flow gets a lock pre-check (ACF-REQ-007). The dispute resolution flow (`useDisputeActions.resolveDispute`) is not modified.

---

## Interaction Matrix

### Dependency / Co-location Map

| Spec | File(s) | Conflicts With | Co-located With |
|------|---------|----------------|-----------------|
| ACF-REQ-001 | `App.tsx` | None | None (new code) |
| ACF-REQ-002 | `usePendingProducts.ts` | None | ACF-REQ-007 (same file, same mutation function) |
| ACF-REQ-003 | `DashboardHome.tsx` | None | ACF-REQ-008, ACF-REQ-009 (same file, same component) |
| ACF-REQ-004 | `DisputesPage.tsx`, `useActiveDisputes.ts` | None | None |
| ACF-REQ-005 | `UsersPage.tsx` | None | None |
| ACF-REQ-006 | `useProductLock.ts`, `useDisputeActions.ts` | None | None |
| ACF-REQ-007 | `usePendingProducts.ts` | None | ACF-REQ-002 (same file, same mutation function) |
| ACF-REQ-008 | `StatCard.tsx`, `DashboardHome.tsx` | None | ACF-REQ-003, ACF-REQ-009 (same component) |
| ACF-REQ-009 | `StatCard.tsx`, `DashboardHome.tsx` | None (resolved: trend prop renamed to `goal` to avoid collision with existing `target` progress bar prop) | ACF-REQ-003, ACF-REQ-008 (same component) |

### Conflict Details

**ACF-REQ-009 `target` prop name collision (RESOLVED)**: `StatCard` already defines a `target` prop for the progress bar. The new trend-tracking prop uses the name `goal` instead, avoiding collision. No structural change needed.

**ACF-REQ-002 + ACF-REQ-007 (same file, same function)**: Both modify `resolveMutation.mutationFn` in `usePendingProducts.ts`. ACF-REQ-002 replaces empty error blocks with explicit handlers. ACF-REQ-007 adds a lock-check RPC call before the product update. These must be applied in the same edit session to avoid merge conflicts.

**ACF-REQ-003 + ACF-REQ-008 + ACF-REQ-009 (same file/component)**: All three modify `DashboardHome.tsx` and/or `StatCard.tsx`. ACF-REQ-003 adds error-state guards, ACF-REQ-008 wires href navigation, ACF-REQ-009 wires trend targets. These touch different parts of the same JSX and can be applied independently as long as the prop name collision (ACF-REQ-009) is resolved first.

### Ordering Recommendations

1. **ACF-REQ-009 + ACF-REQ-008 + ACF-REQ-003** together (StatCard and DashboardHome changes — prop collision resolved via `goal`, edits touch different JSX sections and can be applied in one pass)
2. **ACF-REQ-006** (lock release stability — foundational for ACF-REQ-001)
3. **ACF-REQ-001** (session handler — depends on stable lock release from step 2)
4. **ACF-REQ-005** (simple sort handler change)
5. **ACF-REQ-004** (DisputesPage error state)
6. **ACF-REQ-002 + ACF-REQ-007 together** (same mutation function in usePendingProducts.ts — apply in one pass to avoid conflict)
