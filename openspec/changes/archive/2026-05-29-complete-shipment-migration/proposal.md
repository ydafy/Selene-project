# Proposal: Complete Multi-Seller Shipment Migration (Fases 5-9)

## Intent

Migrate the remaining order/shipment architecture from order-level to shipment-level across Edge Functions, Stripe/Checkout, frontend, disputes/returns, and RLS/types cleanup. This completes the multi-seller foundation — enabling per-seller tracking, per-seller refunds, per-seller delivery confirmation within a single order.

## Scope

### In Scope
- **Fase 5**: 4 Edge Functions (get-shipping-quote, generate-shipping-label, track-shipments, track-returns) adapted for multi-origin / shipment-level
- **Fase 6**: create-payment-intent + stripe-webhooks creating N shipments per N sellers in an order
- **Fase 7**: Frontend screens + hooks + types for multi-seller order UX (+ Bug 3, Issue B cleanup)
- **Fase 8**: Fix auth in resolve-dispute-refund, fix multi-seller refund, migrate crons to shipment-level, remove fn_confirm_return_receipt
- **Fase 9**: RLS policies for shipments, types regeneration, drop old columns, remove dead SQL + dead frontend code

### Out of Scope
- Fase 10 (already done in sql.sql: fn_cron_return_delivery_timeout + schedule)
- fn_seller_initiate_return_label (already done, guard + auditoría)
- Backfill historical data — assumes Fases 1-4 executed in production
- Admin-web changes — all admin features remain order-level for now

## Capabilities

### New Capabilities
- `shipment-edge-functions`: Envia.com integration at shipment-level (quote, label, track)
- `multi-seller-checkout`: Stripe checkout creating per-seller shipments

### Modified Capabilities
- `order-management`: Enriched orders now surface per-shipment actions instead of per-order
- `dispute-resolution`: Refunds and crons operate at shipment granularity
- `return-logistics`: Returns tracked per shipment, with cron timeouts at shipment-level

## Approach

**Execution order (dependency-driven):**
1. Fase 8 first — fix bugs in existing dispute/refund logic (Bug 1, Bug 2) to unblock everything downstream
2. Fase 9 RLS — add RLS policies for shipments BEFORE any Edge Function reads/writes shipments
3. Fase 5 — Edge Functions (these read/write shipments + disputes)
4. Fase 6 — Stripe integration (creates shipments on purchase)
5. Fase 7 — Frontend (consumes shipments, new screens)
6. Fase 8 cron migration — AFTER fn_complete_shipment_refund + fn_release_shipment_funds exist and are tested
7. Fase 9 cleanup — dead code removal LAST, only after confirming nothing references it

Each Edge Function change preserves backward compat: old API paths still route to orders table where shipments not yet created.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/get-shipping-quote` | Modified | Accept multi-origin array `[{ originZip, packageId, price, sellerId }]`, return per-seller rates |
| `supabase/functions/generate-shipping-label` | Modified | Accept `shipmentId` instead of `orderId`, update `shipments` table, validate seller owns shipment |
| `supabase/functions/track-shipments` | Modified | Query `shipments(tracking_number)` instead of `orders(tracking_number)`, call `fn_mark_shipment_delivered` |
| `supabase/functions/track-returns` | Modified | Keep querying `disputes(return_tracking_number)`, call `fn_mark_return_delivered` (already exists in sql.sql) |
| `supabase/functions/create-payment-intent` | Modified | Group cart by seller, sum shipping costs, pass seller metadata for Stripe |
| `supabase/functions/stripe-webhooks` | Modified | Still calls `fn_create_order_from_payment` (already multi-seller in sql.sql), no change needed |
| `supabase/functions/resolve-dispute-refund` | Modified | Fix auth: accept `admin OR seller of dispute`, validate `dispute.status IN ('return_delivered','waiting_return')` |
| `supabase/queries/disputes/fn_complete_dispute_refund.sql` | Modified | Filter `order_items WHERE seller_id = v_seller_id` for multi-seller |
| `supabase/queries/disputes/fn_cron_dispute_payout_timeout.sql` | Modified | Call `fn_complete_shipment_refund` instead of generic logic |
| `supabase/queries/disputes/fn_cron_dispute_shipping_timeout.sql` | Modified | Call `fn_release_shipment_funds` per shipment instead of `fn_release_order_funds` |
| `supabase/queries/disputes/fn_resolve_dispute_to_seller.sql` | Modified | Remove direct `UPDATE orders`, let trigger handle it |
| `supabase/queries/return/fn_confirm_return_receipt.sql` | Removed | Replaced by `fn_seller_confirm_return_shipment` |
| `supabase/queries/return/fn_mark_return_as_delivered.sql` | Removed | Replaced by `fn_mark_return_delivered` in sql.sql |
| `apps/frontend/core/hooks/useShipments.ts` | New | Hook returning `EnrichedShipment[]` for a given orderId |
| `apps/frontend/app/profile/orders/summary/[id].tsx` | New | Multi-seller order overview listing sub-cards per shipment |
| `apps/frontend/app/profile/orders/[id].tsx` | Modified | Accept `shipment_id` param, show per-shipment detail |
| `apps/frontend/core/hooks/useOrders.ts` | Modified | Add `enrichShipment`, permissions scoped to `shipment.status`, remove `return_shipped` dead code |
| `apps/frontend/core/hooks/useOrderActions.ts` | Modified | RPCs take `p_shipment_id`, remove `confirmReturnReceipt` dead mutation |
| `apps/frontend/components/features/orders/OrderActionCard.tsx` | Modified | Accept `shipment: EnrichedShipment`, actions per shipment |
| `packages/types/src/index.ts` | Modified | Add `Shipment`, `EnrichedShipment`, regenerate `database.types.ts` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Envia.com API breaking changes | Low | Keep current payload structure, add multi-origin as additive wrapper |
| Data inconsistency: shipments without matching order_items | Low | Backfill script in sql.sql already done; verify FK integrity before deploy |
| Existing orders without shipments (Fase 1-4 not run on prod) | High | **Blocking prerequisite** — Fases 1-4 MUST execute before deploying Fases 5-9 |
| RLS missing on shipments exposes seller/buyer data | Medium | Shipment RLS is Fase 9 — deploy BEFORE any Edge Function accesses shipments |
| `fn_complete_dispute_refund` (old) called from multiple paths | Medium | Keep old function for existing cron jobs; migrate point-by-point in order listed |
| Frontend routing break: existing deep links to `orders/[id]` | Low | `orders/[id]` stays as fallback; new `summary/[id]` is additive; detail screen checks for `shipment_id` param |

## Rollback Plan

Since each Fase is additive (SQL functions are `CREATE OR REPLACE`, Edge Functions are isolated):

1. **Edge Functions (Fase 5-6)**: Revert `supabase functions deploy` to previous version. Old order-level API paths untouched.
2. **SQL (Fase 8)**: Old `fn_complete_dispute_refund` still exists and works for single-seller orders. Drop new functions and restore old cron references.
3. **Frontend (Fase 7)**: New screen `summary/[id]` is additive — old `orders/[id]` unchanged. `useShipments` hook returns empty array if no shipments. Revert `useOrderActions`, `OrderActionCard` to previous commit.
4. **Types (Fase 9)**: `database.types.ts` regeneration is additive. Dropped columns can be re-added from migration backup. `fn_confirm_return_receipt` kept in codebase but marked deprecated.

**Database rollback**: ALWAYS backup before SQL execution. Old `orders` columns (tracking_number, label_url) keep their data until Fase 9 explicitly drops them — safe to revert at any point before that.

## Dependencies

1. **Fases 1-4 executed in production** (blocking — shipments table must exist with data)
2. **sql.sql Fase 4 functions deployed** (fn_mark_shipment_delivered, fn_complete_shipment_refund, etc.)
3. **Envia.com API keys** already configured in Supabase secrets
4. **Stripe webhook secret** correctly configured for production endpoint

## Success Criteria

- [ ] All 4 Edge Functions (Fase 5) deploy and produce correct multi-seller output
- [ ] Stripe checkout creates 1 order + N shipments for N distinct sellers
- [ ] Frontend shows multi-seller summary page when order has >1 seller
- [ ] `resolve-dispute-refund` accepts authenticated sellers (not just admins)
- [ ] Dispute crons operate at shipment-level without breaking existing disputes
- [ ] Shipments RLS restricts reads to buyer/seller/admin
- [ ] No `fn_confirm_return_receipt` references remain in codebase
- [ ] `tracking_number`, `label_url` columns dropped from `orders` (data migrated)
- [ ] `return_shipped` dead code removed from `useOrders.ts`
- [ ] `confirmReturnReceipt` dead mutation removed from `useOrderActions.ts`
