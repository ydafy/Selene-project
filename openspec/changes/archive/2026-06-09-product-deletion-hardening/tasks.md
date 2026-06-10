# Tasks: Product Deletion Hardening

## Review Workload Forecast

| Field                   | Value                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| Estimated changed lines | 380–490                                                           |
| 400-line budget risk    | Medium                                                            |
| Chained PRs recommended | Yes                                                               |
| Suggested split         | PR 1 (DB+Types) → PR 2 (Mobile UI) + PR 3 (Admin Web) in parallel |
| Delivery strategy       | ask-always                                                        |
| Chain strategy          | pending                                                           |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal                       | Likely PR | Notes                                     |
| ---- | -------------------------- | --------- | ----------------------------------------- |
| 1    | DB migration + Types regen | PR 1      | base=main; foundation for all downstream  |
| 2    | Mobile hooks + UI          | PR 2      | base=main after PR 1; feature + a11y      |
| 3    | Admin-web product page     | PR 3      | base=main after PR 1; independent of PR 2 |

## Phase 1: Database

- [x] 1.1 Migration: `20260608000000_product_deletion_hardening.sql` — `CREATE TYPE product_status_enum` with IN_DISPUTE, convert products.status to enum, 6 RLS policies (SELECT public/owner/admin, UPDATE owner/admin, DELETE blocker), fix `fn_admin_update_user_status` reactivation `WHERE` with `deleted_at IS NULL`. **REQ-PD-001, REQ-PD-005, REQ-PDS-001**
- [x] 1.2 Same migration: `fn_set_product_in_dispute` (SECURITY INVOKER, skip if soft-deleted or status ∈ {SOLD,RESERVED}) + `AFTER INSERT ON disputes` trigger. **REQ-PDS-002**
- [x] 1.3 Same migration: `fn_admin_soft_delete_product(p_product_id, p_reason)` — JWT→is_admin() check, SELECT FOR UPDATE, UPDATE, audit INSERT, RETURNS boolean. **REQ-APM-001, REQ-APM-002**

## Phase 2: Types

- [x] 2.1 Add `'IN_DISPUTE'` to `ProductStatus` union in `packages/types/src/index.ts`. **REQ-PDS-001**
- [x] 2.2 Run `bun db:types` → regen `packages/types/src/database.types.ts`; verify `Enums['product_status_enum']` includes `IN_DISPUTE`. **REQ-PDS-001**

## Phase 3: Mobile Hooks

- [x] 3.1 Rewrite `apps/frontend/core/hooks/useProductManagement.ts` — `onMutate` optimistic cache remove + rollback in `onError`, client-side ownership guard (`seller_id`), pre-flight check (dispute/SOLD/RESERVED), `Haptics.notificationAsync('success')` on iOS. **REQ-PD-002, REQ-PD-003**
- [x] 3.2 Fix `apps/frontend/core/store/useRecentlyViewed.ts:19` — drop inner quotes: `.not('status', 'in', '(HIDDEN,REJECTED)')`. **REQ-PD-004**
- [x] 3.3 Add `'IN_DISPUTE'` → `'warning'` mapping in `apps/frontend/core/utils/product-status.ts`. **REQ-PDS-003**

## Phase 4: Mobile UI

- [x] 4.1 `MyListingCard.tsx` — `accessibilityRole="button"`, `accessibilityLabel`, `accessibilityHint` on card + delete btn; `accessibilityState={{ busy: isDeleting, disabled: isDeleting }}`; Restyle tokens (no raw shadow/color); IN_DISPUTE badge + hidden trash + smart nav to `/profile/orders/{orderId}`. **REQ-PD-006, REQ-PDS-003, REQ-PDS-004, REQ-PDS-005**
- [x] 4.2 `ConfirmDialog.tsx` — `accessibilityViewIsModal` on inner View, `AccessibilityInfo.setAccessibilityFocus` on confirm btn, wrap in `View accessibilityLiveRegion="polite"` for open/close announcement. **REQ-PD-007**
- [x] 4.3 `listings.tsx` — skeleton `<ProductCardSkeleton height={130} />` during initial `isRefetching`, pass `isDeleting={deletingProductId === item.id}`, pass `isInDispute={item.status === 'IN_DISPUTE'}`. **REQ-PD-003**

## Phase 5: Admin Web

- [x] 5.1 New `apps/admin-web/src/hooks/useAdminProduct.ts` — search product, call `fn_admin_soft_delete_product` RPC, lock check via `fn_lock_product`, error/success toast. **REQ-APM-003**
- [x] 5.2 New `apps/admin-web/src/pages/ProductManagementPage.tsx` — product search + detail view, destructive confirm `InputModal` (reason minLength=5), native button with `aria-label`, locked-by-admin state. **REQ-APM-003, REQ-APM-004**
- [x] 5.3 Register `/products` route in `apps/admin-web/src/App.tsx`. **REQ-APM-003**

## Phase 6: Verification

- [x] 6.1 Test RLS: anon SELECT, owner UPDATE, non-owner UPDATE (0 rows), DELETE (blocked). **REQ-PD-001**
- [x] 6.2 Test trigger: dispute INSERT flips product to IN_DISPUTE; soft-deleted product untouched. **REQ-PDS-002**
- [x] 6.3 Test admin RPC: success returns true, non-admin raises, no-op returns false, audit row inserted atomically. **REQ-APM-001, REQ-APM-002**
- [x] 6.4 Test mobile flow: optimistic remove + rollback on error, haptic on success, client-side guards block SOLD/dispute. **REQ-PD-002, REQ-PD-003**
- [x] 6.5 Test a11y: VoiceOver reads card/delete labels; ConfirmDialog traps focus; list skeleton renders during refetch. **REQ-PD-006, REQ-PD-007**
- [x] 6.6 Test admin-web: soft-delete with reason, disabled confirm until valid, locked-by state, error toast. **REQ-APM-003, REQ-APM-004**
