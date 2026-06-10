# Proposal: Product Deletion Hardening

## Intent

The product deletion flow has critical security gaps (no RLS on `products`, no ownership validation), data integrity bugs (admin reactivation resurrects soft-deleted products), a broken PostgREST filter, and missing UX polish (no loading states, no a11y labels). This change makes the module production-grade: secure, correct, and polished.

## Scope

### In Scope
- RLS policies on `products` table (owner-only UPDATE/DELETE, public SELECT for active)
- Ownership check in delete mutation + dispute/order pre-validation
- New `IN_DISPUTE` product status: DB migration, auto-set trigger on dispute creation, UI badge, navigation to `order/[id]`
- Fix `fn_admin_update_user_status` to filter `deleted_at IS NULL` on reactivation
- Fix PostgREST syntax bug in `useRecentlyViewed.ts:19`
- Optimistic update for delete mutation (remove from cache, rollback on error)
- Admin-web product soft-delete UI with `admin_audit_logs` trail
- MyListingCard a11y: `accessibilityRole="button"`, `accessibilityHint`, focus management on delete icon
- Delete button loading state + disabled during mutation
- Hide delete button for `IN_DISPUTE` products
- Haptic feedback on delete success (`expo-haptics`)
- ConfirmDialog: focus trap, screen reader announcement on open/close, `aria-live` region
- Skeleton loading during query refetch after optimistic removal
- Restyle theme tokens for delete button states (no raw shadow/color values)

### Out of Scope
- Undo toast action (simple confirmation dialog is sufficient)
- Hard delete / permanent removal
- Product view count in confirmation dialog
- Admin bulk-delete operations

## Capabilities

### New Capabilities
- `product-deletion`: Soft-delete flow with RLS, ownership validation, optimistic update, confirmation dialog, loading state, and a11y labels
- `product-dispute-status`: `IN_DISPUTE` enum value, auto-set trigger on dispute open, badge rendering, smart navigation to order detail, hidden delete button
- `admin-product-management`: Admin-web product soft-delete UI with audit trail in `admin_audit_logs`

### Modified Capabilities
None — no existing product specs in `openspec/specs/`.

## Approach

1. **DB migration**: Add `IN_DISPUTE` to `product_status_enum`. Create RLS policies on `products` (SELECT for all, UPDATE for owner where `deleted_at IS NULL`). Fix `fn_admin_update_user_status` WHERE clause.
2. **Trigger**: Create `fn_set_product_in_dispute` fired on `disputes` INSERT — sets product status to `IN_DISPUTE`.
3. **Frontend deletion**: Add `onMutate` optimistic update to `deleteMutation`, ownership guard via `seller_id` check, pre-delete validation (no active disputes/orders).
4. **PostgREST fix**: Replace `.not('status', 'in', '("HIDDEN", "REJECTED")')` with `.not('status', 'in', '("HIDDEN","REJECTED")')` (remove inner quotes).
5. **Admin-web**: New product action in admin dashboard — soft-delete with confirmation, audit log entry.
6. **UI polish**: Add `accessibilityRole`, `accessibilityHint`, focus management to MyListingCard buttons. Haptic feedback on delete success via `expo-haptics`. ConfirmDialog focus trap + screen reader announcement. Skeleton loading during refetch. Restyle tokens over raw styles. `isDeleting` prop to disable delete button. Hide trash icon for `IN_DISPUTE`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | RLS policies, `IN_DISPUTE` enum, trigger, admin function fix |
| `apps/frontend/core/hooks/useProductManagement.ts` | Modified | Optimistic update, ownership check, pre-validation |
| `apps/frontend/core/store/useRecentlyViewed.ts` | Modified | PostgREST filter fix |
| `apps/frontend/components/features/profile/MyListingCard.tsx` | Modified | A11y roles/hints, loading state, IN_DISPUTE handling, Restyle tokens |
| `apps/frontend/components/ui/ConfirmDialog.tsx` | Modified | Focus trap, screen reader announcement, `aria-live` region |
| `apps/frontend/components/base/` | Modified | Skeleton component for optimistic refetch state |
| `apps/admin-web/src/pages/` | New | Product management page with soft-delete |
| `packages/types/src/database.types.ts` | Modified | `IN_DISPUTE` enum value |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| RLS breaks existing queries | Med | Audit all product queries pre-migration; test with `anon`/`authenticated` |
| Dispute trigger race condition | Low | Trigger runs in transaction with dispute INSERT |
| Optimistic update flicker on error | Low | Rollback in `onError` restores cached product |

## Rollback Plan

1. Revert migration (drop RLS policies, remove `IN_DISPUTE` enum, restore original `fn_admin_update_user_status`).
2. Revert frontend hooks and components to pre-change state.
3. Remove admin-web product management page.

## Dependencies

- Supabase migration deployment
- `packages/types` regeneration after migration

## Success Criteria

- [ ] `products` table has RLS policies; unauthenticated users cannot modify products
- [ ] Seller can only soft-delete own products; deletion blocked for products with active disputes
- [ ] `IN_DISPUTE` status auto-applied when dispute opens; badge visible in MyListingCard
- [ ] Admin reactivation does NOT restore soft-deleted products (`deleted_at IS NOT NULL` stays hidden)
- [ ] `useRecentlyViewed` correctly filters HIDDEN/REJECTED products
- [ ] Delete mutation uses optimistic update with rollback
- [ ] Admin-web can soft-delete products with audit trail
- [ ] MyListingCard buttons have `accessibilityRole`, `accessibilityHint`, and focus support
- [ ] ConfirmDialog traps focus and announces to screen readers on open
- [ ] Delete success triggers haptic feedback
- [ ] No raw style values in MyListingCard — all colors/spacing from Restyle theme
