# Tasks: Admin Product Dashboard — Filtered Tabs & Server-Side Search

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150–200 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Hooks + page wiring | PR 1 (single) | Base: main; all 3 files, single atomic PR |

## Phase 1: Hook Refactor

- [x] 1.1 **Refactor `useAdminProduct.ts`** — add `tab: ProductTab` (type export) and `search: string` params; query key `['admin-products', tab, debouncedSearch]`; filter via `.in('status', STATUS_GROUPS[tab])` + `.or()` for search; `placeholderData: keepPreviousData`; mutations invalidate `['admin-products', currentTab]` + `['admin-products-counts']` only. Module-level `ACTIVE_STATUSES`/`HISTORY_STATUSES`/`STATUS_GROUPS`. REQ-APM-005, REQ-APM-007
- [x] 1.2 **Create `useAdminProductCounts.ts`** — `Promise.all` with two `head: true` queries via `supabase.from('products').select('*', { count: 'exact', head: true }).in('status', ...)`. Returns `{ activeCount, historyCount, isLoading, isError }`. Errors resolve to `null` (UI renders "—"). REQ-APM-006

## Phase 2: UI Wiring

- [x] 2.1 **Add tab strip to `ProductManagementPage.tsx`** — `role="tablist"` container, two `<button role="tab">` with `aria-selected`, `aria-controls`, keyboard nav (ArrowLeft/Right/Home/End), Tailwind dark-theme pill style matching `UsersPage`. Badge shows count from `useAdminProductCounts`. REQ-APM-008
- [x] 2.2 **Add debounced search input** — wire `useDebounce(value, 300)` from existing `useDebounce.ts`; feed debounced value to `useAdminProduct(query)`; remove client-side `.filter()`. REQ-APM-007
- [x] 2.3 **Add tab-scoped empty states** — `aria-live="polite"` tabpanel announces "Mostrando N productos"; empty copy from (tab, hasSearch) matrix: "No hay productos activos" / "No hay productos en historial" / "No se encontraron resultados". REQ-APM-009
- [x] 2.4 **Wire soft-delete/restore with scoped invalidation** — existing `InputModal` reason flow stays; mutations invalidate `['admin-products', currentTab]` + `['admin-products-counts']` on success; `['admin-products', otherTab]` untouched. REQ-APM-010

## Files

| File | Action | Est. Δ |
|------|--------|--------|
| `apps/admin-web/src/hooks/useAdminProduct.ts` | Modify | ~+40 lines |
| `apps/admin-web/src/hooks/useAdminProductCounts.ts` | Create | ~+45 lines |
| `apps/admin-web/src/pages/ProductManagementPage.tsx` | Modify | ~+75 lines |

**Total: ~150–200 lines | 3 files | 6 tasks | 0 DB changes**
