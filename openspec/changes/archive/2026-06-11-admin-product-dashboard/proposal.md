# Proposal: Admin Product Dashboard — Filtered Tabs & Server-Side Search

## Intent

The current `ProductManagementPage` fetches ALL products (8 statuses) with client-side search only. As product volume grows, this becomes slow and noisy. Admins need to triage **Active** products (VERIFIED, RESERVED, IN_DISPUTE) separately from **History** (SOLD, REJECTED, HIDDEN), with fast server-side search and count badges for quick backlog assessment.

PENDING_VERIFICATION and IN_REVIEW are excluded — they live on a dedicated VerificationPage.

## Scope

### In Scope
- Two tabs: **Active** (VERIFIED, RESERVED, IN_DISPUTE) and **History** (SOLD, REJECTED, HIDDEN)
- Per-tab count badges via parallel `head: true` count queries
- Debounced server-side search (300ms) scoped to current tab
- Search via `.or('name.ilike.%...%,id.ilike.%...%')`
- Accessible `role="tablist"` with keyboard navigation
- Empty state per tab
- Preserve existing soft-delete/restore actions
- Local React state for tab selection (no URL sync)
- Replicate UsersPage filter pattern

### Out of Scope
- PENDING_VERIFICATION / IN_REVIEW (separate VerificationPage)
- URL sync for tab state
- Per-status sub-filters within tabs
- Bulk actions (future work)

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `admin-product-management`: Adds server-side filtered tabs, count badges, debounced search, and accessible tab UI to the existing product management page. Preserves all soft-delete/restore behavior from the previous cycle.

## Approach

**Data layer**: Refactor `useAdminProduct` to accept `tab` and `search` parameters. Use separate query keys per tab (`['admin-products', tab]`) so switching tabs doesn't invalidate cached data. Add a parallel `useAdminProductCounts` hook that runs two `head: true` count queries (Active + History) for badge display.

**Search**: Pass debounced search to the query. Use `.or('name.ilike.%...%,id.ilike.%...%')` for server-side filtering. Reset pagination on search change.

**UI**: Replicate UsersPage pill-style tabs with `role="tablist"`, `aria-selected`, and keyboard arrow navigation. Show count badges inline. Empty state per tab when no results match.

**Accessibility**: Native `<button>` for tabs, `aria-controls` linking tab to panel, focus management on tab switch.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/admin-web/src/pages/ProductManagementPage.tsx` | Modified | Add tab UI, search, count badges, empty states |
| `apps/admin-web/src/hooks/useAdminProduct.ts` | Modified | Accept tab/search params, filter by status group |
| `apps/admin-web/src/hooks/useAdminProductCounts.ts` | New | Parallel count queries per tab |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Count queries add latency | Low | `head: true` queries are cheap; run in parallel |
| Search debounce too slow/fast | Low | 300ms is industry standard; adjust if needed |
| Tab switch feels laggy | Low | Separate query keys cache each tab; instant switch on revisit |

## Rollback Plan

Revert `ProductManagementPage.tsx` and `useAdminProduct.ts` to the previous version. No database changes, no migration to undo.

## Dependencies

- None. All patterns already exist in UsersPage and useAdminStats.

## Success Criteria

- [ ] Active tab shows only VERIFIED, RESERVED, IN_DISPUTE products
- [ ] History tab shows only SOLD, REJECTED, HIDDEN products
- [ ] Count badges display accurate per-tab totals
- [ ] Search filters server-side and is scoped to current tab
- [ ] Tab UI is keyboard-navigable and screen-reader friendly
- [ ] Existing soft-delete/restore actions work unchanged
