# Design: Complete Multi-Seller Shipment Migration (Fases 5-9)

## Technical Approach

Migrate Envia.com Edge Functions, Stripe checkout, frontend UX, dispute resolution, and RLS from order-level to shipment-level. Each Fase is independently deployable but follows a strict dependency order: RLS first → Bug fixes → Edge Functions → Frontend → Cleanup last.

---

## FASE 5 — Edge Functions (Envia.com)

### 5.1 get-shipping-quote — Multi-origen

#### Data Flow
```
Client POST [{ originZip, packageId, price, sellerId }]
  → Zod validates array (min 1)
  → Group by unique originZip
  → For each group: call Envia /rate/ endpoint once
  → Aggregate results keyed by sellerId
  → Return { rates: { [sellerId]: ShippingOption[] } }
```

#### Key Logic
- Group items by `(originZip, sellerId)`. Same seller + same zip = one package.
- Loop over groups, call Envia rate API for each.
- Resilience: per-origin try/catch. If one origin fails, return `null` for that seller, continue for others.
- Fallback: unknown packageId → use `cpu_1` preset for that item.

#### Interface
```typescript
// NEW input schema
const QuoteItemSchema = z.object({
  originZip: z.string().length(5),
  packageId: z.string(),
  price: z.number().positive(),
  sellerId: z.string().uuid(),
});
const RequestSchema = z.object({
  items: z.array(QuoteItemSchema).min(1),
  destinationZip: z.string().length(5).optional(),
});

// NEW output
{ rates: Record<string, ShippingOption[] | null> }
// key = sellerId, null = origin failed
```

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/get-shipping-quote/index.ts` | Modify | Replace single-object schema with array, add per-origin loop, aggregate |

#### Key Decisions
- **Per-origin Envia calls** instead of batch: Envia API doesn't support multi-origin in one call. Accept the N+1 API cost (typical: 1-3 origins per cart).
- **Partial failure model**: If seller A's origin fails (Envia down), seller B still gets rates. Frontend shows "shipping unavailable" for A.
- **Backward compat**: Old `{ originZip, packageId, ... }` single-object still works — wrap in array internally with sellerId default. Actually, spec says no backward compat needed; frontend must send new format.

#### Security
- Same as today: service_role key reads `system_settings`, anonymous key for auth. No DB changes.
- Input validation rejects non-UUID sellerId, invalid zip codes.

#### Error Handling
| Error | Status | Response |
|-------|--------|----------|
| Invalid input array (empty, bad UUID) | 422 | Field-level Zod errors |
| Envia API down for origin X | 200 | `rates: { sellerId: null, ... }` with error in metadata |
| System config missing | 500 | MISSING_SERVER_CONFIG |
| All origins failed | 502 | CARRIER_ERROR |

---

### 5.2 generate-shipping-label — Shipment-level

#### Data Flow
```
Client POST { shipmentId, originAddress, shippingEvidence }
  → Auth check: user must be seller of shipment
  → Read shipment: validate status='paid', tracking_number IS NULL
  → Anti-fraud: count seller's shipments in preparing/shipped (query shipments not order_items)
  → Package dimensions from shipment's order_items products
  → Call Envia /generate/ endpoint
  → Update shipments row: status='preparing', tracking_number, label_url, carrier, envia_shipment_id, origin_address
  → Return { success, labelUrl, trackingNumber }
```

#### Interface
```typescript
// OLD: { orderId, originAddress, shippingEvidence }
// NEW:
const RequestSchema = z.object({
  shipmentId: z.string().uuid('ID de envío inválido'),
  originAddress: z.object({ /* same as before */ }),
  shippingEvidence: z.object({ images: z.array(z.string().url()) }),
});
```

#### Key Logic
- Replace `order.items.some(item => item.seller_id === user.id)` with `shipment.seller_id === user.id`
- Anti-fraud: query `shipments` not `order_items`:
  ```sql
  SELECT count(*) FROM shipments
  WHERE seller_id = user.id AND status IN ('preparing', 'shipped')
  ```
- Orphan tracking guard: if Envia succeeds but DB UPDATE fails, return 500 with tracking_number so user can retry.

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/generate-shipping-label/index.ts` | Modify | Schema input, table reads/writes, anti-fraud query all migrate to shipments |

#### Security
- Auth: `shipment.seller_id === user.id` OR admin
- RLS dependency: reads `shipments` via service_role (no RLS issue), but status transition validation relies on correct data in `shipments.status`.

#### Error Handling
| Error | Status | Response |
|-------|--------|----------|
| shipmentId not found | 404 | Envío no encontrado |
| tracking_number already set | 409 | La guía ya existe |
| status !== 'paid' | 422 | Solo se pueden generar guías de envíos pagados |
| seller doesn't own it | 403 | No tienes permiso |
| Anti-fraud limit reached | 429 | Límite de envíos activos alcanzado |

---

### 5.3 track-shipments cron

#### Data Flow
```
Cron trigger → service_role client
  → Query shipments WHERE status IN ('preparing','shipped') AND tracking_number IS NOT NULL
  → Batch of 50, order by last_tracked_at asc nullsFirst
  → Envia generaltrack/ API → for each delivered: fn_mark_shipment_delivered(shipment_id)
  → Update shipments.last_tracked_at for all tracked
```

#### Key Logic Change
- Old: `SELECT id, tracking_number, status FROM orders WHERE status IN ('preparing','shipped')`
- New: `SELECT id, tracking_number, status FROM shipments WHERE status IN ('preparing','shipped')`
- RPC call: `fn_mark_shipment_delivered(p_shipment_id)` instead of `fn_mark_as_delivered(p_order_id)`
- Logging uses `shipmentId` instead of `orderId`

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/track-shipments/index.ts` | Modify | All queries and RPC calls migrate to shipments |

#### Dependencies
- `fn_mark_shipment_delivered` already in sql.sql (Fase 4)
- OLD orders with tracking_number still in `orders` table → old `track-shipments` must run in PARALLEL until backfill verified

---

### 5.4 track-returns cron

Minimal change: replace RPC call from `fn_mark_return_as_delivered` → `fn_mark_return_delivered` (already in sql.sql Fase 4.8).

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/track-returns/index.ts` | Modify | Line 104-108: change RPC name |

---

## FASE 6 — Stripe / Checkout

### 6.1 create-payment-intent — Seller metadata

#### Data Flow
```
Client POST { productIds, addressId, idempotencyKey? }
→ fn_reserve_products (returns reservation with seller_id per product — VERIFY this)
→ Group reserved products by seller_id
→ Sum shipping costs per seller (products.shipping_cost, shipping_payer)
→ Add to metadata:
  - seller_ids: JSON.stringify([...unique seller IDs])
  - seller_shipping: JSON.stringify({ [sellerId]: shippingCost })
```

#### Key Decision
The `fn_reserve_products` RPC must return `seller_id` per product in its response. If it doesn't, add it. Let me check what it returns...

*Self-check: Not reading fn_reserve_products now — spec assumes it returns seller_id. If it doesn't, this needs a schema change or a JOIN after reservation.*

Metadata addition only — total amounts remain unchanged. The `seller_shipping` metadata tells `stripe-webhooks` how to attribute shipping costs per seller.

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/create-payment-intent/index.ts` | Modify | Add seller grouping + metadata after reservation (lines ~118-172) |

#### Security
- No change: buyer metadata is not sensitive for PaymentIntent metadata (Stripe metadata is readable by anyone with the PI ID, but IDs are secret)

---

### 6.2 stripe-webhooks — Verify fn_create_order_from_payment

**No code changes needed.** Verified in sql.sql Fase 4.4: `fn_create_order_from_payment` already:
1. Creates 1 order
2. Loops over DISTINCT seller_ids, creates 1 shipment per seller
3. Assigns each order_item to its shipment via `v_shipments_cache`

The webhook passes `product_ids` array — the function already handles multi-seller grouping.

#### Verification checklist
- [ ] `fn_reserve_products` returns `seller_id` per product
- [ ] Metadata `seller_ids` and `seller_shipping` passed from create-payment-intent

---

## FASE 7 — Frontend

### 7.1 useShipments hook

#### Data Flow
```
useShipments(orderId: string)
  → supabase.from('shipments').select(`
      *, items:order_items(*, product:products(*)),
      dispute:disputes(*),
      seller:profiles!seller_id(name, avatar_url)
    `).eq('order_id', orderId)
  → Enrich each shipment with permissions (isBuyer, isSeller, canGenerateLabel, etc.)
  → Return EnrichedShipment[]
```

#### Interface
```typescript
// In packages/types/src/index.ts
export interface EnrichedShipment extends Tables<'shipments'> {
  items: (Tables<'order_items'> & { product: Product })[];
  seller: Pick<Profile, 'id' | 'name' | 'avatar_url'> | null;
  dispute: (Tables<'disputes'> & {
    buyer_evidence: BuyerEvidence;
    seller_evidence: SellerEvidence;
  }) | null;
  isBuyer: boolean;
  isSeller: boolean;
  permissions: {
    canGenerateLabel: boolean;   // seller + status='paid' + no tracking
    canConfirmDelivery: boolean; // buyer + status in ('shipped','delivered')
    canCancel: boolean;          // status='paid'
    canReport: boolean;          // buyer + dispute window
    canPayReturn: boolean;       // seller + dispute.return_payout_status='pending'
    canUploadReturnEvidence: boolean; // buyer + dispute.return_label_url generated
    canReview: boolean;          // buyer + completed + no review
    showTracking: boolean;       // tracking_number not null
    showDeliveredBanner: boolean; // seller + status='delivered'
  };
}
```

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `apps/frontend/core/hooks/useShipments.ts` | Create | New hook file |
| `packages/types/src/index.ts` | Modify | Add `EnrichedShipment`, `Shipment = Tables<'shipments'>` |

#### Permission Model (reproduced from order-level, scoped to shipment)
- `canGenerateLabel`: `isSeller && shipment.status === 'paid' && !shipment.tracking_number`
- `canConfirmDelivery`: `isBuyer && ['shipped','delivered'].includes(shipment.status)`
- `canCancel`: `shipment.status === 'paid'`
- `canReport`: `isBuyer && !['dispute','cancelled','refunded','completed'].includes(shipment.status) && (shipment.status === 'shipped' || withinDisputeWindow)`
- `canPayReturn`: `isSeller && shipment.dispute?.return_payout_status === 'pending'`
- `canUploadReturnEvidence`: `isBuyer && shipment.dispute?.status === 'waiting_return' && shipment.dispute?.return_payout_status === 'paid' && !shipment.dispute?.return_label_url`
- `canReview`: `order.status === 'completed' && isBuyer && !dispute && !reviewExists && !isIgnored`

---

### 7.2 Orders summary screen

#### Navigation
```
/profile/orders/index.tsx → tap card → /profile/orders/[id].tsx (existing)
  → If order has >1 shipment, show banner "Esta orden tiene X envíos" with link to
  → /profile/orders/summary/[id].tsx (NEW)
```

#### Layout
```
┌─────────────────────────────────────┐
│ ← Orden #ABC12345                   │  ← ScreenHeader
│                                     │
│ Orden con 2 envíos                  │  ← Header
│ Total: $2,500                       │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Vendedor: tech_guy              │ │  ← OrderShipmentCard #1
│ │ GPU RTX 3080 — $15,000          │ │
│ │ Estado: En tránsito             │ │
│ │ Guía: 1234567890                │ │
│ │ [Rastrear] [Confirmar entrega]  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Vendedor: cpu_king              │ │  ← OrderShipmentCard #2
│ │ CPU Ryzen 7 — $8,000            │ │
│ │ Estado: Pagado                  │ │
│ │ [Generar guía]                  │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `apps/frontend/app/profile/orders/summary/[id].tsx` | Create | NEW screen |
| `apps/frontend/components/features/orders/OrderShipmentCard.tsx` | Create | Per-shipment card component |
| `apps/frontend/app/profile/orders/[id].tsx` | Modify | Add multi-shipment banner + `shipment_id` param handling |

---

### 7.3 OrderActionCard refactor

#### Current (order-level)
- `OrderActionCard` receives `order: EnrichedOrder`
- All actions use `order.id`, `order.dispute?.id`
- `confirmReturnReceipt` button uses `disputeId`

#### Target (shipment-aware)
- Add optional `shipment?: EnrichedShipment` prop
- When `shipment` is provided:
  - `generateLabel` → `{ shipmentId: shipment.id }`
  - `confirmDelivery` → via `fn_confirm_shipment_delivery(shipment_id)`
  - `resolveDisputeRefund` → via `{ disputeId: shipment.dispute.id }`
- When `shipment` is not provided → use order-level (backward compat)

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `apps/frontend/components/features/orders/OrderActionCard.tsx` | Modify | Accept `shipment` prop, conditional RPCs |
| `apps/frontend/core/hooks/useOrderActions.ts` | Modify | Add `generateLabel({ shipmentId })`, `confirmDelivery({ shipmentId })` overloads |

---

### 7.4 Bug 3 — Remove `return_shipped` dead code (Fixes ROADMAP2)

#### What to change
- `useOrders.ts` line 72: remove `isInTransit: isDispute && dispute?.status === 'return_shipped'`
- `useOrders.ts` line 79: remove `else if (phase.isInTransit) visualStatus = 'shipped'`
- `OrderActionCard.tsx` line 128-129: remove `if (dispute?.status === 'return_shipped')` block

---

### 7.5 Issue B — Remove `confirmReturnReceipt` dead mutation

Files to modify:
- `apps/frontend/core/hooks/useOrderActions.ts` — remove lines 166-177 (`confirmReturnReceipt` mutation) and lines 245-248 (return entry)
- `packages/types/src/index.ts` — remove `canConfirmReturnReceipt` from `EnrichedOrder.permissions`
- `apps/frontend/core/hooks/useOrders.ts` — remove `canConfirmReturnReceipt` from permissions (line 109-110)
- `apps/frontend/components/features/orders/OrderActionCard.tsx` — remove button rendering at line 227-241 (the `canConfirmReturnReceipt` block) and the marginBottom ternary at line 171

---

## FASE 8 — Disputas

### 8.1 Bug 1 — Fix auth in resolve-dispute-refund

#### Data Flow
```
POST { disputeId }
  → Auth: admin OR seller_of_dispute
  → Read dispute: get shipment_id, order_id
  → Validate: dispute.status IN ('return_delivered', 'waiting_return')
  → Get order_id from dispute
  → Stripe refund: refund the PaymentIntent (idempotent)
  → Call fn_complete_shipment_refund(p_shipment_id)
  → If dispute.shipment_id IS NULL → fallback to fn_complete_dispute_refund
```

#### Key Logic
```typescript
// Auth check: was `profile?.role !== 'admin'` → now:
const { data: dispute } = await supabaseAdmin
  .from('disputes')
  .select('seller_id, shipment_id, order_id, status')
  .eq('id', disputeId)
  .single();

const isAdmin = profile?.role === 'admin';
const isSeller = dispute.seller_id === user.id;
if (!isAdmin && !isSeller) throw new ApiError(403, 'No autorizado');
```

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/resolve-dispute-refund/index.ts` | Rewrite | Input `{ disputeId }`, auth check, status validation, shipment-level refund |

#### Error Handling
- `charge_already_refunded` → catch and continue (idempotent)
- `fn_complete_shipment_refund` fails after Stripe refund → CRITICAL log, return 500
- No shipment_id on dispute → fallback to old function

---

### 8.2 Bug 2 — Fix fn_complete_dispute_refund multi-seller

#### Problem
Line 9 in `fn_complete_dispute_refund.sql`:
```sql
SELECT SUM(net_payout) INTO v_net_payout_total
FROM public.order_items WHERE order_id = p_order_id;
```
This sums ALL items in the order, not just the disputed seller's.

#### Fix (Option A — Preferred)
Deprecate this function in favor of `fn_complete_shipment_refund`. If the dispute has a `shipment_id`, call the new function instead.

#### Fix (Option B — Fallback)
Add seller filter:
```sql
SELECT SUM(net_payout) INTO v_net_payout_total
FROM public.order_items
WHERE order_id = p_order_id
  AND seller_id = (SELECT seller_id FROM public.disputes WHERE id = p_dispute_id);
```

**Decision**: Use Option B as a safety net for pre-migration disputes that lack `shipment_id`, plus `resolve-dispute-refund` edge function will prefer `fn_complete_shipment_refund` for disputes with `shipment_id`.

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/queries/disputes/fn_complete_dispute_refund.sql` | Modify | Add seller_id filter + deprecation comment |

---

### 8.3 Remove fn_confirm_return_receipt

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/queries/return/fn_confirm_return_receipt.sql` | Delete | Remove file |
| Search for `fn_confirm_return_receipt` references | Verify | None remain after Fase 7.5 |

The replacement `fn_seller_confirm_return_shipment(p_shipment_id)` is already in sql.sql (Fase 4.6) with proper shipment-level auth + refund trigger.

---

### 8.4 Migrate crons to shipment-level

#### fn_cron_dispute_payout_timeout
Current: marks resolved, no refund call.
Fix: after resolving, if dispute has `shipment_id`, call `fn_complete_shipment_refund(v_dispute.shipment_id)`.

```sql
-- NEW: after the UPDATE disputes SET status='resolved' block
IF v_dispute.shipment_id IS NOT NULL THEN
  PERFORM * FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);
END IF;
```

#### fn_cron_dispute_shipping_timeout
Current: calls `fn_release_order_funds(v_dispute.order_id)`.
Change: replace with `fn_release_shipment_funds(v_dispute.shipment_id)` when shipment_id exists, fallback to old for pre-migration.

```sql
-- REPLACE line 24
IF v_dispute.shipment_id IS NOT NULL THEN
  PERFORM * FROM public.fn_release_shipment_funds(v_dispute.shipment_id);
ELSE
  PERFORM public.fn_release_order_funds(v_dispute.order_id);
END IF;
```

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/queries/disputes/fn_cron_dispute_payout_timeout.sql` | Modify | Add refund call for shipment_id disputes |
| `supabase/queries/disputes/fn_cron_dispute_shipping_timeout.sql` | Modify | Replace release function |

---

### 8.5 Fix fn_resolve_dispute_to_seller — remove direct orders UPDATE

#### Problem
Line 71: `UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id;`
This bypasses the `fn_shipments_status_trigger` on `shipments`.

#### Fix
- Remove the `UPDATE orders` line.
- If the dispute has a `shipment_id`, update `shipments.status = 'completed'` → trigger propagates to order.
- If `shipment_id IS NULL` (pre-migration), keep the `UPDATE orders` as fallback.

```sql
-- REPLACE line 71 with:
IF v_shipment_id IS NOT NULL THEN
  UPDATE public.shipments SET status = 'completed', updated_at = now()
  WHERE id = v_shipment_id;
ELSE
  UPDATE public.orders SET status = 'completed', updated_at = now()
  WHERE id = v_order_id;
END IF;
```

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/queries/disputes/fn_resolve_dispute_to_seller.sql` | Modify | Add shipment-level status update, keep old fallback |

---

## FASE 9 — RLS + Types + Cleanup

### 9.1 RLS policies for shipments

#### Policies
```sql
-- Enable RLS
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- SELECT: buyer sees their order's shipments, seller sees their own shipments, admin sees all
CREATE POLICY "shipments_select_buyer" ON public.shipments
  FOR SELECT USING (
    order_id IN (SELECT id FROM public.orders WHERE buyer_id = auth.uid())
  );

CREATE POLICY "shipments_select_seller" ON public.shipments
  FOR SELECT USING (seller_id = auth.uid());

CREATE POLICY "shipments_select_admin" ON public.shipments
  FOR SELECT USING (is_admin());

-- INSERT: only service_role (Edge Functions create shipments)
CREATE POLICY "shipments_insert_service_role" ON public.shipments
  FOR INSERT WITH CHECK (false);  -- blocked for authenticated, only service_role bypasses RLS

-- UPDATE: seller updates their own shipment status/tracking, admin updates any
CREATE POLICY "shipments_update_seller" ON public.shipments
  FOR UPDATE USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid() AND status IN ('paid', 'preparing', 'shipped'));

CREATE POLICY "shipments_update_admin" ON public.shipments
  FOR UPDATE USING (is_admin());

-- DELETE: none
```

#### Key Design Decision
- Seller can UPDATE only `status`, `tracking_number`, `label_url`, `origin_address` — the RLS `WITH CHECK` allows status in `('paid','preparing','shipped')` but NOT `delivered`, `completed`, `refunded`, etc.
- Service_role (Edge Functions) bypasses RLS entirely — they must always use service_role client for shipment mutations that change financial statuses.

#### File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/XXXXX_shipments_rls.sql` | Create | RLS policies |

---

### 9.2 Types regeneration + new exports

#### Steps
1. Run `supabase gen types typescript --local > packages/types/src/database.types.ts`
2. Add exports in `packages/types/src/index.ts`:

```typescript
export type Shipment = Tables<'shipments'>;
export interface EnrichedShipment extends Tables<'shipments'> {
  items: (Tables<'order_items'> & { product: Product })[];
  seller: Pick<Profile, 'id' | 'name' | 'avatar_url'> | null;
  dispute: (Dispute & { buyer_evidence: BuyerEvidence; seller_evidence: SellerEvidence }) | null;
  isBuyer: boolean;
  isSeller: boolean;
  permissions: {
    canGenerateLabel: boolean;
    canConfirmDelivery: boolean;
    canCancel: boolean;
    canReport: boolean;
    canPayReturn: boolean;
    canUploadReturnEvidence: boolean;
    canReview: boolean;
    showTracking: boolean;
    showDeliveredBanner: boolean;
  };
}
```

Also remove `canConfirmReturnReceipt` from `EnrichedOrder.permissions`.

---

### 9.3 Drop migrated columns from orders

```sql
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS tracking_number,
  DROP COLUMN IF EXISTS label_url,
  DROP COLUMN IF EXISTS last_tracked_at,
  DROP COLUMN IF EXISTS shipping_evidence,
  DROP COLUMN IF EXISTS origin_address;
```

**Pre-condition**: Search entire codebase for `orders.tracking_number`, `orders.label_url`, etc. Ensure all references migrated to `shipments.*`.

---

### 9.4 Dead functions cleanup

```sql
DROP FUNCTION IF EXISTS public.fn_mark_as_delivered(p_order_id UUID);
DROP FUNCTION IF EXISTS public.fn_mark_return_as_delivered(p_dispute_id UUID);
DROP FUNCTION IF EXISTS public.fn_release_order_funds(p_order_id UUID);
DROP FUNCTION IF EXISTS public.fn_complete_dispute_refund(p_order_id UUID, p_dispute_id UUID);
DROP FUNCTION IF EXISTS public.fn_confirm_return_receipt(p_dispute_id UUID);
```

**Pre-condition**: Verify via `pg_proc` that no cron or trigger references these. Keep as deprecated stubs for one release cycle if safety concern.

---

## Architecture Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| RLS deployment order | Deploy BEFORE Fase 5 Edge Functions | Edge Functions use service_role bypass, but frontend reads shipments with user auth — needs RLS |
| Partial failure model for quotes | Per-origin try/catch, return null per seller | Better UX: buyer still sees rates for available sellers |
| Fallback for pre-migration disputes | Keep old functions as fallback when shipment_id IS NULL | Old disputes (created before Fase 3) don't have shipment_id — must still work |
| Anti-fraud in generate-shipping-label | Query `shipments` table instead of `order_items` | Mirrors the same logic, now scoped per shipment |
| Seller can UPDATE shipment status | RLS allows `status IN ('paid','preparing','shipped')` | Prevents seller from self-completing or self-refunding — only service_role can do financial transitions |

## Execution Order

1. **Fase 9.1** — RLS for shipments (deploy FIRST)
2. **Fase 8.1** — Fix auth in resolve-dispute-refund
3. **Fase 8.2** — Fix fn_complete_dispute_refund (seller filter)
4. **Fase 8.5** — Fix fn_resolve_dispute_to_seller (remove direct orders UPDATE)
5. **Fase 8.4** — Migrate crons (payout_timeout + shipping_timeout)
6. **Fase 8.3** — Delete fn_confirm_return_receipt (after all callers migrated)
7. **Fase 5.1** — get-shipping-quote (multi-origin)
8. **Fase 5.2** — generate-shipping-label (shipment-level)
9. **Fase 5.3** — track-shipments cron (query shipments)
10. **Fase 5.4** — track-returns cron (update RPC name)
11. **Fase 6.1** — create-payment-intent (seller metadata)
12. **Fase 6.2** — Verify stripe-webhooks (no change expected)
13. **Fase 7.1-7.3** — Frontend (useShipments, summary screen, OrderActionCard)
14. **Fase 7.4-7.5** — Bug fixes (dead code removal)
15. **Fase 9.2** — Regenerate types (after all SQL deployed)
16. **Fase 9.3** — Drop old columns (last, after all code references migrated)
17. **Fase 9.4** — Cleanup dead functions (absolute last)

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (Edge Functions) | Input validation, auth checks, Envia API calls | Mock Envia API, test each status code path |
| Integration (SQL) | RLS policies, trigger derivation, refund functions | Supabase local DB with test data, assert correct rows |
| E2E (Full flow) | Multi-seller purchase → shipments created → labels generated → tracking → delivery | Local Supabase + Stripe test keys |
| Frontend | useShipments hook data shape, permission logic, screen rendering | React Testing Library + MSW for Supabase mock |

## Open Questions

- [ ] Does `fn_reserve_products` return `seller_id`? If not, add it or do a post-reservation JOIN.
- [ ] Old `track-shipments` and new `track-shipments` — run in parallel until backfill confirmed? Or one-time migration?
- [ ] `ShippingRouteCard` (line 28) references `order.origin_address` — old column will be dropped. Must migrate to read from `shipments[0].origin_address`. How to handle multi-shipment orders? Show route per shipment?

## Files Affected

| Action | Count |
|--------|-------|
| Create | 5 files |
| Modify | 18 files |
| Delete | 1 file (sql) + dead frontend code |

## Next Step
Ready for tasks (sdd-tasks).
