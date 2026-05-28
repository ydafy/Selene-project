# SPECS — Shipments Architecture Implementation Tracker

> Archivo vivo para rastrear el progreso de la migración a multi-seller vía `shipments`.
>
> ✅ = Completado | 🔄 = En progreso | ⏳ = Pendiente

---

## Fase 1 — Tabla `shipments` + Migración de datos

- [x] `sql.sql` creado con Fase 1 + Fase 2 + Fase 3 + Fase 4
- [x] `CREATE TABLE public.shipments` con todas las columnas
- [x] Índices `idx_shipments_order_id` y `idx_shipments_seller_id`
- [x] Migración de datos históricos (1 shipment por seller por orden)
- [x] `ALTER order_items ADD COLUMN shipment_id`
- [x] Backfill de `order_items.shipment_id`
- [x] Regenerar `database.types.ts` con `supabase gen types`

---

## Fase 2 — Migrar FKs en tablas existentes

- [x] `ALTER wallet_transactions ADD COLUMN shipment_id` + backfill determinista
- [x] `ALTER disputes ADD COLUMN shipment_id` + backfill
- [x] `ALTER reviews ADD COLUMN shipment_id` + backfill
- [x] Índices para FKs (idx_order_items_shipment_id, idx_wallet_transactions_shipment_id, idx_disputes_shipment_id, idx_reviews_shipment_id)
- [x] Verificar: joins correctos, sin NULLs inesperados

---

## Fase 3 — Trigger de status derivado

- [x] Crear `fn_derive_order_status(p_order_id)` con matriz de prioridades
- [x] Crear `fn_shipments_status_trigger()` + `trg_shipments_status`
- [x] Ejecutar Fase 3 en Supabase SQL Editor
- [ ] Probar: actualizar status de un shipment → order.status cambia correctamente
- [ ] Probar caso multi-seller: delivered + preparing → order = preparing

---

## Fase 4 — Funciones SQL transaccionales

- [x] `fn_confirm_shipment_delivery(p_shipment_id)`
  - [x] Libera solo el net_payout de ese shipment
  - [x] `shipment.status = 'completed'`, `completed_at = now()`
  - [x] Trigger actualiza order.status automáticamente
- [x] `fn_release_shipment_funds(p_shipment_id)` — cron auto-release 48h
- [x] `fn_cancel_shipment(p_shipment_id, p_cancelled_by_role, p_reason)`
- [x] `fn_create_order_from_payment` modificada (crea order + N shipments)
- [x] `fn_seller_initiate_return_label(p_dispute_id, p_caller_id)` — validación centralizada + auditoría
- [x] `fn_complete_shipment_refund(p_shipment_id)` — refund por shipment + status guard
- [x] `fn_seller_confirm_return_shipment(p_shipment_id)` — **admin override** (no flujo principal)
- [x] `fn_mark_return_delivered(p_dispute_id)` — track-returns: marca dispute `return_delivered` + notifica
- [x] `fn_mark_shipment_delivered(p_shipment_id)` — track-shipments: marca `delivered`, NO libera fondos
- [x] `fn_cron_release_shipment_funds()` — batch cron 48h para normal deliveries
- [x] `SELECT cron.schedule('release-shipment-funds', '0 * * * *', ...)`
- [ ] Ejecutar Fase 4 en Supabase SQL Editor

---

## Fase 5 — Edge Functions de envíos (Envia.com)

### Flujo normal

```
track-shipments → fn_mark_shipment_delivered → status = 'delivered'
  → NO libera fondos (arranca reloj 48h)
  → fn_cron_release_shipment_funds libera automático a las 48h
```

- [ ] `get-shipping-quote`: input multi-origen `[{ originZip, packageId, price, sellerId }]`
- [ ] `generate-shipping-label`: input `shipmentId`, guarda en `shipments`
- [ ] `track-shipments` cron: lee `shipments(tracking_number)`, llama `fn_mark_shipment_delivered`
- [ ] `track-returns` cron: lee `disputes(return_tracking_number)`, llama `fn_mark_return_delivered`

---

## Fase 6 — Stripe / Checkout

- [ ] `create-payment-intent`: agrupa carrito por seller, suma shipping
- [ ] `stripe-webhooks`: crea 1 order + N shipments con items
- [ ] `fn_create_order_from_payment`: inserta shipments por seller

---

## Fase 7 — Frontend (multi-seller + fixes ROADMAP2)

### 7.1 Nueva funcionalidad

- [ ] `core/hooks/useShipments.ts` — hook nuevo
- [ ] `app/profile/orders/summary/[id].tsx` — pantalla intermedia
- [ ] `app/profile/orders/detail/[id].tsx` — recibe `shipment_id`
- [ ] `core/hooks/useOrders.ts` — `enrichShipment`, permisos por shipment
- [ ] `core/hooks/useOrderActions.ts` — RPC con `p_shipment_id`
- [ ] `OrderActionCard.tsx` — recibe `shipment: EnrichedShipment`
- [ ] `packages/types/src/index.ts` — agregar `Shipment`, `EnrichedShipment`

### 7.2 🔴 Bug 3 — Dead code `return_shipped`
- [ ] Eliminar `dispute?.status === 'return_shipped'` de `useOrders.ts:72`

### 7.3 🟡 Issue B — Dead mutation `confirmReturnReceipt`
- [ ] Eliminar mutation `confirmReturnReceipt` de `useOrderActions.ts:166-177`

---

## Fase 8 — Disputas y retornos (fixes ROADMAP2 + cleanup)

### 8.1 🔴 Bug 1 — Auth en `resolve-dispute-refund`
- [ ] Cambiar auth check: permitir admin O seller de la dispute
- [ ] Agregar validación `dispute.status IN ('return_delivered', 'waiting_return')`

### 8.2 🔴 Bug 2 — Multi-seller refund
- [ ] Fix `fn_complete_dispute_refund.sql`: filtrar `order_items WHERE seller_id = v_seller_id`

### 8.3 🟡 Issue A — `fn_confirm_return_receipt` (eliminar, reemplazada por `fn_seller_confirm_return_shipment`)

### 8.4 Migrar crons existentes a shipment-level

- [ ] `fn_cron_dispute_payout_timeout`: usar `fn_complete_shipment_refund` en vez de `fn_release_order_funds`
- [ ] `fn_cron_dispute_shipping_timeout`: usar `fn_release_shipment_funds` (por shipment) en vez de `fn_release_order_funds`
- [ ] `fn_resolve_dispute_to_seller`: delegar en trigger de shipments en vez de `UPDATE orders` directo

---

## Fase 9 — RLS + Types + Limpieza

- [ ] RLS policies para `shipments` (SELECT con buyer/seller/is_admin)
- [ ] Regenerar `database.types.ts`
- [ ] `export type Shipment = Tables<'shipments'>` en types
- [ ] `EnrichedShipment` interface
- [ ] Dropear columnas migradas de `orders` (tracking_number, label_url, etc.)
- [ ] Eliminar `fn_confirm_return_receipt` (reemplazada)
- [ ] Eliminar `confirmReturnReceipt` de `useOrderActions.ts`
- [ ] Eliminar `supabase/queries/return/fn_mark_return_as_delivered.sql` (reemplazado por `fn_mark_return_delivered`)
- [ ] Verificar RLS existentes no rotas

---

## Fase 10 — Cron timeout post-return-delivery (48h)

> ⚠️ Timeout corregido: **48h** (no 7 días). Llama a `fn_complete_shipment_refund` DIRECTAMENTE.

- [x] `fn_cron_return_delivery_timeout()` — busca disputes en `return_delivered` > 48h
- [x] Ejecuta `fn_complete_shipment_refund(shipment_id)` por cada una (NO via `fn_seller_confirm_return_shipment`)
- [x] Notifica buyer + seller
- [x] `SELECT cron.schedule('return-delivery-timeout', '0 * * * *', ...)`
