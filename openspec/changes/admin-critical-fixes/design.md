# Design: Admin Critical Fixes

**Change**: `admin-critical-fixes`
**File**: `openspec/changes/admin-critical-fixes/design.md`
**Date**: 2026-05-28
**Based on**: Proposal (`proposal.md`) + Specs (`specs.md`)

---

## 1. Technical Approach

---

### ACF-REQ-001 — Session expiry handler

| Field | Detail |
|---|---|
| **Architecture** | New `useEffect` in `App.tsx` (component mount) |
| **Type** | Infrastructure — global auth lifecycle |
| **File** | `src/App.tsx` |

#### Key Implementation Details

**1. Listener placement** — The `useEffect` that calls `initialize()` already exists in `App.tsx` (lines 26-28). The `onAuthStateChange` subscription lives in a **separate** `useEffect` to keep concerns isolated:

```typescript
// App.tsx
const navigate = useNavigate();  // App is inside BrowserRouter, so this works

useEffect(() => {
  initialize();
}, []);

useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    // Guard: INITIAL_SESSION is handled by initialize() above
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

**2. Why `useNavigate()` works here** — `App.tsx` renders `<BrowserRouter>` wrapping the entire route tree. `useNavigate()` requires a `<RouterContext>` provider, which `BrowserRouter` provides. Since `App` is a child of `BrowserRouter` (it renders inside it), the hook is valid. If the import order creates issues, the `navigate` reference is wrapped in `useCallback` or kept stable via the effect dependency array.

**3. INITIAL_SESSION guard** — `onAuthStateChange` fires `INITIAL_SESSION` immediately on subscription with the current session. The existing `initialize()` in the first `useEffect` already handles session restore via `supabase.auth.getSession()`. Without the guard, `INITIAL_SESSION` with a null session would incorrectly trigger a redirect before `initialize()` finishes.

**4. Static store access** — Uses `useAuthStore.getState().setUser(null, null)` instead of subscribing to the store. The listener fires outside React's render cycle, so direct store mutation via `getState()` avoids stale closure issues.

#### Data Flow

```
App.tsx mount
├── useEffect #1: initialize() → getSession → setUser(session.user, profile)
│                                       └── INITIAL_SESSION fires here
└── useEffect #2: onAuthStateChange listener
    ├── INITIAL_SESSION → IGNORE (duplicate of initialize)
    ├── SIGNED_OUT → setUser(null, null) → toast → navigate('/login')
    └── TOKEN_REFRESHED(null) → setUser(null, null) → toast → navigate('/login')
```

#### Error Handling

- Listener itself cannot fail (it reacts to Supabase SDK events)
- If `setUser` or `navigate` throws, the error is a React crash that would surface in the console
- The effect cleanup unsubscribes on unmount, preventing memory leaks

#### Edge Cases

- Multiple SIGNED_OUT events: handler is idempotent (`setUser(null, null)` is safe to call twice)
- Admin is on login page when session expires: `navigate('/login')` is a no-op (already there)
- Rapid session expiry during verdict submission: 401 from `products.update()` fires first (ACF-REQ-002's `onError`), then the auth handler redirects (both toasts visible)
- Lock cleanup (ACF-REQ-006) runs in React's commit phase before the redirect — guaranteed by React's effect cleanup ordering

---

### ACF-REQ-002 — Audit trail and notification errors surfaced

| Field | Detail |
|---|---|
| **Architecture** | Hook modification — replace empty error blocks |
| **Type** | Error handling |
| **File** | `src/hooks/usePendingProducts.ts` |

#### Key Implementation Details

Replace the two empty `if` blocks inside `resolveMutation.mutationFn` (lines 127-129 and 163-165):

```typescript
// Before (line 127-129):
if (logError) {
  // Audit log insertion was non-critical; product already updated
}

// After:
if (logError) {
  console.error('Error registrando auditoría:', logError);
  toast.warning('Audit log no registrado. Contacta a soporte.');
}
```

Same pattern for the notification error block (line 163-165):

```typescript
if (notifError) {
  console.error('Error notificando al vendedor:', notifError);
  toast.warning('Notificación no enviada al vendedor.');
}
```

**Critical ordering**: The mutation `onSuccess` callback (line 167-170) fires AFTER `mutationFn` resolves. The warning toasts are additive — they do not prevent `onSuccess` from executing. Flow:

1. Product `update()` runs — if this fails, `onError` fires, flow stops
2. Audit `insert()` runs — error logged but execution continues
3. Notification `insert()` runs — error logged but execution continues
4. `onSuccess` fires — `toast.success('Veredicto enviado correctamente')` + query invalidation

If BOTH audit and notification fail, three toasts appear: two warnings + one success. This matches spec AC-3 ("warnings must NOT block the success flow").

#### Error Handling

- No new error paths introduced — errors are surfaced, not swallowed
- Console errors include the full error object for debugging
- Mutation `onError` still handles product-update failures separately

#### Edge Cases

- `logError` and `notifError` are Supabase `PostgrestError` objects — `console.error` prints the full object
- If `user?.id` is already null when audit log tries to insert (session just expired), the FK violation surfaces here — the warning toast is correct
- `toast.warning` uses `sonner`'s queuing mechanism — multiple warnings stack correctly

---

### ACF-REQ-003 — Dashboard error state hides data

| Field | Detail |
|---|---|
| **Architecture** | Page modification — conditional render guards |
| **Type** | Error handling + UI |
| **File** | `src/pages/DashboardHome.tsx` |

#### Key Implementation Details

The page already destructures `isError` (line 18). Three sections need guards:

```typescript
// Already at top of component:
const { data: stats, isLoading, isError, refetch } = useAdminStats();

// Error banner — ALREADY EXISTS (lines 27-40), no change needed

// 1. Operational KPIs grid (line 43): wrap in !isError
{!isError && (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
    <StatCard ... />
    <StatCard ... />
    <StatCard ... />
    <StatCard ... />
  </div>
)}

// 2. Strategic Metrics section (line 78): wrap in !isError
{!isError && (
  <div>
    <h3 className="text-lg font-bold text-platinum mb-4">Métricas Estratégicas</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ...
    </div>
  </div>
)}

// 3. Activity & Chart section (line 106): wrap in !isError
{!isError && (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    ...
  </div>
)}
```

**No stat card grid renders when `isError` is true**. The existing error banner (already rendering) is the only visible content in the main area. Skeletons (when `isLoading && !isError`) are unaffected — they only render when the query is loading, not when it's errored.

#### Data Flow

```
useAdminStats()
├── isLoading=true, isError=false → render skeletons (no change)
├── isError=true → render error banner ONLY, no stat grids
└── isError=false, data populated → render full dashboard (no change)
    └── refetch() success → isError=false → cards reappear
```

#### Error Handling

- Error banner already exists with "Reintentar" button wired to `refetch()`
- After successful retry, `isError` flips to false and all sections reappear

#### Edge Cases

- Transition from error → success: all three sections remount simultaneously (React batches the update)
- Transition from error → loading: `isLoading` becomes true, `isError` becomes false — skeletons render (correct)
- Empty data (`stats` is undefined but API succeeded with no content): not an error state, stat cards show `?? 0` fallback (existing behavior, unchanged)

---

### ACF-REQ-004 — DisputesPage error state

| Field | Detail |
|---|---|
| **Architecture** | Page modification — destructure + conditional render |
| **Type** | Error handling + UI |
| **File** | `src/pages/DisputesPage.tsx` |

#### Key Implementation Details

**Current destructure** (line 14):
```typescript
const { data: disputes, isLoading } = useActiveDisputes(filter, debouncedSearch, sortBy);
```

**New destructure**:
```typescript
const { data: disputes, isLoading, isError, refetch } = useActiveDisputes(
  filter, debouncedSearch, sortBy,
);
```

**Error state insertion** — between the header section (lines 22-36) and the filter tabs (line 39):

```typescript
{/* ERROR STATE BANNER */}
{isError && (
  <ErrorState onRetry={() => refetch()} />
)}

{/* TABS DE FILTRADO */}
<div className="flex gap-2 p-1 bg-white/5 w-fit rounded-xl border border-white/5">
```

The `ErrorState` component (already exists at `src/components/ui/ErrorState.tsx`) renders a centered card with "Error de Conexión" title, message, and "Reintentar Carga" button calling `refetch()`.

**Why `useActiveDisputes` needs NO changes**: `useQuery` from TanStack Query already returns `isError` and `refetch`. The hook's return object doesn't explicitly destructure these, but they're available through the spread from `useQuery()`. In fact, looking at the hook's return — it returns `useQuery({...})` directly. `useQuery` returns an object with `isError` and `refetch` as properties. So the hook already exposes them implicitly. No hook changes needed — consistent with the spec.

#### Data Flow

```
DisputesPage mount
├── isError=false → render filter tabs, search, table (current behavior)
├── isError=true → render heading + Casos en Pantalla stat + ErrorState banner
│   └── user clicks retry → refetch() fires
│       ├── success → isError=false, ErrorState disappears, table renders
│       └── fail → isError stays true, ErrorState remains
└── filter/search/sort change → new query → isError resets
```

#### Error Handling

- `ErrorState` component handles its own rendering (centered card, retry button)
- Retry calls `refetch()` which re-runs the full query function

#### Edge Cases

- API fails on initial load: heading + Casos en Pantalla (showing 0) + ErrorState visible
- API fails after successful load: ErrorState appears BETWEEN heading and filter tabs, existing table data is replaced by empty state (query returns undefined)
- Secondary error (error after retry also fails): ErrorState remains, user can retry infinitely
- Filter/sort change during error: the query refires with new params, `isError` resets to false (optimistic), then becomes true again if the new query also fails

---

### ACF-REQ-005 — Sort resets pagination on UsersPage

| Field | Detail |
|---|---|
| **Architecture** | Page modification — single line addition |
| **Type** | Bug fix |
| **File** | `src/pages/UsersPage.tsx` |

#### Key Implementation Details

**Current sort handler** (lines 104-106):
```typescript
<select
  value={sortBy}
  onChange={(e) => setSortBy(e.target.value)}
```

**New handler**:
```typescript
<select
  value={sortBy}
  onChange={(e) => {
    setSortBy(e.target.value);
    setPage(0);
  }}
```

**Why this works**: Both `setSortBy` and `setPage` are React state setters. When called in the same synchronous event handler, React batches them into a single render cycle. TanStack Query sees both state changes in the same render (because `sortBy` and `page` are both in the `useUsers` queryKey via `debouncedSearch, page, statusFilter, sortBy`) and deduplicates into a single query with the correct parameters. This satisfies NFR-PERF-03.

#### Pattern consistency

| Trigger | Page reset? | Current behavior |
|---|---|---|
| Search change (line 68-71) | ✅ `setPage(0)` | Correct |
| Status filter tab click (line 87-90) | ✅ `setPage(0)` | Correct |
| Sort change (line 104-106) | ❌ Missing | BUG — this fix |
| Pagination buttons (line 172-185) | N/A (intentional page navigation) | Correct |

#### Edge Cases

- Admin on page 0, changes sort: `setPage(0)` is redundant but harmless (no-op)
- Admin on page 3, sort changes: page → 0, query fires with `sortBy='balance'`, `page=0`, `start=0, end=19` (assuming 20 per page)
- Rapid sort changes: each change creates a new render with `page=0`, only the last sort value survives (React state batching)
- On error, sort still resets page — the `isError` state at line 29-34 doesn't prevent the handler from working

---

### ACF-REQ-006 — Lock release does not depend on user state

| Field | Detail |
|---|---|
| **Architecture** | Hook modification — useRef caching pattern |
| **Type** | Bug fix — data race / stale closure |
| **Files** | `src/hooks/useProductLock.ts`, `src/hooks/useDisputeActions.ts` |

#### Key Implementation Details

**Core insight**: `releaseLock` currently captures `user?.id` through `useCallback` deps. When session expires and `user` becomes `null`, the callback recreates with `user?.id = undefined`, causing `if (!user?.id || !productId) return;` to early-return — the unlock RPC never fires, leaking the lock for 10 minutes.

**Fix — useRef caching**:

```typescript
// useProductLock.ts
const { user } = useAuthStore();
const adminIdRef = useRef<string | null>(null);

const acquireLock = useCallback(async (productId: string): Promise<boolean> => {
  if (!user?.id || !productId) return false;
  setIsLocking(true);
  try {
    const { data, error } = await supabase.rpc('fn_lock_product', {
      p_product_id: productId,
      p_admin_id: user.id,
    });
    if (error) throw error;
    const result = data[0];
    if (result.success) {
      // ★ KEY: Cache the admin ID when lock is acquired
      adminIdRef.current = user.id;
      setLockStatus({ isLockedByOther: false, lockerName: null, lockedSince: null });
      return true;
    } else {
      setLockStatus({ ... });
      toast.warning(...);
      return false;
    }
  } catch (err) {
    ...
  } finally {
    setIsLocking(false);
  }
}, [user?.id]); // acquireLock still depends on user — only called during interaction

const releaseLock = useCallback(async (productId: string) => {
  // ★ KEY: Read from ref, NOT from reactive user
  if (!adminIdRef.current || !productId) return;
  try {
    await supabase.rpc('fn_unlock_product', {
      p_product_id: productId,
      p_admin_id: adminIdRef.current,
    });
    setLockStatus({ isLockedByOther: false, lockerName: null, lockedSince: null });
    adminIdRef.current = null; // clear ref after release
  } catch {
    // Lock release failed silently — lock will expire after 10 min
  }
}, []); // ★ KEY: empty deps — ref is stable, no reactive deps
```

**Identical pattern for `useDisputeLock`** in `useDisputeActions.ts`:
- Add `adminIdRef = useRef<string | null>(null)`
- After successful `acquireLock`: `adminIdRef.current = user.id`
- `releaseLock`: reads `adminIdRef.current`, deps `[]`
- After unlock: `adminIdRef.current = null`

#### Why useRef works

- `useRef` returns a stable object `{ current: null }` for the component's lifetime
- The ref's `.current` property is mutable — it survives re-renders and state changes
- Setting `adminIdRef.current = user.id` writes to the same object that `releaseLock` reads from
- When `useAuthStore` clears `user` (session expiry), `adminIdRef.current` still holds the admin ID
- The ref is cleared after successful unlock to prevent stale data

#### Data Flow

```
VerificationPage mount
├── const { acquireLock, releaseLock } = useProductLock()
│   ├── adminIdRef created → { current: null }
│   └── releaseLock callback has [] deps (stable reference)
├── admin clicks product → acquireLock(id)
│   ├── user?.id from reactive store → supabase.rpc('fn_lock_product', { p_admin_id: user.id })
│   ├── success → adminIdRef.current = user.id
│   └── returns true
├── ... admin reviews ...
├── SESSION EXPIRES (ACF-REQ-001)
│   └── useAuthStore user → null
│       BUT adminIdRef.current still has the admin ID
├── VerificationPage unmounts (or redirect)
│   └── useEffect cleanup fires releaseLock(selectedProduct.id)
│       ├── reads adminIdRef.current (NOT user?.id) → has value
│       ├── supabase.rpc('fn_unlock_product', { p_admin_id: adminIdRef.current })
│       └── success → adminIdRef.current = null
└── Lock released correctly
```

#### Error Handling

- `releaseLock` catch is intentionally silent (lock auto-expires in 10 min)
- If `adminIdRef.current` is null when `releaseLock` is called (e.g., lock never acquired), early return is correct

#### Edge Cases

- acquireLock fails (lock held by another admin): `adminIdRef.current` is NOT set — releaseLock will correctly early-return
- Session expires AFTER releaseLock: ref is cleared, no issue
- Component unmounts before acquireLock resolves: effect cleanup fires, `adminIdRef.current` is null — early return, no RPC call (correct — lock was never acquired)
- Multiple acquire/release cycles on the same page: ref is overwritten on each acquire, cleared on each release

---

### ACF-REQ-007 — Lock re-check before verdict

| Field | Detail |
|---|---|
| **Architecture** | Hook modification — add RPC call before mutation |
| **Type** | Race condition fix |
| **File** | `src/hooks/usePendingProducts.ts` |

#### Key Implementation Details

**Add lock check at the TOP of `resolveMutation.mutationFn`**, before the product update:

```typescript
mutationFn: async ({ id, verdict, note, product }) => {
  const { user } = useAuthStore.getState();

  // ★ LOCK RE-CHECK: verify lock is still held
  const { data: lockData, error: lockError } = await supabase.rpc('fn_lock_product', {
    p_product_id: id,
    p_admin_id: user?.id,
  });

  if (lockError) throw lockError;
  const lockResult = lockData[0];
  if (!lockResult.success) {
    throw new Error('Tu sesión de revisión expiró. Selecciona el producto nuevamente.');
  }

  // Proceed with product update (existing code)
  const isRejection = verdict === 'REJECT';
  const { error: prodError } = await supabase.from('products').update({ ... }).eq('id', id);
  ...
}
```

**Why `fn_lock_product` for re-check**: The same RPC is used to acquire and verify the lock. When called with an `admin_id` that already holds the lock, it returns `success: true` (idempotent). When the lock is expired or held by another admin, it returns `success: false` with the current locker's name. This means no backend changes are needed.

**Timeout behavior**: The RPC call completes in <50ms on average (indexed primary key lookup). No explicit timeout is needed — the Supabase client's default timeout (~30s) is acceptable because:
- On success: fast return, mutation proceeds
- On failure (timeout): Supabase throws, `lockError` catch block fires `onError` with the connection error message
NFR-PERF-01 is satisfied without explicit timeout configuration.

#### Data Flow

```
Admin clicks "Approve"/"Reject"
└── resolveMutation.mutateAsync({ id, verdict, note, product })
    ├── RPC: fn_lock_product(p_product_id=id, p_admin_id=user.id)
    │   ├── success: true → continue
    │   └── success: false → THROW → onError shows toast
    ├── products.update({ status: 'VERIFIED'|'REJECTED' })
    │   └── fail? → THROW → onError
    ├── admin_audit_logs.insert() (fire-and-forget, error → warning toast)
    ├── notifications.insert() (fire-and-forget, error → warning toast)
    └── onSuccess → toast.success + query invalidation
```

#### Error Handling

- Lock check fails (RPC error): thrown → caught by `onError` → `toast.error("Error: ...")` with the RPC error message
- Lock not held (success=false): thrown with custom message → `toast.error("Error: Tu sesión de revisión expiró. Selecciona el producto nuevamente.")`
- Product update fails (existing behavior): thrown → `onError` with Supabase error

#### Edge Cases

- Admin holds lock, RPC succeeds, but session expires BETWEEN lock check and product update: the product update returns 401 → `onError` fires with connection error. The lock re-check can't prevent 401s in this window, but the server-side RLS still rejects the write — no data corruption
- Lock TTL expires during review: re-check catches this and throws, admin must re-select the product
- Another admin takes the lock (admin override): re-check catches this, current admin gets the toast
- User is null (session already expired when verdict is clicked): `user?.id` is undefined, `fn_lock_product` with undefined admin_id returns an RPC error, caught by `if (lockError) throw lockError` → onError

---

### ACF-REQ-008 — KPI drilldown navigation

| Field | Detail |
|---|---|
| **Architecture** | Component modification + page wiring |
| **Type** | Feature — navigation |
| **Files** | `src/components/ui/StatCard.tsx`, `src/pages/DashboardHome.tsx` |

#### Key Implementation Details

**StatCard.tsx — Add `href` prop + click handler**:

```typescript
// In the Props interface, add:
href?: string;

// In the component body, import useNavigate:
const navigate = useNavigate();

// Add to the outer div:
<div
  className={`... ${href ? 'cursor-pointer' : ''}`}
  onClick={href ? () => navigate(href) : undefined}
  role={href ? 'button' : undefined}
  tabIndex={href ? 0 : undefined}
  onKeyDown={href ? (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(href);
    }
  } : undefined}
>
```

**Why `useNavigate` inside StatCard**: The spec says "The onClick handler must use `useNavigate` inside the component body, not at the caller site." This keeps the StatCard self-contained and avoids passing navigation callbacks as props. The component is already used in a router context (it's rendered inside DashboardHome which is inside ProtectedRoute inside BrowserRouter), so `useNavigate()` works.

**Accessibility considerations**: The `role="button"` and keyboard handler make the card keyboard-accessible. Tab focus shows the card can be activated, and Enter/Space trigger navigation. This is consistent with WCAG 2.1 guidelines for non-interactive elements that become interactive.

**DashboardHome.tsx — Wire operational KPIs**:

```typescript
<StatCard
  title="Pendientes de Verificación"
  value={stats?.pendingProducts ?? 0}
  icon={ShieldCheck}
  color="text-lion"
  isLoading={isLoading}
  trend={stats?.trends.pendingProducts ?? null}
  href="/verify"          // ← NEW
/>

<StatCard
  title="Disputas Activas"
  value={stats?.activeDisputes ?? 0}
  icon={Gavel}
  color="text-fire"
  isLoading={isLoading}
  trend={stats?.trends.activeDisputes ?? null}
  href="/disputes"        // ← NEW
/>

<StatCard
  title="Por Dispersar (Vendedores)"
  value={formatCurrency(stats?.totalToPay ?? 0)}
  icon={Wallet}
  color="text-forest"
  isLoading={isLoading}
  href="/payments"        // ← NEW (placeholder page)
/>

<StatCard
  title="Ventas del Mes"
  value={stats?.monthlySalesCount ?? 0}
  icon={TrendingUp}
  color="text-blue-light"
  isLoading={isLoading}
  trend={stats?.trends.monthlySales ?? null}
  // No href — data-only metric
/>
```

Strategic metric cards (Usuarios Registrados, Productos Verificados, Total Productos) get no `href` — they remain static.

#### Edge Cases

- `href` is undefined/null: no cursor change, no click handler, no keyboard handler — identical to current behavior
- Click while loading (`isLoading=true`): the card shows a skeleton, but the click handler still fires. `navigate('/verify')` is harmless during loading
- Admin navigates away from dashboard while a verdict is in progress: the effect cleanup on VerificationPage handles lock release (ACF-REQ-006)

---

### ACF-REQ-009 — Trend goals

| Field | Detail |
|---|---|
| **Architecture** | Component modification + page wiring |
| **Type** | Feature — data visualization |
| **Files** | `src/components/ui/StatCard.tsx`, `src/pages/DashboardHome.tsx` |

#### ⚠️ Critical: Prop name collision (RESOLVED)

`StatCard` already has a `target` prop for the progress bar (`{ current: number; max: number; label?: string }`). The new trend comparison prop uses the name `goal` to avoid collision. This is the resolve from the specs.

#### Key Implementation Details

**StatCard.tsx — Add `goal` prop + rendering**:

```typescript
// In Props interface:
goal?: {
  value: number;
  label: string;
} | null;

// New component or inline rendering — after the TrendBadge section (line 138-142):
{!isLoading && trend && goal && trend.direction !== 'neutral' && (() => {
  const isLowerBetter = goal.value === 0 && ['Pendientes de Verificación', 'Disputas Activas', 'Disputas'].some(
    kw => title.includes(kw)
  ) || false; // heuristic — can also be explicit via a field
  const trendGood = trend.direction === 'up';
  const goalMet = isLowerBetter
    ? trend.direction === 'down'
    : trendGood && trend.percentage >= goal.value;

  return (
    <span className={`text-xs font-semibold ml-2 ${
      goalMet ? 'text-forest' : 'text-fire'
    }`}>
      goal: {goal.value}%
    </span>
  );
})()}
```

**Wait — refined approach**. The "lower is better" determination can't be heuristic (title matching is fragile). Instead, we extend the goal interface or pass the information differently.

**Better approach**: Since the spec defines `goal` as `{ value: number; label: string } | null`, and the caller (DashboardHome) knows which metrics are lower-is-better, we can:

1. Keep the goal interface as specified
2. Pass lower-is-better as a separate boolean, OR
3. Infer from context: metrics with goal=0 for pending/disputes are always lower-is-better

**Recommended**: Add an optional `invertGoal` (or `lowerIsBetter`) to the goal interface. This is a practical necessity — without it, the StatCard cannot correctly color pending and disputes goals:

```typescript
goal?: {
  value: number;
  label: string;
  lowerIsBetter?: boolean;  // true for metrics where down = good
} | null;
```

**Goal comparison rendering logic**:

```typescript
{!isLoading && trend && goal && trend.direction !== 'neutral' && (
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

**Color logic explained**:

| Metric | Direction | lowerIsBetter | Condition | Color |
|---|---|---|---|---|
| Sales ↑ 15%, goal=12% | up | false | 15 >= 12 ✅ | green |
| Sales ↑ 8%, goal=12% | up | false | 8 >= 12 ❌ | red |
| Sales ↓ 5%, goal=12% | down | false | Not 'up' direction | red |
| Disputes ↑ 5%, goal=0 | up | true | Not 'down' direction | red |
| Disputes ↓ 5%, goal=0 | down | true | direction='down' ✅ | green |

**DashboardHome.tsx — Wire goals**:

```typescript
<StatCard
  title="Pendientes de Verificación"
  ...
  trend={stats?.trends.pendingProducts ?? null}
  href="/verify"
  goal={{ value: 0, label: 'ideal: 0', lowerIsBetter: true }}      // ← NEW
/>

<StatCard
  title="Disputas Activas"
  ...
  trend={stats?.trends.activeDisputes ?? null}
  href="/disputes"
  goal={{ value: 0, label: 'ideal: 0', lowerIsBetter: true }}      // ← NEW
/>

<StatCard
  title="Ventas del Mes"
  ...
  trend={stats?.trends.monthlySales ?? null}
  goal={{
    value: stats?.trends.monthlySales?.percentage ?? 0,
    label: 'vs mes ant.',
    lowerIsBetter: false,                                           // ← NEW
  }}
/>
```

#### Edge Cases

- No trend + goal: no goal rendering (trend is null check happens first)
- Neutral trend + goal: no goal rendering (`trend.direction !== 'neutral'` guard)
- Goal with value=0 for higher-is-better metric: percentage >= 0 always true — shown as green (correct: maintaining positive growth)
- Goal but no trend: no rendering
- `stats?.trends.monthlySales?.percentage` is 0 (exactly the same as previous month): `0 >= 0` → true → green (correct: maintaining)
- `stats?.trends.monthlySales` is null: goal is `{ value: 0, ... }` but trend is null so nothing renders
- The `<TrendBadge>` component (lines 39-53) uses different arrow symbols (↑↓→) — the goal comparison text renders separately after it, not inside it

---

## 2. Key Design Decisions

### Decision 1: `onAuthStateChange` in App.tsx vs. singleton service

- **Chosen**: `useEffect` in `App.tsx` with `useNavigate`
- **Rejected**: Separate auth service singleton
- **Rationale**: `App.tsx` is the root component that mounts once and lives for the entire session. The listener's cleanup runs on unmount. A singleton service would require passing `navigate` as a dependency or importing a navigation utility. Keeping it co-located in the component that owns the router is simpler and more predictable.

### Decision 2: `useAuthStore.getState().setUser(null, null)` vs. store subscription

- **Chosen**: Direct static store access (`getState()`)
- **Rationale**: The listener fires outside React's render cycle (it's a Supabase SDK callback). Subscribing to the store via `useAuthStore()` inside the effect would require managing subscription cleanup. `getState()` reads the store directly without creating a subscription, which is the correct pattern for imperative callbacks.

### Decision 3: useRef for admin ID caching (ACF-REQ-006)

- **Chosen**: `useRef<string | null>` per lock hook
- **Rejected**: Reading from `useAuthStore.getState()` inline in `releaseLock`
- **Rationale**: `getState()` reads the current store state at call time. If `releaseLock` fires after `setUser(null)` has already cleared the auth store (ACF-REQ-001 fires before the cleanup), `getState().user?.id` would also be null. The ref approach stores the exact admin ID that was used during `acquireLock`, guaranteeing the same ID is used for release. This is the **key insight** — the ref survives session clearance.

### Decision 4: `fn_lock_product` for re-check vs. separate RPC (ACF-REQ-007)

- **Chosen**: Reuse `fn_lock_product` with the same admin_id
- **Rejected**: New `fn_check_lock_status` RPC
- **Rationale**: `fn_lock_product` is already idempotent for the current locker — calling it with the same admin_id returns `success: true`. No backend changes needed. The RPC is cheap (<50ms indexed lookup). NFR-PERF-01 satisfied.

### Decision 5: `goal` prop name (ACF-REQ-009)

- **Chosen**: `goal` with optional `lowerIsBetter` field
- **Rejected**: `target` (already used for progress bar), separate prop for inversion flag
- **Rationale**: `target` has a different shape and purpose (progress bar). `goal` is semantically distinct. Adding `lowerIsBetter` to the goal interface is a practical necessity — without it, the StatCard can't correctly color lower-is-better metrics. The spec defines the minimum interface; extending with `lowerIsBetter` is backward-compatible.

### Decision 6: Error state as banner vs. full-page (DisputesPage)

- **Chosen**: Banner between heading and content
- **Rejected**: Full-page replacement (like UsersPage does)
- **Rationale**: The spec explicitly requires the heading and "Casos en Pantalla" stat to remain visible (AC-5). This matches the UsersPage pattern for consistency but applies it as a banner rather than a full replacement because the disputes page has more persistent UI elements (filter tabs, search).

---

## 3. Data Flow Diagrams

### Auth Session Flow

```
App.tsx mount
├── useEffect #1: initialize()
│   ├── supabase.auth.getSession()
│   ├── session? → fetch profile → setUser(user, profile)
│   └── no session → setUser(null, null)
│   └── initialized = true
│
└── useEffect #2: onAuthStateChange(subscription)
    ├── INITIAL_SESSION ← ignore (handled by initialize)
    ├── SIGNED_OUT
    │   ├── useAuthStore.getState().setUser(null, null)
    │   ├── toast.warning("Sesión expirada...")
    │   └── navigate("/login")
    ├── TOKEN_REFRESHED(session=null)
    │   └── Same as SIGNED_OUT
    └── TOKEN_REFRESHED(session)
        └── New token acquired silently (no action needed)
```

### Lock Release Flow (useRef pattern)

```
VerificationPage mount
├── useProductLock()
│   ├── adminIdRef = useRef(null)
│   └── releaseLock (useCallback, deps=[])
│       └── reads adminIdRef.current (stable object, never recreated)
│
├── handleSelectProduct(id)
│   └── acquireLock
│       ├── supabase.rpc('fn_lock_product', { p_admin_id: user.id })
│       └── success → adminIdRef.current = user.id
│
├── ... review ...
│
├── Session expires (ACF-REQ-001)
│   └── useAuthStore.user → null
│       BUT adminIdRef.current persists
│
└── Component unmount or redirect
    └── useEffect cleanup: releaseLock(id)
        ├── adminIdRef.current !== null → proceed
        ├── supabase.rpc('fn_unlock_product', { p_admin_id: adminIdRef.current })
        └── adminIdRef.current = null
```

### Verdict Flow (with lock re-check)

```
Admin clicks "Approve"
└── resolveMutation.mutateAsync({ id, verdict:'APPROVE', note, product })
    │
    ├── 1. LOCK RE-CHECK
    │   └── supabase.rpc('fn_lock_product', { p_product_id: id, p_admin_id: user?.id })
    │       ├── success=false → throw Error("Tu sesión...") → onError → toast
    │       └── success=true → continue
    │
    ├── 2. PRODUCT UPDATE
    │   └── supabase.from('products').update({ status:'VERIFIED', ... }).eq('id', id)
    │       └── fail? → throw → onError → toast
    │
    ├── 3. AUDIT LOG (fire-and-forget)
    │   └── supabase.from('admin_audit_logs').insert({ ... })
    │       └── error? → console.error + toast.warning (ACF-REQ-002)
    │
    ├── 4. NOTIFICATION (fire-and-forget)
    │   └── supabase.from('notifications').insert({ ... })
    │       └── error? → console.error + toast.warning (ACF-REQ-002)
    │
    └── 5. onSuccess
        ├── queryClient.invalidateQueries(['pending-products'])
        ├── queryClient.invalidateQueries(['admin-stats'])
        └── toast.success("Veredicto enviado correctamente")
```

### Dashboard Error State Flow

```
useAdminStats()
│
├── isLoading=true, isError=false → render skeletons (all sections visible)
├── isLoading=false, isError=true
│   ├── error banner visible (existing)
│   ├── operational KPI grid: HIDDEN (!isError guard)
│   ├── strategic metrics: HIDDEN (!isError guard)
│   └── activity summary: HIDDEN (!isError guard)
│
├── user clicks "Reintentar"
│   └── refetch() → isLoading=true, isError=false
│       ├── success → data populated → all sections render
│       └── fail → isLoading=false, isError=true → error banner only
│
└── isLoading=false, isError=false → full dashboard (no change)
```

---

## 4. Component/Hook Changes

| Spec | File | Type | Change Summary |
|------|------|------|----------------|
| ACF-REQ-001 | `src/App.tsx` | Hook | Add `useEffect` with `onAuthStateChange` subscription, guard `INITIAL_SESSION`, handle `SIGNED_OUT`/`TOKEN_REFRESHED(null)` with `setUser(null)`, toast, `navigate('/login')` |
| ACF-REQ-002 | `src/hooks/usePendingProducts.ts` | Hook | Replace empty `if (logError) { }` with `console.error` + `toast.warning`. Same for `notifError` |
| ACF-REQ-003 | `src/pages/DashboardHome.tsx` | Page | Wrap operational KPI grid, strategic metrics section, and activity summary in `{!isError && (...)}` |
| ACF-REQ-004 | `src/pages/DisputesPage.tsx` | Page | Destructure `isError`/`refetch`, render `<ErrorState onRetry={() => refetch()} />` between heading and filter tabs |
| ACF-REQ-005 | `src/pages/UsersPage.tsx` | Page | Add `setPage(0)` in sort `<select onChange>` handler alongside `setSortBy` |
| ACF-REQ-006 | `src/hooks/useProductLock.ts` | Hook | Add `adminIdRef = useRef<string | null>(null)`. `acquireLock` sets `adminIdRef.current = user.id` on success. `releaseLock` reads `adminIdRef.current`, deps `[]` |
| ACF-REQ-006 | `src/hooks/useDisputeActions.ts` | Hook | Same `useRef` pattern for `useDisputeLock.releaseLock` |
| ACF-REQ-007 | `src/hooks/usePendingProducts.ts` | Hook | In `resolveMutation.mutationFn`, add `fn_lock_product` RPC call with the same params; throw if `success: false` |
| ACF-REQ-008 | `src/components/ui/StatCard.tsx` | Component | Add optional `href` prop, `useNavigate()`, `cursor-pointer` class, keyboard handler |
| ACF-REQ-008 | `src/pages/DashboardHome.tsx` | Page | Pass `href` to operational StatCards (`/verify`, `/disputes`, `/payments`) |
| ACF-REQ-009 | `src/components/ui/StatCard.tsx` | Component | Add optional `goal` prop with `value`, `label`, `lowerIsBetter`. Render goal comparison text next to trend with green/red coloring |
| ACF-REQ-009 | `src/pages/DashboardHome.tsx` | Page | Pass `goal` props to pending/disputes/sales StatCards |

---

## 5. Dependency Graph

```
ACF-REQ-009 (goal prop)
  │
  ├── modifies StatCard.tsx ──────────────┐
  └── modifies DashboardHome.tsx ──────┐   │
                                       │   │
ACF-REQ-008 (href prop)                │   │
  │                                     │   │
  ├── modifies StatCard.tsx ────────────┤───┘
  └── modifies DashboardHome.tsx ───────┘
                                       │
ACF-REQ-003 (error guards)             │
  └── modifies DashboardHome.tsx ───────┘
  Note: All 3 modify DashboardHome.tsx — edit in same pass
  Note: ACF-REQ-008 + ACF-REQ-009 both modify StatCard.tsx — edit in same pass


ACF-REQ-006 (lock useRef)
  │
  ├── modifies useProductLock.ts
  └── modifies useDisputeActions.ts
  Note: FOUNDATIONAL for ACF-REQ-001 — must be applied first

ACF-REQ-001 (session handler)
  │
  └── modifies App.tsx
  Note: Depends on ACF-REQ-006 being deployed first (lock cleanup
  must survive session clearance before we add auto-redirect)

ACF-REQ-002 + ACF-REQ-007 (same file)
  │
  └── both modify usePendingProducts.ts — MUST apply together
  │
  ├── ACF-REQ-002: replace empty error blocks
  └── ACF-REQ-007: add lock re-check before products.update()
  Note: Applied in same edit session to prevent merge conflicts

ACF-REQ-005 (sort/page reset)
  └── modifies UsersPage.tsx — standalone, no deps

ACF-REQ-004 (disputes error)
  └── modifies DisputesPage.tsx — standalone, no deps
```

### Recommended Implementation Order

| Order | Specs | Rationale |
|-------|-------|-----------|
| 1 | ACF-REQ-006 | Lock release is foundational — session handler depends on locks releasing correctly after expiry |
| 2 | ACF-REQ-001 | Session handler — now safe because lock cleanup uses refs that survive clearance |
| 3 | ACF-REQ-008 + ACF-REQ-009 + ACF-REQ-003 | DashboardHome + StatCard — edit all three in one pass (same files) |
| 4 | ACF-REQ-005 | Standalone sort fix |
| 5 | ACF-REQ-004 | Standalone disputes error state |
| 6 | ACF-REQ-002 + ACF-REQ-007 | Same file (`usePendingProducts.ts`) — apply together to avoid merge conflicts |

---

## 6. Schema/Type Changes

**None**. All changes are client-side only. No new tables, columns, RPCs, or migrations.

The `goal` prop type added to `StatCard.tsx` extends the component's props interface but does not affect any shared type or database schema:

```typescript
// Local to StatCard.tsx
goal?: {
  value: number;
  label: string;
  lowerIsBetter?: boolean;
} | null;
```

No changes to `packages/types/` are needed.

---

## 7. Verification Notes

### For testing ACF-REQ-001 (Session expiry):
- Force expiry by calling `supabase.auth.signOut()` programmatically from the console
- Verify toast appears and URL changes to `/login`
- Verify `VerificationPage` cleanup fires before redirect (check network tab for unlock RPC)

### For testing ACF-REQ-006 (Lock release):
- Mock `useAuthStore` to return `user: null`
- Call `releaseLock()` directly
- Verify `supabase.rpc('fn_unlock_product')` is called with the correct admin_id (from ref)

### For testing ACF-REQ-007 (Lock re-check):
- Mock `fn_lock_product` RPC to return `success: false`
- Call `resolveMutation.mutateAsync()`
- Verify product.update() was NOT called (SQL query count in test assertions)

### For testing ACF-REQ-003 (Dashboard error):
- Mock `useAdminStats` to return `isError: true`
- Verify stat card grids and activity summary do NOT appear in the DOM
- Verify error banner is present
- Mock refetch to succeed → verify cards appear
