# Proposal: Admin Critical Fixes

## Intent

Fix 9 reliability and usability issues in the admin dashboard: 7 bugs causing silent failures, misleading UI states, data races, and lock leaks; plus 2 dashboard improvements (KPI drilldown navigation and trend targets) that turn the homepage from a static view into a functional tool.

## Scope

### In Scope

- `App.tsx` + `useAuthStore` — add `onAuthStateChange` subscription, session expiry warning + redirect
- `usePendingProducts` — surface audit/notification errors to console + warning toast
- `useAdminStats` / `DashboardHome` — hide stat cards on error, show skeleton + retry
- `DisputesPage` + `useActiveDisputes` — wire `isError` + `refetch`, show `ErrorState` with retry
- `UsersPage` — reset `page` to 0 on sort change alongside `setSortBy`
- `useProductLock` + `useDisputeLock` — switch from `user?.id` dependency to `useAuthStore.getState()` for release
- `usePendingProducts` — add lock re-check before product update mutation

### Out of Scope

- Backend RPC changes for atomic audit+notification (future work)
- Version-based optimistic concurrency for products (future)
- Retry logic for failed audit/notification (future)
- DB-level cascade for lock cleanup (future)

## Capabilities

### New Capabilities

- None (all fixes are refactoring within existing capabilities)

### Modified Capabilities

- `admin-auth`: session lifecycle monitoring via `onAuthStateChange` (no spec change — pure implementation fix)
- `admin-moderation`: lock release logic, error surfacing, race prevention
- `admin-dashboard`: error state isolation from data rendering
- `admin-users`: pagination consistency on sort change

## Approach

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | Session expiry | CRITICAL | Add `onAuthStateChange` in `App.tsx`; on SIGNED_OUT, set store state + `Navigate` to `/login` |
| 2 | Silent audit/notif failures | CRITICAL | Replace empty catch blocks with `console.error` + `toast.warning` |
| 3 | Zeros on error | HIGH | Guard `<div>`, show skeleton when `isError` is true |
| 4 | No error state on disputes | HIGH | Destructure `isError`, `refetch`; render `<ErrorState>` at top |
| 5 | Sort without page reset | MEDIUM | Add `setPage(0)` in `<select onChange>` handler |
| 6 | Lock leaks on stale user | MEDIUM | Replace `user?.id` in `useCallback` deps with `useAuthStore.getState().user?.id` |
| 7 | Race on verdicts | MEDIUM | Before `products.update()`, call `fn_lock_product` check; reject if not current locker |
| 8 | No KPI drilldown | HIGH | Add optional `href` prop to `StatCard`; wire navigation on click for operational KPIs |
| 9 | No trend targets | MEDIUM | Add optional `target` prop to `StatCard`; show target vs actual in trend display |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/App.tsx` | Modified | Add auth state listener + session guard |
| `src/store/useAuthStore.ts` | Modified | Expose `setUser(null)` for session end |
| `src/hooks/usePendingProducts.ts` | Modified | Error surfacing + lock pre-check |
| `src/hooks/useProductLock.ts` | Modified | Static store read for release |
| `src/hooks/useDisputeActions.ts` | Modified | Static store read for release |
| `src/hooks/useActiveDisputes.ts` | Modified | Export `isError`, `refetch` |
| `src/pages/DashboardHome.tsx` | Modified | Conditional stat card render |
| `src/pages/DisputesPage.tsx` | Modified | Wire error state + retry |
| `src/pages/UsersPage.tsx` | Modified | Reset page on sort change |
| `src/pages/VerificationPage.tsx` | Modified | Lock cleanup dep fix |
| `src/pages/DisputeDetailPage.tsx` | Modified | Lock cleanup dep fix |
| `src/components/ui/StatCard.tsx` | Modified | Add `href` and `target` props |
| `src/pages/DashboardHome.tsx` | Modified | Wire navigation on StatCards + pass targets |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `onAuthStateChange` fires during initial session restore | Low | Guard against redundant state resets |
| `getState()` reads stale during rapid lock/unlock sequence | Low | Use fat arrow `getState()` at call site, not at hook mount |
| Lock re-check adds latency to verdict flow | Med | RPC call is fast (<50ms); accept tradeoff for correctness |

## Rollback Plan

Revert each file individually. No migration or DB changes. All fixes are client-side JS — rollback is a git revert + deploy.

## Dependencies

None — all fixes are self-contained client-side changes.

## Success Criteria

- [ ] Session expiry → warning toast + redirect to /login within 5s
- [ ] Audit/notification DB errors → appear in browser console + warning toast
- [ ] Dashboard shows error banner + skeletons (not zeros) on query failure
- [ ] Disputes page shows error state + retry button on query failure
- [ ] Changing sort on UsersPage resets to page 0
- [ ] Lock release does not silently return early when session expires
- [ ] Product verdict mutation rejects if current admin no longer holds the lock
- [ ] Clicking operational KPI cards navigates to the relevant page (/verify, /disputes, /users)
- [ ] KPI cards show target values alongside trends (e.g. "▲12% target: 15%")
