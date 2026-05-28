# Proposal: Refactor DashboardHome

## Intent

Admin landing page with 4 problems: inline `StatCard` duplicates shared one with `any` types, zero error handling (stats silently show 0/$0), sequential queries, and `toLocaleString()` without `es-MX` locale for Mexico.

## Scope

### In Scope
1. **StatCard consolidation** — remove inline, add `isLoading` + `color` to shared `StatCard.tsx`
2. **Error handling** — surface `isError` from `useAdminStats`, show banner with retry
3. **Query optimization** — `Promise.all`, aggregate wallet sum, `count: 'exact'` for orders
4. **Locale formatting** — use existing `formatCurrency` utility
5. **Redundant placeholder** — delete "Últimas Acciones de Admin" box (ActivityFeed renders)
6. **useAuditLogs column narrowing** — `select('*')` → specific columns
7. **ActivityFeed error state** — add error UI + retry

### Out of Scope
- Charts/trends, drill-down navigation, full KPI redesign

## Capabilities

None — pure refactor, no spec-level changes.

## Approach

| # | Fix | Files | Approach |
|---|-----|-------|----------|
| 1 | StatCard | `DashboardHome.tsx`, `StatCard.tsx` | Delete inline, add `isLoading` + `color` to shared |
| 2 | Error | `DashboardHome.tsx` | `isError/refetch` → banner + retry |
| 3 | Queries | `useAdminStats.ts` | `Promise.all`, aggregate `.sum()`, exact count |
| 4 | Locale | `DashboardHome.tsx` | `formatCurrency(value)` over `toLocaleString()` |
| 5 | Placeholder | `DashboardHome.tsx` | Delete "Últimas Acciones" `<div>` |
| 6 | Columns | `useAuditLogs.ts` | Select `id, action_type, details, created_at, admin_id` only |
| 7 | Error | `ActivityFeed.tsx` | `isError/refetch` → message + retry |

## Affected Areas

| File | Impact |
|------|--------|
| `DashboardHome.tsx` | Modified — StatCard, error, formatCurrency |
| `StatCard.tsx` | Modified — new `isLoading` + `color` props |
| `useAdminStats.ts` | Modified — parallel, aggregate, exact count |
| `useAuditLogs.ts` | Modified — narrow columns |
| `ActivityFeed.tsx` | Modified — error state + retry |

## Risks

- StatCard props break other pages (Low) — audit usages
- Wallet aggregate wrong shape (Low) — test vs current sum
- Error banner on transient blip (Low) — TanStack retries before showing

## Rollback

Revert merge commit. If `StatCard` alone breaks other pages, revert that file independently.

## Dependencies

None.

## Success Criteria

- [ ] DashboardHome imports shared `StatCard` (no inline version)
- [ ] Error banner shows on Supabase failure (not silent zeros)
- [ ] 4 parallel queries, not sequential
- [ ] Wallet sum: 1 aggregate row, not N rows
- [ ] Monthly sales: `count: 'exact'`, not `.length`
- [ ] Currency: `formatCurrency` with es-MX locale
- [ ] No duplicate "Últimas Acciones" placeholder
- [ ] `useAuditLogs` response has no unused columns
- [ ] ActivityFeed shows error + "Reintentar"
