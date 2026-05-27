# Arquitectura Shipments (Multi-Seller) — Plan Completo v5

## Objetivo

Soportar órdenes con múltiples vendedores (multi-seller) mediante una tabla aditiva `shipments` que representa cada paquete/envío individual dentro de una orden. `orders` se mantiene como contenedor contable global.

## Principios

| Principio                        | Regla                                            |
| -------------------------------- | ------------------------------------------------ |
| **Aditivo, no sustitutivo**      | `orders` se queda igual, se agrega `shipments`   |
| **Contable primero**             | `orders` es el ancla financiera (Stripe, wallet) |
| **Logístico en shipments**       | tracking, label, status por paquete              |
| **FK con RESTRICT**              | Nunca CASCADE en tablas financieras              |
| **Trigger para status derivado** | No `MIN(enum)`, matriz de prioridades            |
| **Stripe refund por shipment**   | Amount explícito, no 100% automático             |
| **Zero Trust en RLS**            | `auth.uid()` + subquery, no funciones inventadas |

---

## Fase 1 — Tabla `shipments` + Migración de datos

### 1.1 Crear tabla

```sql
CREATE TABLE public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status order_status_enum NOT NULL DEFAULT 'paid',
  origin_address JSONB,
  tracking_number TEXT,
  label_url TEXT,
  carrier TEXT,
  envia_shipment_id TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_tracked_at TIMESTAMPTZ,
  return_tracking_number TEXT,
  return_label_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 1.2 Migrar datos existentes

```sql
INSERT INTO shipments (order_id, seller_id, status, ...)
SELECT DISTINCT ON (oi.order_id, oi.seller_id) ...
FROM order_items oi JOIN orders o ON o.id = oi.order_id
ORDER BY oi.order_id, oi.seller_id;
```

### 1.3-1.4 `order_items.shipment_id` + Backfill

```sql
ALTER TABLE order_items ADD COLUMN shipment_id UUID REFERENCES shipments(id) ON DELETE RESTRICT;
UPDATE order_items SET shipment_id = s.id FROM shipments s WHERE ...;
```

**Status:** ✅ Script listo en `sql.sql`

---

## Fase 2 — Migrar FKs en tablas existentes

| Tabla                 | FK nuevo      | Backfill                                        |
| --------------------- | ------------- | ----------------------------------------------- |
| `wallet_transactions` | `shipment_id` | JOIN con `wallets` + `seller_id` (determinista) |
| `disputes`            | `shipment_id` | `order_id + seller_id` contra shipments         |
| `reviews`             | `shipment_id` | `order_id + seller_id` contra shipments         |

**Status:** ✅ Script listo en `sql.sql`

---

## Fase 3 — Trigger de status derivado

```sql
CREATE FUNCTION fn_derive_order_status(p_order_id UUID) RETURNS order_status_enum AS $$
  -- 1. Excepcionales
  IF 'dispute'    = ANY(v_statuses) THEN RETURN 'dispute';  END IF;
  IF 'refunded'   = ANY(v_statuses) THEN RETURN 'refunded'; END IF;
  IF 'cancelled'  = ANY(v_statuses) THEN RETURN 'cancelled'; END IF;
  -- 2. Progreso (menos avanzado manda)
  IF 'paid'       = ANY(v_statuses) THEN RETURN 'paid';      END IF;
  IF 'preparing'  = ANY(v_statuses) THEN RETURN 'preparing'; END IF;
  IF 'shipped'    = ANY(v_statuses) THEN RETURN 'shipped';   END IF;
  IF 'delivered'  = ANY(v_statuses) THEN RETURN 'delivered'; END IF;
  -- 3. Todos completos
  IF 'completed'  = ALL(v_statuses) THEN RETURN 'completed'; END IF;
  RETURN 'paid';
$$ LANGUAGE plpgsql STABLE;

CREATE TRIGGER trg_shipments_status
  AFTER INSERT OR UPDATE OF status ON shipments
  FOR EACH ROW EXECUTE FUNCTION fn_shipments_status_trigger();
```

**Status:** ✅ Script listo en `sql.sql`

---

## Fase 4 — Funciones SQL transaccionales

| Función nueva                               | Reemplaza a              | Propósito                                                |
| ------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `fn_confirm_shipment_delivery`              | `fn_confirm_delivery`    | Buyer confirma recepción → libera fondos inmediato       |
| `fn_release_shipment_funds`                 | `fn_release_order_funds` | Libera fondos de pending a available (usa cron 48h)      |
| `fn_cancel_shipment`                        | Cancelación vieja        | Cancela un shipment individual                           |
| `fn_create_order_from_payment` (modificada) | —                        | Crea 1 order + N shipments por seller                    |
| `fn_seller_initiate_return_label`           | —                        | Seller paga return shipping (nuevo flujo)                |
| `fn_complete_shipment_refund`               | —                        | Refund por shipment con status guard                     |
| `fn_seller_confirm_return_shipment`         | —                        | ⚠️ Admin override SOLO (no flujo principal)              |
| `fn_mark_return_delivered`                  | —                        | Track-returns: marca dispute como `return_delivered`     |
| `fn_mark_shipment_delivered`                | —                        | Track-shipments: marca shipment como `delivered` (no libera) |
| `fn_cron_release_shipment_funds`            | —                        | Batch cron: auto-complete 48h para shipments delivered   |

**Status:** ✅ Script listo en `sql.sql`

---

## Fase 5 — Edge Functions de envíos (Envia.com)

### Flujo correcto: normal order

```
Cron track-shipments detecta "entregado"
  → fn_mark_shipment_delivered(shipment_id)
    → shipment.status = 'delivered', delivered_at = now()
    → NO libera fondos (arranca reloj 48h)
    → buyer confirma manual → liberación inmediata
    → ⏱️ 48h sin acción → fn_cron_release_shipment_funds libera automático
```

| Edge Function             | Cambio                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `get-shipping-quote`      | Multi-origen: input array de `[{ originZip, packageId, price, sellerId }]`                     |
| `generate-shipping-label` | Input `shipmentId`, guarda en `shipments`                                                      |
| `track-shipments` (cron)  | Lee `shipments(tracking_number)`, llama `fn_mark_shipment_delivered`                           |
| `track-returns` (cron)    | Lee `disputes(return_tracking_number)`, llama `fn_mark_return_delivered`                       |

**Status:** ⏳ Pendiente

---

## Fase 6 — Stripe / Checkout

| Componente                     | Cambio                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| `create-payment-intent`        | Agrupa carrito por seller, suma shipping costs             |
| `stripe-webhooks`              | Crea 1 order + N shipments + order_items con `shipment_id` |
| `fn_create_order_from_payment` | Crea shipments por seller distinto                         |

**Status:** ⏳ Pendiente

---

## Fase 7 — Frontend (multi-seller + fixes ROADMAP2)

### 7.1 Pantalla intermedia de resumen

| Archivo                                           | Cambio                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| `core/hooks/useShipments.ts` (NUEVO)              | Hook `useShipments(orderId)` → `EnrichedShipment[]` |
| `app/profile/orders/summary/[id].tsx` (NUEVA)     | Lista de sub-tarjetas por shipment                  |
| `app/profile/orders/detail/[id].tsx` (modificada) | Recibe `shipment_id`, usa `useShipmentById`         |
| `core/hooks/useOrders.ts` (modificada)            | `enrichShipment`, permisos contra `shipment.status` |
| `core/hooks/useOrderActions.ts` (modificada)      | RPC con `p_shipment_id`                             |
| `OrderActionCard.tsx` (modificada)                | Recibe `shipment: EnrichedShipment`                 |
| `packages/types/src/index.ts`                     | Agregar `Shipment`, `EnrichedShipment`              |

### 7.2 🔴 Bug 3 — Eliminar `return_shipped` dead code
### 7.3 🟡 Issue B — Eliminar `confirmReturnReceipt` dead mutation

**Status:** ⏳ Pendiente

---

## Fase 8 — Disputas y retornos (fixes ROADMAP2 + cleanup)

### 8.1 🔴 Bug 1 — Fix auth en `resolve-dispute-refund`
### 8.2 🔴 Bug 2 — Fix multi-seller refund en `fn_complete_dispute_refund`
### 8.3 🟡 Issue A — Eliminar `fn_confirm_return_receipt` (reemplazada)

### 8.4 Migrar crons existentes a shipment-level

| Cron existente                     | Usa función vieja         | Nueva función               |
| ---------------------------------- | ------------------------- | --------------------------- |
| `fn_cron_dispute_payout_timeout`   | `fn_release_order_funds`  | `fn_complete_shipment_refund` |
| `fn_cron_dispute_shipping_timeout` | `fn_release_order_funds`  | `fn_release_shipment_funds`   |
| `fn_resolve_dispute_to_seller`     | `UPDATE orders` directo   | Trigger de shipments se encarga |

**Status:** ⏳ Pendiente

---

## Fase 9 — RLS + Types + Limpieza

- RLS policies para `shipments` (SELECT con buyer/seller/is_admin)
- Regenerar `database.types.ts`
- Eliminar `fn_confirm_return_receipt` vieja
- Eliminar `confirmReturnReceipt` muerto de `useOrderActions.ts`
- Eliminar `fn_mark_return_as_delivered.sql` (reemplazado por `fn_mark_return_delivered`)

**Status:** ⏳ Pendiente

---

## Fase 10 — Cron timeout post-return-delivery (48h)

**CORRECCIÓN:** El timeout es **48h** (no 7 días), y llama a `fn_complete_shipment_refund` DIRECTAMENTE (no pasa por `fn_seller_confirm_return_shipment`, que queda solo como admin override).

### Flujo completo de retorno (resumen final)

```
Admin falla a favor del comprador
  → fn_resolve_dispute_to_buyer → status = 'waiting_return'
  → ⏱️ fn_cron_dispute_payout_timeout (48h)
    → ❌ seller no paga → buyer gana, refund

  → ✅ seller paga → create-return-intent
  → buyer genera guía → status = 'return_shipped'
  → ⏱️ fn_cron_dispute_shipping_timeout (48h)
    → ❌ buyer no envía → seller gana

  → ✅ buyer envía → track-returns
  → fn_mark_return_delivered → status = 'return_delivered'
  → ⏱️ fn_cron_return_delivery_timeout (48h)
    → seller abre counter-dispute (fn_resolve_dispute_to_seller, ✅ ya existe)
    → ❌ 48h sin acción → fn_complete_shipment_refund AUTO ✅
  → Admin override: fn_seller_confirm_return_shipment (solo para NetRunner)
```

### Subtareas

- [x] `fn_cron_return_delivery_timeout()` en `sql.sql`
- [x] `SELECT cron.schedule('return-delivery-timeout', '0 * * * *', ...)`
- [ ] `fn_seller_confirm_return_shipment` documentada como admin override

**Status:** ✅ Script listo en `sql.sql`
