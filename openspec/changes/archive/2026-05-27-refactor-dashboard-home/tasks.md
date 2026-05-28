# Tasks: Refactor DashboardHome

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 50–70 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation — Shared Components & Data Layer

- [x] 1.1 **`src/components/ui/StatCard.tsx`** — Add `isLoading?: boolean` prop. When true, render a pulsing skeleton placeholder instead of `value`. (`color` and `children` already exist — no other changes needed)
- [x] 1.2 **`src/hooks/useAdminStats.ts`** — Parallelize: wrap all 4 queries in `Promise.all`. Replace `wallets.reduce()` with `supabase.from('wallets').select('sum:available_balance')` aggregate. Replace `monthlyOrders?.length` with `.select('id', { count: 'exact', head: true })`. Destructure and return `isError` and `refetch` from the query.
- [x] 1.3 **`src/hooks/useAuditLogs.ts`** — Narrow `.select('*, admin:profiles(username, avatar_url)')` to explicit columns: `id, action_type, details, created_at, admin_id, admin:profiles(username, avatar_url)`.

## Phase 2: Core — DashboardHome Rewire

- [x] 2.1 **`src/pages/DashboardHome.tsx`** — Delete inline `StatCard` definition (lines 5–21). Import shared `StatCard` from `../components/ui/StatCard`.
- [x] 2.2 **`src/pages/DashboardHome.tsx`** — Destructure `isError, refetch` from `useAdminStats()`. Add error banner above the stats grid when `isError` is true, with a "Reintentar" button that calls `refetch()`.
- [x] 2.3 **`src/pages/DashboardHome.tsx`** — Replace `` `$${stats?.totalToPay.toLocaleString()}` `` with `formatCurrency(stats?.totalToPay ?? 0)` (import from `../../lib/utils/formatCurrency`).
- [x] 2.4 **`src/pages/DashboardHome.tsx`** — Delete the redundant "[Últimas Acciones de Admin]" placeholder `<div>` (lines 69–71). Keep `ActivityFeed` below the chart placeholder.

## Phase 3: Integration — ActivityFeed Error State

- [x] 3.1 **`src/components/features/verify/ActivityFeed.tsx`** — Destructure `isError, refetch` from `useAuditLogs()`. Add error state before the loading check: render error message + "Reintentar" button when `isError` is true.

## Phase 4: Verification

- [x] 4.1 **Audit**: Verify `UserDetailPage.tsx` still renders StatCards correctly (no breaking changes — `color` already optional, `isLoading` defaults to `false`).
- [x] 4.2 **Build**: Run `bun run build` in `apps/admin-web/` — confirm no TypeScript or lint errors.
