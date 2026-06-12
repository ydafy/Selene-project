# Design: Admin Product Dashboard — Filtered Tabs & Server-Side Search

## Technical Approach

Refactor `useAdminProduct` from a single 8-status client-filtered query into a server-side tabbed query keyed by `['admin-products', tab, debouncedSearch]`. Add a sibling `useAdminProductCounts` hook that fires two parallel `head: true` count queries for badge display. The page switches from a search-then-filter pattern to a tabbed server-filtered pattern that mirrors `UsersPage` while preserving the existing soft-delete/restore mutations and `InputModal` reason flow.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Tab state location | Local `useState<'active' \| 'history'>` | URL search params | Proposal explicitly excludes URL sync; admin context is short-lived |
| Count queries | Separate `useAdminProductCounts` hook | Inline in main hook | Failure isolation: per delta spec, count rejection renders "—" while list still resolves |
| Debounce location | Page-level (`ProductManagementPage`) | Hook-level | Matches `UsersPage` precedent; `useDebounce` already exists at `apps/admin-web/src/hooks/useDebounce.ts` |
| Query key shape | `['admin-products', tab, debouncedSearch]` | `[tab]` only, client filter | Server-side `.or()` + `.in()` is the spec; client filter would still load all 8 statuses |
| Pagination reset on search | Implicit via query key change | Manual `setPage(0)` | TanStack cancels in-flight request when key changes; new key starts at page 0 |
| Invalidation scope | `['admin-products', currentTab]` + `['admin-products-counts']` | Invalidate all | Spec mandates scoped invalidation so an Active mutation does not refetch History |
| `placeholderData` strategy | `keepPreviousData` (TanStack v5 helper) | `(prev) => prev` | v5 canonical import; `UsersPage` uses equivalent inline form — both work |

## Data Flow

```
User types in search input
        │
        ▼
useDebounce(value, 300)  ──── 300ms idle ────►  debouncedSearch
                                                      │
User clicks tab                                          │
        │                                               │
        ▼                                               ▼
useState<'active'|'history'>  ────────►  useAdminProduct(tab, debouncedSearch)
                                              │
                                              │ queryKey: ['admin-products', tab, debouncedSearch]
                                              ▼
                              supabase.from('products')
                                  .in('status', GROUP[t])
                                  .or('name.ilike.%…%,id.ilike.%…%')
                                  .range(0, 19)
                                              │
        ┌─────────────────────────────────────┘
        ▼
   placeholderData: keepPreviousData
   (prior tab's rows stay visible during switch)
        │
        ▼
  TanStack cache: ['admin-products', 'history'] ← independent
                  ['admin-products', 'active']  ← independent
                  ['admin-products-counts']     ← invalidated on mutation

Mutation (softDelete / restore) onSuccess
        │
        ├─► invalidateQueries(['admin-products', currentTab])
        └─► invalidateQueries(['admin-products-counts'])
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/admin-web/src/hooks/useAdminProduct.ts` | Modify | Accept `tab` + `search` params; key `['admin-products', tab, search]`; add `.in('status', GROUP[tab])` and `.or('name.ilike…,id.ilike…')`; add `placeholderData: keepPreviousData`; invalidate scoped keys only |
| `apps/admin-web/src/hooks/useAdminProductCounts.ts` | Create | Two `useQuery` calls in parallel via `Promise.all`; queryKey `['admin-products-counts']`; returns `{ activeCount, historyCount, isLoading, isError }` |
| `apps/admin-web/src/pages/ProductManagementPage.tsx` | Modify | Add tab strip (WAI-ARIA), search input with `useDebounce`, count badge per tab, per-tab empty states, scoped `aria-live` panel; remove client-side `.filter()`; remove global total card (replaced by per-tab badges); mutations unchanged |

## Interfaces / Contracts

```ts
// useAdminProduct.ts
export type ProductTab = 'active' | 'history';
const ACTIVE_STATUSES  = ['VERIFIED', 'RESERVED', 'IN_DISPUTE'] as const;
const HISTORY_STATUSES = ['SOLD', 'REJECTED', 'HIDDEN'] as const;
const STATUS_GROUPS    = { active: ACTIVE_STATUSES, history: HISTORY_STATUSES };

export const useAdminProduct = (tab: ProductTab, search: string) => {
  // queryKey: ['admin-products', tab, search]
  // .in('status', STATUS_GROUPS[tab])
  // if (search.trim()) .or(`name.ilike.%${s}%,id.ilike.%${s}%`)
  // placeholderData: keepPreviousData
  // mutations: invalidateQueries(['admin-products', tab]) + ['admin-products-counts']
};

export const useAdminProductCounts = () => {
  // Promise.all([head count for ACTIVE_STATUSES, head count for HISTORY_STATUSES])
  // returns { activeCount: number|null, historyCount: number|null, isLoading, isError }
  // null on error → UI renders "—"
};
```

```tsx
// Tab strip (WAI-ARIA tabs pattern)
<div role="tablist" aria-label="Estado de productos"
     className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5">
  {(['active','history'] as const).map((id, i, arr) => (
    <button key={id} type="button" role="tab" id={`tab-${id}`}
      aria-selected={tab === id} aria-controls="product-panel"
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={(e) => onTabKeyDown(e, i, arr)} // Arrow / Home / End
      className={`px-4 py-1.5 rounded-xl text-xs font-bold outline-none
                  focus:ring-2 focus:ring-lion/50 ${
        tab === id ? 'bg-lion text-night' : 'text-blue-light hover:text-platinum'
      }`}>
      {id === 'active' ? 'Activos' : 'Historial'}
      <span className="ml-2 px-1.5 py-0.5 rounded-full bg-white/10 text-[10px]">
        {counts?.[`${id}Count`] ?? '—'}
      </span>
    </button>
  ))}
</div>
<div id="product-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}
     aria-live="polite">Mostrando {total} productos</div>
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Status-group mapping, debounce coalescing | Vitest on extracted `STATUS_GROUPS` + `useDebounce` |
| Integration | Hook returns filtered rows; mutation invalidates scoped keys | MSW mocks Supabase; assert `queryKey` shape and `.in('status', ...)` call |
| E2E | Tab switch shows correct rows, search filters, badge updates, keyboard nav | Playwright: Tab→ArrowRight→Enter, type "3060"→assert URL of Supabase call |

## Migration / Rollout

No DB migration. Rollback = revert the two files. Feature is purely UI + data layer; soft-delete RPC and audit trail (`REQ-APM-001…004`) untouched. Deploy behind admin-web only — no mobile or edge-function impact.

## Open Questions

- None. `useDebounce` exists, TanStack v5 supports `keepPreviousData`, and all status enums are already typed in `StatusBadge`.
