## Exploration: admin-product-dashboard-filters

### Current State

The `ProductManagementPage` was built during the `product-deletion-hardening` cycle and provides soft-delete/restore functionality. It currently:

- **Fetches ALL products** via `useInfiniteQuery` with `PAGE_SIZE = 20`, query key `['admin-products']`, no status filter
- **Client-side search only** — filters by name/ID after all data is loaded
- **Shows all statuses in one table** — no segmentation, no tabs
- **Uses a manual `<table>`** instead of the existing `DataTable` component (`@tanstack/react-table`)
- **Critical bug found**: `useAdminProduct.ts` has `restoreMutation` defined **after** the first `return` statement (lines 105-125). The hook returns at line 103, so `restoreProduct` is **dead code**. The restore button in the UI calls a function that doesn't exist in the returned object.

The product status enum has 8 values: `PENDING_VERIFICATION`, `IN_REVIEW`, `VERIFIED`, `SOLD`, `REJECTED`, `HIDDEN`, `RESERVED`, `IN_DISPUTE`. The mobile app already groups these into "Active" (not history) and "History" (`SOLD`, `REJECTED`, `HIDDEN`).

### Affected Areas

- `apps/admin-web/src/pages/ProductManagementPage.tsx` — needs tab UI, empty states per tab, URL sync
- `apps/admin-web/src/hooks/useAdminProduct.ts` — needs status filter param, bug fix for restoreMutation, query key change
- `apps/admin-web/src/components/ui/StatusBadge.tsx` — already supports all statuses, no changes needed
- `apps/admin-web/src/components/ui/DataTable.tsx` — optional migration target
- `apps/admin-web/src/hooks/useAdminStats.ts` — pattern for count queries by status already exists

### Patterns Found in Existing Code

| Pattern | Location | How it works | Reusable for products? |
|---------|----------|--------------|----------------------|
| **Status pills** | `UsersPage.tsx` | Server-side filter with `status` param, query key includes filter, resets page to 0 | Yes — exact pattern |
| **SegmentedControl (Active/History)** | `listings.tsx` (mobile) | Client-side `useMemo` filter with `isProductHistory()` | Yes — for quick win |
| **Debounced search** | `useUsers.ts` | `useDebounce` hook, 300ms, passes debounced value to query | Yes — should add to product page |
| **Count badges** | `useAdminStats.ts` | `supabase.from('products').select(..., { count: 'exact', head: true }).eq('status', ...)` | Yes — for tab counters |
| **DataTable** | `DataTable.tsx` | `@tanstack/react-table` with sorting, pagination, skeleton | Optional — would standardize |
| **URL-based tab** | Not implemented yet | Would use `useSearchParams` or `useNavigate` | New pattern needed |

### Approaches

#### 1. Quick Win — Client-side Active/History tabs (2-3 hours)
- Add two tabs: **Active** (PENDING_VERIFICATION, IN_REVIEW, VERIFIED, IN_DISPUTE, RESERVED) and **History** (SOLD, REJECTED, HIDDEN)
- Keep `useInfiniteQuery` as-is (fetches all products)
- Filter client-side with `useMemo` (reuse `isProductHistory` logic from mobile)
- Add empty state per tab
- **Pros**: Fast to implement, no backend changes, instant tab switching
- **Cons**: Still loads all 5000 products, search is client-side only, no URL sync
- **Effort**: Low

#### 2. Server-side Filtering + Tabs (1-2 days) — **RECOMMENDED**
- Add `statusFilter` param to `useAdminProduct` hook
- Use Supabase `.eq('status', ...)` or `.in('status', [...])` for Active/History groups
- Change query key to `['admin-products', statusFilter, search]`
- Add per-tab count badges (parallel count queries, like `useAdminStats`)
- Add debounced search (server-side `ilike` on name/ID)
- Add URL sync: `?tab=active` or `?status=verified`
- **Pros**: Scales to 10k+ products, faster initial load, sharable links, consistent with UsersPage
- **Cons**: More UI state management, tab switch triggers new query, slightly more complex
- **Effort**: Medium

#### 3. Full DataTable Migration + Advanced Filtering (2-3 days)
- Migrate to `DataTable` component with column sorting
- Add column visibility toggles
- Add multi-select status filter (checklist instead of tabs)
- Add date range filter
- **Pros**: Most flexible, professional admin UX
- **Cons**: Heavy refactor, overkill for current needs, DataTable is client-side only (would need server-side pagination integration)
- **Effort**: High

### Recommendation

**Option 2 (Server-side Filtering + Tabs)** is the right balance. The UsersPage already proves this pattern works. However, given the restore bug is critical, I recommend a **phased approach**:

1. **Phase 0 (Immediate)**: Fix `restoreMutation` dead code bug in `useAdminProduct.ts`
2. **Phase 1 (Quick win)**: Add client-side Active/History tabs to improve UX immediately
3. **Phase 2 (Full cycle)**: Move to server-side filtering with query key changes, debounced search, URL sync, and count badges

### Risks

- **Bug risk**: The `restoreMutation` dead code means product restore is currently broken. Must fix before any enhancement.
- **Performance risk**: With 5000 products, client-side filtering loads 250 pages of 20. The `useInfiniteQuery` `getNextPageParam` will keep fetching until all pages are loaded. This is a hidden waterfall.
- **Query key invalidation**: Changing query keys means `softDelete` and `restore` mutations must invalidate the correct keys per tab, not just `['admin-products']`.
- **State desync**: If an admin soft-deletes a product on the "Active" tab, it should appear in "History" without a full refetch. TanStack Query's `placeholderData` can help, but tab switching may show stale counts.

### Ready for Proposal

**Yes**, but with a phased proposal:

- **Phase 0** (bugfix): Fix `restoreMutation` in `useAdminProduct.ts`
- **Phase 1** (quick win): Add Active/History tabs with client-side filtering, empty states, and tab badges (using existing count patterns from `useAdminStats`)
- **Phase 2** (optimization): Server-side filtering by status group, debounced search, URL sync (`?tab=active|history`)

The proposal should specify:
1. Tab definitions: Active = `['PENDING_VERIFICATION', 'IN_REVIEW', 'VERIFIED', 'IN_DISPUTE', 'RESERVED']`, History = `['SOLD', 'REJECTED', 'HIDDEN']`
2. Query key design: `['admin-products', { tab, search, page }]`
3. Server-side search implementation (`.or('name.ilike.%...%,id.ilike.%...%')`)
4. Count badge queries (parallel `head: true` count queries per status group)
5. URL sync with `useSearchParams`
6. Accessibility: `role="tablist"`, `role="tab"`, `aria-selected`, keyboard navigation per WCAG 2.2
