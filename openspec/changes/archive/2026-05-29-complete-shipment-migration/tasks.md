# Tasks: Complete Multi-Seller Shipment Migration

> 📍 **Tracker activo** — único archivo para seguir progreso
> 📖 Referencia de arquitectura → `plan.md`
> 🔄 Última actualización: PR 4 completado + gaps detectados

## Review Workload Forecast

| Field                   | Value                |
| ----------------------- | -------------------- |
| Estimated changed lines | ~1,400               |
| 400-line budget risk    | High                 |
| Chained PRs recommended | Yes                  |
| Suggested split         | 4 stacked PRs → main |
| Delivery strategy       | ask-on-risk          |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                     | Likely PR | Notes                 |
| ---- | ------------------------ | --------- | --------------------- |
| 1    | RLS + Bug fixes          | PR 1      | ~300 lines, base=main |
| 2    | Envia EFs + Stripe       | PR 2      | ~450 lines, base=main |
| 3    | Frontend                 | PR 3      | ~450 lines, base=main |
| 4    | Cron migration + Cleanup | PR 4      | ~150 lines, base=main |

**Note**: `fn_reserve_products` returns (SUM,bool,TEXT) — does NOT return seller_id. Task 3.1 must query `products` separately after reservation.

---

## PR 1 — RLS + Bug Fixes (Fase 9.1 + 8.1, 8.2, 8.5)

Skills: supabase, supabase-postgres-best-practices, stripe-best-practices

- [x] 1.1 Create `migrations/*_shipments_rls.sql` — enable RLS, SELECT policies (buyer via order.buyer_id, seller via seller_id, admin), UPDATE policy for seller own status/tracking, INSERT blocked for authenticated
- [x] 1.2 Rewrite `functions/resolve-dispute-refund/index.ts` — input `{ disputeId }`, auth (admin OR dispute.seller_id), validate status, call `fn_complete_shipment_refund`, refund Stripe PI
- [x] 1.3 Fix `queries/disputes/fn_complete_dispute_refund.sql` — add seller_id filter to order_items SUM + deprecation comment
- [x] 1.4 Fix `queries/disputes/fn_resolve_dispute_to_seller.sql` — replace `UPDATE orders` with `UPDATE shipments` when shipment_id exists

## PR 2 — Edge Functions + Stripe (Fase 5 + 6)

Skills: supabase, stripe-best-practices

- [x] 2.1 Modify `functions/get-shipping-quote/index.ts` — accept items[] array, group by (originZip+sellerId), per-group Envia call, return `{rates:{[sellerId]:...}}` with per-origin error isolation
- [x] 2.2 Modify `functions/generate-shipping-label/index.ts` — input `{ shipmentId, originAddress, shippingEvidence }`, validate shipments row (status=paid, seller owns, no tracking), update shipments, anti-fraud on shipments table
- [x] 2.3 Modify `functions/track-shipments/index.ts` — query shipments instead of orders, map Envia "Recibido en oficina"/"Recolectado"/"En tránsito" → `shipped`, call `fn_mark_shipment_delivered` on "delivered", bulk update last_tracked_at
- [x] 2.4 Modify `functions/track-returns/index.ts` — rename RPC call to `fn_mark_return_delivered`
- [x] 2.5 Modify `functions/create-payment-intent/index.ts` — query products for seller_id/shipping_cost after fn_reserve_products, add seller_ids + seller_shipping to PI metadata
- [x] 2.6 Verify `functions/stripe-webhooks/index.ts` — confirm fn_create_order_from_payment creates N shipments for N sellers (no code change expected)

## PR 3 — Frontend (Fase 7 + Bug 3 + Issue B)

Skills: building-native-ui, native-data-fetching, typescript-advanced-types, design-mobile-apps

- [x] 3.1 Add `Shipment` + `EnrichedShipment` types to `packages/types/src/index.ts`
- [x] 3.2 Create `hooks/useShipments.ts` — fetch shipments joined with order_items/products/seller/dispute, enrich with permissions
- [x] 3.3 Modify `app/profile/orders/[id].tsx` — multi-shipment banner + optional shipment_id param
- [x] 3.4 Create `app/profile/orders/summary/[id].tsx` — multi-seller order overview with OrderShipmentCard list
- [x] 3.5 Create `components/features/orders/OrderShipmentCard.tsx` — per-shipment card with status, tracking, actions
- [x] 3.6 Modify `OrderActionCard.tsx` — accept optional shipment prop, route actions to shipment-level RPCs
- [x] 3.7 Modify `hooks/useOrderActions.ts` — add generateLabel({shipmentId}) + confirmDelivery({shipmentId}) overloads
- [x] 3.8 Modify `hooks/useOrders.ts` — remove isInTransit (Bug 3) + canConfirmReturnReceipt (Issue B)
- [x] 3.9 Modify `hooks/useOrderActions.ts` — remove confirmReturnReceipt mutation
- [x] 3.10 Modify `OrderActi    onCard.tsx` — remove canConfirmReturnReceipt button block
- [x] 3.11 Modify `packages/types/src/index.ts` — remove canConfirmReturnReceipt from EnrichedOrder.permissions

## PR 4 — Cron Migration + Cleanup (Fase 8.3, 8.4 + Fase 9.2-9.4)

Skills: supabase, bun

- [x] 4.1 Fix `queries/disputes/fn_cron_dispute_payout_timeout.sql` — add `fn_complete_shipment_refund(shipment_id)` call after marking resolved
- [x] 4.2 Fix `queries/disputes/fn_cron_dispute_shipping_timeout.sql` — replace `fn_release_order_funds` with `fn_release_shipment_funds` (fallback for pre-migration)
- [x] 4.3 Delete `queries/return/fn_confirm_return_receipt.sql` — confirm zero references remain via grep
- [x] 4.4 Regenerate `packages/types/src/database.types.ts` via `bun db:types`
- [x] 4.5 Create migration to DROP `tracking_number, label_url, last_tracked_at, shipping_evidence, origin_address` from orders
- [x] 4.6 Create migration to DROP `fn_mark_as_delivered, fn_mark_return_as_delivered, fn_release_order_funds, fn_complete_dispute_refund, fn_confirm_return_receipt`
- [x] 4.7 Grep codebase for any remaining references to dead functions/columns; clean up any found
- [x] 4.8 Verify `fn_derive_order_status` trigger: update shipment status → order.status reflects correctly (test multi-seller: delivered + preparing → order = preparing)
- [x] 4.9 Fix `fn_log_return_payment.sql` — add IF NOT FOUND RAISE EXCEPTION, shipment_id in ledger, REVOKE/GRANT for service_role
- [x] 4.10 Create `auto-cancel-preparing` cron — cancel shipments in `preparing` > 96h without carrier scan (safety net after track-shipments mapping)
- [x] 4.11 Migrate `auto-cancel-orders` to shipment-level — replace `orders.tracking_number IS NULL` with check against shipments table (no shipment has tracking → cancel)
- [x] 4.12 Update `fn_seller_confirm_return_shipment` docstring — clarify admin override ONLY, no flujo principal
- [x] 4.13 Fix `auto-cancel-orders` — replace HTTP call to `cancel-order` Edge Function (auth fails + cancels whole order) with Stripe partial refund per shipment + `fn_cancel_shipment` RPC direct
- [x] 4.14 Fix `auto-cancel-preparing` — same fix as 4.13 plus use `preparing_expiration_hours` config (default 72h) instead of reusing `order_expiration_hours` (48h) to absorb weekends
- [x] 4.15 Add `preparing_expiration_hours` column to `system_settings` (default 72) — separate config for preparing timeout
- [x] 4.16 Add concurrent execution lock (`auto_cancel_orders_running`, `auto_cancel_preparing_running`) to auto-cancel crons
- [x] 4.17 Add CRITICAL log level for "Stripe refund OK but DB cancel failed" in both auto-cancel crons
- [x] 4.18 Add migration `20260529000001_add_concurrent_lock_columns.sql` for lock columns on `system_settings`

## PR 5 — Safety Nets Faltantes (Fase 10 + Crons)

Skills: supabase, stripe-best-practices

- [x] 5.1 Create `supabase/queries/disputes/fn_cron_return_delivery_timeout.sql` — SQL function completa con FOR UPDATE SKIP LOCKED, REVOKE/GRANT service_role
- [x] 5.2 Fix `supabase/queries/triggers/shipments/fn_cron_release_shipment_funds.sql` — agregar CREATE OR REPLACE wrapper + REVOKE/GRANT (antes solo tenía el body sin signature)
- [x] 5.3 Create Edge Function `supabase/functions/return-delivery-timeout/index.ts` — llama `fn_cron_return_delivery_timeout()` via RPC, con lock concurrente (`return_delivery_timeout_running` en system_settings), libera en éxito Y catch
- [x] 5.4 Add concurrent lock + CRITICAL error handling to `supabase/functions/release-funds/index.ts` — `release_funds_running` lock, mejor manejo de GRACE_PERIOD_ACTIVE y SHIPMENT_IN_ACTIVE_DISPUTE como INFO (no ERROR), CRITICAL para fallos reales
- [x] 5.5 Create migration `20260529000002_add_cron_lock_columns.sql` — add `return_delivery_timeout_running` + `release_funds_running` BOOLEAN DEFAULT false to `system_settings`
- [x] 5.6 Change `delivered_at` filter in `release-funds` — use `delivered_at` instead of `updated_at` (was incorrectly using `updated_at`, 48h grace is from delivery not from last update)
- [x] 5.7 Execute `fn_cron_return_delivery_timeout` SQL on Supabase dashboard (copiar de `supabase/queries/disputes/fn_cron_return_delivery_timeout.sql`)
- [x] 5.8 Execute `fn_cron_release_shipment_funds` SQL on Supabase dashboard (copiar de `supabase/queries/triggers/shipments/fn_cron_release_shipment_funds.sql`) — verify it replaces existing version
- [x] 5.9 Execute migration `20260529000002_add_cron_lock_columns.sql` on Supabase dashboard
- [x] 5.10 Execute migration `20260529000000_add_preparing_expiration_hours.sql` on Supabase dashboard (if not done yet)
- [x] 5.11 Execute migration `20260529000001_add_concurrent_lock_columns.sql` on Supabase dashboard (if not done yet)
- [x] 5.12 Deploy `return-delivery-timeout` Edge Function via `supabase functions deploy return-delivery-timeout`
- [x] 5.13 Re-deploy `release-funds` Edge Function via `supabase functions deploy release-funds`
- [x] 5.14 Deploy `auto-cancel-orders` and `auto-cancel-preparing` Edge Functions (if not done yet)
- [x] 5.15 Run `bun db:types` after all dashboard changes

## Notas sobre lo que ya está

- `fn_cron_release_shipment_funds` SQL ✅ — archivo arreglado con CREATE OR REPLACE completo en `supabase/queries/triggers/shipments/`
- `fn_cron_return_delivery_timeout` SQL ✅ — archivo nuevo en `supabase/queries/disputes/`
- `return-delivery-timeout` Edge Function ✅ — creada en `supabase/functions/return-delivery-timeout/index.ts` con lock concurrente
- `release-funds` Edge Function ✅ — lock concurrente + CRITICAL logging + delivered_at fix
- `auto-cancel-orders` y `auto-cancel-preparing` Edge Functions ✅ — con lock concurrente + CRITICAL logging
- `sql.sql` ya NO es la fuente de verdad — usar los archivos en `supabase/queries/` para dashboard
