# Design: Product Deletion Hardening

**Change**: `product-deletion-hardening` &nbsp;&nbsp; **Date**: 2026-06-07

## Technical Approach

Six fixes: (1) `IN_DISPUTE` enum + RLS on `products` mirroring `policies_shipments.sql`, (2) auto-flip product to `IN_DISPUTE` via `SECURITY INVOKER` trigger on `disputes` insert, (3) admin reactivation `WHERE deleted_at IS NULL` fix, (4) optimistic delete with ownership + pre-flight guards + iOS haptics, (5) PostgREST CSV fix in `useRecentlyViewed`, (6) admin-web soft-delete page backed by audit-logged RPC. UI work ports RN a11y primitives to `MyListingCard`, adds focus-trap + live region to `ConfirmDialog`, replaces raw style literals with Restyle tokens.

## Architecture Decisions

| Decision | Options | Chosen | Rationale |
|---|---|---|---|
| Trigger function type | DEFINER (bypasses RLS) | **INVOKER** | Supabase guidance: never use DEFINER to "fix" a permission gap. |
| Dispute priority | Always override | **Skip if VERIFIED/RESERVED/SOLD** | Spec: idempotent, do not downgrade sales-locked rows. |
| Optimistic strategy | Pure invalidate | **`onMutate` cache remove + `onError` rollback** | REQ-PD-003 mandates instant removal; rollback restores prior shape. |
| Pre-flight check | RPC-side guard | **Client-side (no network)** | REQ-PD-002: "no Supabase call is made" on these failure modes. |
| Focus trap on RN dialog | DOM trap | **`accessibilityViewIsModal` + `autoFocus`** | RN has no DOM; Paper `Dialog` already portals. |
| Haptic target | Always | **iOS only** | `building-native-ui`: conditional haptics. |
| Admin soft-delete | Direct UPDATE | **RPC `fn_admin_soft_delete_product`** | Mirrors `fn_admin_toggle_verified_seller`: audit + admin check in one place. |

## Database Migration

`supabase/migrations/20260607000000_product_deletion_hardening.sql` contains: `ALTER TYPE product_status_enum ADD VALUE 'IN_DISPUTE'`; RLS policies (`TO public` + InitPlan scalars like `(SELECT auth.uid())` and `is_admin()`) — three SELECT (public/owner/admin), two UPDATE (owner-while-`deleted_at IS NULL` / admin), `USING(false)` DELETE blocker; `fn_set_product_in_dispute` (PL/pgSQL, `SECURITY INVOKER`, looks up product via `disputes.shipment_id → shipments.product_id`, returns early if soft-deleted, updates only when status ∉ {SOLD, RESERVED}) + trigger `AFTER INSERT ON disputes`; fix `fn_admin_update_user_status` reactivation branch with `AND deleted_at IS NULL`; new `fn_admin_soft_delete_product(p_product_id uuid, p_reason text)` — JWT check → `is_admin()` → `SELECT FOR UPDATE` capturing `previous_status` → `UPDATE ... SET deleted_at = now(), status = 'HIDDEN' WHERE deleted_at IS NULL` → `INSERT admin_audit_logs (action_type='PRODUCT_SOFT_DELETE', details=jsonb_build_object('reason', p_reason, 'previous_status', v_prev))` same transaction → `RETURNS boolean`.

## Frontend Hook Design

**`useProductManagement.ts`** — guarded + optimistic. `onMutate` cancels + snapshots + filters `['my-listings']` and `['products']` caches, returns `{ prev }`. `mutationFn` runs ownership + status guards, probes `disputes`, then `UPDATE products`. `onError` restores `ctx.prev` and toasts the error message. `onSuccess` fires `Haptics.notificationAsync('success')` on iOS, then invalidates both caches.

**`useRecentlyViewed.ts:19`** — drop inner double quotes: `.not('status', 'in', '(HIDDEN,REJECTED)')`.

## UI Components (Mobile)

| File | Change |
|---|---|
| `MyListingCard.tsx` | New props: `isDeleting`, `isInDispute`, `orderId?`. Card: `accessibilityRole="button"`, `accessibilityLabel="{name}, {price}"`, `accessibilityHint="Toca para ver detalle"`. Delete btn: `accessibilityLabel="Eliminar publicación"`, `accessibilityHint="Abre diálogo"`, `accessibilityState={{ busy: isDeleting, disabled: isDeleting }}`. Replace raw `shadow*`/`elevation` with Restyle `boxShadow` token; colors from `theme.colors.*`. Hide trash icon when `isInDispute`. Render IN_DISPUTE badge (warning dot + `listings.status.IN_DISPUTE` translation) before the action bar. Smart nav: if `isInDispute && orderId` → `/profile/orders/{orderId}`, else `/product/{id}`. |
| `ConfirmDialog.tsx` | `accessibilityViewIsModal` on `Dialog`; `autoFocus` on confirm `Button`; outer `View accessibilityLiveRegion="polite"` for open/close announcement. `loading` already swaps label + disables backdrop. |
| `listings.tsx` | Show `<ProductCardSkeleton height={130} />` during `isRefetching` after optimistic removal. Pass `isDeleting={isDeletingId === product.id}`. |

## Admin-Web

**New files**: `apps/admin-web/src/pages/ProductManagementPage.tsx` + `apps/admin-web/src/hooks/useAdminProduct.ts`. Register `/products` and `/products/:id` in `apps/admin-web/src/App.tsx`. **Tailwind tokens**: `bg-state-gray`, `border-white/10`, `text-platinum`, `text-fire`, `focus:ring-lion/50` (matches `UserSafetyActions.tsx`).

Native `<button aria-label={`Eliminar producto ${name}`}>` opens the existing `InputModal` with `minLength={5}`. Confirm fires `supabase.rpc('fn_admin_soft_delete_product', { p_product_id, p_reason })`. Pre-check `fn_lock_product` shows a disabled "locked by {admin}" state. On error: `toast.error`. On success: `toast.success` + `refetch()` (no optimistic update — destructive, no rollback UX per spec out-of-scope).

## Type System

- `packages/types/src/index.ts` — add `'IN_DISPUTE'` to the `ProductStatus` union.
- `apps/frontend/core/utils/product-status.ts` — map `IN_DISPUTE` → `'warning'`.
- After migration, `bun db:types` regenerates `database.types.ts`; verify `Enums['product_status_enum']` includes the new value.

## Error Handling

| Failure | Toast | Rollback |
|---|---|---|
| `FORBIDDEN_NOT_OWNER` | `listings.toast.deleteForbidden` | none (client guard) |
| `BLOCKED_DISPUTE` | `listings.toast.deleteBlockedDispute` | none |
| `BLOCKED_STATUS` | `listings.toast.deleteBlockedStatus` | none |
| Supabase error | `common:errors.network` | `setQueryData(['my-listings'], ctx.prev)` |
| Admin RPC error | `toast.error(message)` | no optimistic update |
| RPC returns `false` | `toast.info('Producto ya estaba oculto')` | no-op |

## File Changes

**DB**: 1 migration + new `fn_admin_soft_delete_product.sql` + new `fn_set_product_in_dispute.sql` trigger; fix `fn_admin_update_user_status.sql` reactivation branch. **Mobile**: rewrite `useProductManagement.ts`; fix PostgREST in `useRecentlyViewed.ts`; add a11y + `IN_DISPUTE` + Restyle tokens to `MyListingCard.tsx`; focus trap + live region in `ConfirmDialog.tsx`; skeleton + `isDeleting` wiring in `listings.tsx`; map `IN_DISPUTE → warning` in `product-status.ts`. **Admin-web**: new `ProductManagementPage.tsx` + `useAdminProduct.ts`; register `/products` in `App.tsx`. **Types**: add `IN_DISPUTE` in `index.ts`; regen `database.types.ts` via `bun db:types`.

## Open Questions

None. All REQ scenarios map 1:1. Disputes→products via `shipments` confirmed by `fn_on_dispute_opened.sql`.
