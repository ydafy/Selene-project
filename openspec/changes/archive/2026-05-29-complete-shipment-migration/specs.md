# SDD Delta Specs: Shipment Migration (Fases 5-9)

---

## FASE 5 — Edge Functions de Envíos (Envia.com)

### 5.1 Capability: get-shipping-quote

**Current state**: `get-shipping-quote/index.ts` accepts single `{ originZip, packageId, destinationZip?, price }`. Single-origin, single-package. Returns `{ rates: [winner] }`.

**Target state**: Accept multi-origin array `[{ originZip, packageId, price, sellerId }]`. Calls Envia.com `rate/` endpoint per origin (or batches if Envia API supports). Returns `{ rates: { [sellerId]: ShippingOption[] } }`.

**Affected files**:
- `supabase/functions/get-shipping-quote/index.ts` — schema, logic, response

**Scenarios**:
1. **Single seller, single item** — Input `[{ originZip: "06500", packageId: "gpu_1", price: 15000, sellerId: "uuid-a" }]`. Returns rates keyed by sellerId. Same behavior as today for single-seller carts.
2. **Multi-seller, 3 items** — Input `[{ originZip: "06500", packageId: "gpu_1", price: 15000, sellerId: "uuid-a" }, { originZip: "45030", packageId: "cpu_1", price: 8000, sellerId: "uuid-b" }]`. Calls Envia twice (one per unique originZip). Returns `{ rates: { "uuid-a": [...], "uuid-b": [...] } }`.
3. **Unknown package preset** — Falls back to `cpu_1` preset per seller, logs warning, continues.

**Edge cases**:
- Same seller multiple items → single quote (one package grouping)
- Seller has no `originZip` on product → 422 with field-level error
- Envia API down for one origin → partial failure: other sellers still get rates, failed one gets `null` with error reason
- Empty array → 422

**Dependencies**: None.

---

### 5.2 Capability: generate-shipping-label

**Current state**: `generate-shipping-label/index.ts` accepts `{ orderId, originAddress, shippingEvidence }`. Validates against `orders` table (status, tracking_number). Updates `orders.status = 'preparing'` + `orders.tracking_number` + `orders.label_url`. Anti-fraud limit is per-order (order_items grouped).

**Target state**: Accept `{ shipmentId, originAddress, shippingEvidence }`. Validates against `shipments` table. Validates `shipments.status = 'paid'`. `shipments.tracking_number` must be null. Seller must own the shipment. Updates `shipments.status = 'preparing'`, `shipments.tracking_number`, `shipments.label_url`, `shipments.carrier`, `shipments.origin_address`. Anti-fraud limit based on seller's completed shipments (same logic, but queries `shipments`).

**Affected files**:
- `supabase/functions/generate-shipping-label/index.ts` — schema, table reads, updates

**Scenarios**:
1. **Seller generates label for their shipment** — Input `{ shipmentId, originAddress, shippingEvidence }`. Shipment is `paid`, seller owns it. Updates `shipments` row, returns `labelUrl`. Backward compat: old `orderId` param returns clear error "use shipmentId".
2. **Seller tries label on already-labeled shipment** — `shipments.tracking_number` not null → 409 "La guía ya existe".
3. **Seller tries label on another seller's shipment** — `shipments.seller_id !== user.id` → 403.

**Edge cases**:
- Order-level `orders.tracking_number` still exists after migration → leave untouched, new labels go to `shipments.tracking_number`
- Envia API generates label but DB update fails → log orphan tracking, return 500 with tracking number
- Anti-fraud: query `shipments` instead of `order_items` for active count

**Dependencies**: Fase 9 RLS must be deployed first (service_role bypasses RLS, but the auth check in the Edge Function reads `shipments`).

---

### 5.3 Capability: track-shipments cron

**Current state**: `track-shipments/index.ts` queries `orders(tracking_number, status)` for orders in `preparing`/`shipped` with `tracking_number IS NOT NULL`. Calls `fn_mark_as_delivered(p_order_id)` on delivery detection. Updates `orders.last_tracked_at`.

**Target state**: Query `shipments(tracking_number, status)` for shipments in `preparing`/`shipped` with `tracking_number IS NOT NULL`. Calls `fn_mark_shipment_delivered(p_shipment_id)` on delivery detection. Updates `shipments.last_tracked_at`. Logs tracking_number and shipmentId instead of orderId.

**Affected files**:
- `supabase/functions/track-shipments/index.ts` — full rewrite of queries, RPC calls, and logging

**Scenarios**:
1. **Normal tracking cycle** — Cron runs, finds 3 shipments in `shipped` status. Envia returns 1 delivered, 2 in transit. Calls `fn_mark_shipment_delivered` for the delivered one. Updates `last_tracked_at` for all 3.
2. **No shipments to track** — Returns `{ message: "No hay envíos para rastrear" }` with 200.
3. **Shipment already delivered in DB** — `fn_mark_shipment_delivered` is idempotent (returns `success: true, ALREADY_DELIVERED` if status already delivered/completed).

**Edge cases**:
- Order still has `tracking_number` on `orders` table (pre-migration orders) → this cron won't track those. Old `track-shipments` must run IN PARALLEL until backfill is verified.
- Batch size 50 still appropriate for shipments (same as orders)
- Envia API returns empty data array → graceful skip, no crash

**Dependencies**: Fase 9 RLS for shipments. `fn_mark_shipment_delivered` must be deployed.

---

### 5.4 Capability: track-returns cron

**Current state**: `track-returns/index.ts` queries `disputes(return_tracking_number, status)` for disputes in `waiting_return`. Calls `fn_mark_return_as_delivered(p_dispute_id)` on delivery. Updates `disputes.return_last_tracked_at`.

**Target state**: Keep querying `disputes(return_tracking_number, status)`. Call `fn_mark_return_delivered(p_dispute_id)` (the new name from sql.sql). Old `fn_mark_return_as_delivered` is replaced by `fn_mark_return_delivered` — update the RPC call name.

**Affected files**:
- `supabase/functions/track-returns/index.ts` — change RPC function name only

**Scenarios**:
1. **Return delivered** — Dispute in `waiting_return` with tracking. Envia returns delivered. Calls `fn_mark_return_delivered` → status becomes `return_delivered`.
2. **No returns to track** — Returns `{ message: "No returns to track" }` with 200.

**Edge cases**: `fn_mark_return_delivered` is idempotent — if dispute already `return_delivered`, it won't throw, but the cron shouldn't pick it up (status filter in query excludes it).

**Dependencies**: `fn_mark_return_delivered` deployed. `fn_mark_return_as_delivered` → renamed (or keep as alias during transition, delete in Fase 9).

---

## FASE 6 — Stripe / Checkout

### 6.1 Capability: create-payment-intent

**Current state**: `create-payment-intent/index.ts` accepts `{ productIds, addressId, idempotencyKey? }`. Calls `fn_reserve_products`. Calculates single subtotal + service fee. Creates one PaymentIntent. Metadata includes `product_ids`, `address_id`, `buyer_id`.

**Target state**: Same input/output contract for the client. Internally, after stock reservation, group reserved products by `seller_id` (from the reservation response). Sum shipping costs per seller (using `products.shipping_cost`). Pass seller-grouped metadata in PaymentIntent metadata: `seller_ids: JSON.stringify([...unique seller IDs])` and `seller_shipping: JSON.stringify({ [sellerId]: shippingCost })`. The total remains the same (sum of all + service fee). The metadata change lets `stripe-webhooks` know which sellers are involved for shipment creation.

**Affected files**:
- `supabase/functions/create-payment-intent/index.ts` — add seller-grouping logic after `fn_reserve_products`, add `seller_ids` and `seller_shipping` to metadata

**Scenarios**:
1. **Single seller, 2 items** — Reservation returns `[{seller_id: "uuid-a"}, {seller_id: "uuid-a"}]`. Metadata includes `seller_ids: '["uuid-a"]'`, `seller_shipping: '{"uuid-a": 150}'`. Total unchanged.
2. **Multi-seller, 1 item each** — Reservation returns `[{seller_id: "uuid-a"}, {seller_id: "uuid-b"}]`. Metadata includes `seller_ids: '["uuid-a","uuid-b"]'`, `seller_shipping: '{"uuid-a": 99, "uuid-b": 150}'`. Service fee computed on total subtotal.
3. **Shipping costs from products** — Read `products.shipping_cost` and `products.shipping_payer` per product after reservation. Sum by seller.

**Edge cases**:
- Product has NULL `shipping_cost` → default to 0
- Product has `shipping_payer = 'buyer'` → shipping cost is added to total
- Product has `shipping_payer = 'seller'` → shipping cost is NOT added to total (seller pays)

**Dependencies**: `fn_reserve_products` must return `seller_id` per product (check current implementation).

---

### 6.2 Capability: stripe-webhooks

**Current state**: `stripe-webhooks/index.ts` handles `payment_intent.succeeded`. Parses `product_ids` from metadata, calls `fn_create_order_from_payment` which creates 1 order + all `order_items` for all sellers.

**Target state**: `fn_create_order_from_payment` (already in sql.sql) should already create multi-seller shipments. The proposal says "no change needed" — verify `fn_create_order_from_payment` creates N shipments for N distinct sellers. If it does, this file is NOT changed. If it doesn't, add shipment creation logic after `fn_create_order_from_payment` call.

**Affected files**:
- `supabase/functions/stripe-webhooks/index.ts` — likely no change needed
- Verify `fn_create_order_from_payment` in sql.sql creates shipments per seller

**Scenarios**:
1. **Multi-seller purchase** — Webhook fires, calls `fn_create_order_from_payment`. Expected: 1 order + 2 shipments (one per seller) + order_items with correct `shipment_id`. Verify via DB inspection.
2. **Fraud detection** — Amount mismatch → releases products, returns 200 (no change).

**Dependencies**: `fn_create_order_from_payment` must be verified to create shipments.

---

## FASE 7 — Frontend (Multi-Seller + Fixes ROADMAP2)

### 7.1 Capability: New useShipments hook

**Current state**: No `useShipments` hook exists. `order.shipments` not queried. No `EnrichedShipment` type.

**Target state**: New file `apps/frontend/core/hooks/useShipments.ts`. Hook `useShipments(orderId)` queries `shipments` with `order_items` and `product` join. Returns `EnrichedShipment[]`. Each `EnrichedShipment` includes seller info, status, tracking, dispute info for that shipment.

**Affected files**:
- `apps/frontend/core/hooks/useShipments.ts` — NEW file

**EnrichedShipment type** (added to packages/types):
```typescript
export interface EnrichedShipment extends Tables<'shipments'> {
  items: (Tables<'order_items'> & { product: Product })[];
  seller: Profile | null;
  dispute: Dispute | null;
  isBuyer: boolean;
  isSeller: boolean;
  permissions: {
    canGenerateLabel: boolean;
    canConfirmDelivery: boolean;
    canCancel: boolean;
    canReport: boolean;
    canReview: boolean;
    canPayReturn: boolean;
    canUploadReturnEvidence: boolean;
  };
}
```

**Scenarios**:
1. **Single-seller order** — Hook returns 1 `EnrichedShipment`. UI shows single card.
2. **Multi-seller order** — Hook returns 2+ `EnrichedShipment`s. UI shows per-seller cards.
3. **Order without shipments (pre-migration)** — Hook returns empty array. UI falls back to order-level display.

**Edge cases**:
- Shipment exists but no `order_items` linked → `items: []`
- Shipment has dispute → `dispute` populated
- Seller profile deleted → `seller: null`

**Dependencies**: Fase 9 RLS (hook uses client-side supabase with auth header, needs RLS on shipments).

---

### 7.2 Capability: Multi-seller order overview screen

**Current state**: No dedicated multi-seller summary screen. `app/profile/orders/[id].tsx` shows order-level detail.

**Target state**: New screen `app/profile/orders/summary/[id].tsx`. Shows order header (total, status, buyer/seller info) + list of `OrderShipmentCard` components, one per shipment. Each card shows seller name, items, shipment status, tracking, action buttons. Tapping a card navigates to `app/profile/orders/[id].tsx?shipmentId=<id>`.

**Affected files**:
- `apps/frontend/app/profile/orders/summary/[id].tsx` — NEW screen
- `apps/frontend/components/features/orders/OrderShipmentCard.tsx` — NEW component
- `apps/frontend/app/profile/orders/[id].tsx` — accept optional `shipment_id` param

**Scenarios**:
1. **Multi-seller order** — `/summary/[id]` shows N shipment cards. Each card has independent tracking, status, and actions.
2. **Single-seller order** — Can still navigate to summary. Shows 1 card. Or redirect directly to `/[id]`.
3. **Navigating from summary → detail** — Tap card → `/[id]?shipmentId=X`. Detail screen filters actions for that shipment.

**Edge cases**:
- Order has no shipments yet (pre-migration) → summary shows "Información de envío no disponible" fallback, link to old `/profile/orders/[id]`
- One shipment in dispute, others normal → each card shows its own status correctly

**Dependencies**: `useShipments` hook.

---

### 7.3 Capability: Modify orders screens for shipment-level

**Current state**: `OrderActionCard.tsx` receives `order: EnrichedOrder`. All actions are order-level (generate label, confirm delivery, cancel). Permission `canConfirmReturnReceipt` exists.

**Target state**: `OrderActionCard.tsx` accepts optional `shipment?: EnrichedShipment`. When `shipment` is provided, actions use `shipment.id` instead of `order.id`. When `shipment` is not provided (pre-migration fallback), use order-level. Remove `canConfirmReturnReceipt` from `EnrichedOrder.permissions`.

**Affected files**:
- `apps/frontend/components/features/orders/OrderActionCard.tsx` — accept `shipment` prop, conditional action routing

**Scenarios**:
1. **Shipment-level action** — `shipment` prop provided → `generateLabel.execute({ shipmentId: shipment.id })`, `confirmDelivery.execute({ shipmentId: shipment.id })`.
2. **Order-level fallback** — `shipment` prop undefined → use `order.id` as before.
3. **Dispute action for specific shipment** — `resolveDisputeRefund` takes `shipmentId` instead of `orderId`.

**Dependencies**: None.

---

### 7.4 Bug 3 — Remove dead code `return_shipped`

**Current state**: `useOrders.ts` line 72: `isInTransit: isDispute && dispute?.status === 'return_shipped'`. The `return_shipped` status does not exist in the dispute_status enum (confirmed by `fn_confirm_return_receipt.sql` which has comment "Eliminado 'return_shipped' por no existir en el enum").

**Target state**: Remove `isInTransit` phase entirely. `return_shipped` is dead code. The `return_delivered` status directly follows `waiting_return`. The visual status mapping should account for this: when `dispute?.status === 'return_delivered'` → show 'delivered' visual.

**Affected files**:
- `apps/frontend/core/hooks/useOrders.ts` — remove `isInTransit`, clean visualStatus logic

**Scenarios**:
1. **Return delivered** — Dispute status `return_delivered` → visualStatus becomes 'delivered'. Works correctly without `return_shipped`.
2. **Return in transit** — There is no `return_shipped` status. The cron jumps from `waiting_return` → `return_delivered` (Envia detects delivery). No intermediate status needed.

**Edge cases**: Old disputes might have `return_shipped` in DB (stale data) → treat as `waiting_return` (conservative).

---

### 7.5 Issue B — Remove dead mutation `confirmReturnReceipt`

**Current state**: `useOrderActions.ts` lines 166-177 defines `confirmReturnReceipt` mutation calling `fn_confirm_return_receipt`. Exported in return object line 245-248. `OrderActionCard.tsx` references `permissions.canConfirmReturnReceipt` at line 110, 171, 227.

**Target state**: Remove `confirmReturnReceipt` mutation from `useOrderActions.ts`. Remove `canConfirmReturnReceipt` from `EnrichedOrder.permissions` and `OrderActionCard.tsx`. The replacement is `fn_seller_confirm_return_shipment(p_shipment_id)` — if needed, add new `confirmReturnShipment` mutation instead.

**Affected files**:
- `apps/frontend/core/hooks/useOrderActions.ts` — remove `confirmReturnReceipt` mutation and its return entry
- `apps/frontend/core/hooks/useOrders.ts` — remove `canConfirmReturnReceipt` from `permissions`
- `apps/frontend/components/features/orders/OrderActionCard.tsx` — remove references to `canConfirmReturnReceipt`
- `packages/types/src/index.ts` — remove `canConfirmReturnReceipt` from `EnrichedOrder.permissions`

**Scenarios**:
1. **Seller confirms return receipt** → Must use `fn_seller_confirm_return_shipment` via new `confirmReturnShipment` mutation (or admin does it). Old mutation removed.
2. **Existing code that calls `confirmReturnReceipt`** → Compile error caught immediately.

**Dependencies**: None.

---

## FASE 8 — Disputas y Retornos (Fixes ROADMAP2 + Cleanup)

### 8.1 Bug 1 — Fix auth en resolve-dispute-refund Edge Function

**Current state**: `resolve-dispute-refund/index.ts` only allows `role === 'admin'`. The `fn_complete_dispute_refund` (old) is called with `p_order_id, p_dispute_id`.

**Target state**: Accept BOTH admins AND the seller of the dispute. Validate `dispute.status IN ('return_delivered', 'waiting_return')`. Call `fn_complete_shipment_refund(p_shipment_id)` instead of `fn_complete_dispute_refund(p_order_id, p_dispute_id)`. Input changes from `{ orderId, disputeId }` to `{ disputeId }` (shipmentId derived from dispute). Refund the Stripe PaymentIntent for the ORDER (full refund — Stripe doesn't do partial per shipment easily). Then call `fn_complete_shipment_refund` for the specific shipment.

**Affected files**:
- `supabase/functions/resolve-dispute-refund/index.ts` — full rewrite of auth, input, RPC call

**Scenarios**:
1. **Seller resolves return dispute** — Authenticated as seller of dispute. Dispute status `return_delivered`. Refunds Stripe PI, calls `fn_complete_shipment_refund(p_shipment_id)`. Returns success.
2. **Admin resolves return dispute** — Authenticated as admin. Same flow. Admin override works.
3. **Unauthorized user** — Not admin, not seller → 403.
4. **Dispute in wrong status** — Status not in `return_delivered`/`waiting_return` → 422.

**Edge cases**:
- Stripe charge_already_refunded → catch and continue (idempotent refund)
- `fn_complete_shipment_refund` fails after Stripe refund → critical log, return 500 with guidance
- Dispute has no `shipment_id` (pre-migration) → fall back to old `fn_complete_dispute_refund` with `p_order_id`

**Dependencies**: `fn_complete_shipment_refund` must be deployed.

---

### 8.2 Bug 2 — Fix fn_complete_dispute_refund.sql (multi-seller filter)

**Current state**: `fn_complete_dispute_refund.sql` line 9: `SELECT SUM(net_payout) INTO v_net_payout_total FROM public.order_items WHERE order_id = p_order_id`. This sums ALL order items in the order, not filtering by the dispute's seller. In a multi-seller order, this deducts ALL sellers' pending balances from just ONE seller's wallet.

**Target state**: Either:
- **A (preferred)**: Deprecate `fn_complete_dispute_refund` and use `fn_complete_shipment_refund` exclusively (which filters by `shipment_id`).
- **B (fallback)**: Add seller filter: `WHERE order_id = p_order_id AND seller_id = (SELECT seller_id FROM disputes WHERE id = p_dispute_id)`.

**Affected files**:
- `supabase/queries/disputes/fn_complete_dispute_refund.sql` — fix query or add deprecation comment

**Scenarios**:
1. **Multi-seller order, dispute on one seller** — Old code: deducts ALL sellers' balances. Fix (option A): fn_complete_shipment_refund only deducts the disputed seller's balance.
2. **Single-seller order** — Both old and new produce same result (seller_id matches all items).

**Edge cases**: If any existing cron or code references `fn_complete_dispute_refund`, keep the function with the fix (option B) plus a deprecation notice.

**Dependencies**: None.

---

### 8.3 Issue A — Eliminar fn_confirm_return_receipt

**Current state**: `supabase/queries/return/fn_confirm_return_receipt.sql` exists. Called from `useOrderActions.ts` (Issue B) and potentially from other places.

**Target state**: Delete `fn_confirm_return_receipt.sql`. Its replacement is `fn_seller_confirm_return_shipment(p_shipment_id)` which handles the same flow at shipment-level with proper auth (auth.uid() + is_admin()).

**Affected files**:
- `supabase/queries/return/fn_confirm_return_receipt.sql` — DELETE
- Update any remaining references (search `fn_confirm_return_receipt` across codebase)

**Scenarios**:
1. **Old code calls `fn_confirm_return_receipt`** → RPC will fail with function not found. All callers must be removed (Issue B covers frontend).
2. **New code calls `fn_seller_confirm_return_shipment`** → takes `p_shipment_id`, validates caller, updates dispute + triggers refund.

**Dependencies**: Issue B (frontend) must be done first. Any backend callers must be migrated first.

---

### 8.4 Migrar crons existentes to shipment-level

**Current state**: 
- `fn_cron_dispute_payout_timeout.sql` — marks dispute as `resolved`, notifies. Does NOT call any refund function. Action path uses `order_id`.
- `fn_cron_dispute_shipping_timeout.sql` — marks dispute as `resolved`, calls `fn_release_order_funds(p_order_id)`, notifies with `order_id` paths.

**Target state**:
- `fn_cron_dispute_payout_timeout.sql` — Update action paths to include `order_id` (same as current — shipments don't have their own screen yet). Add call to `fn_complete_shipment_refund` for the associated shipment when resolving to buyer.
- `fn_cron_dispute_shipping_timeout.sql` — Replace `fn_release_order_funds(v_dispute.order_id)` with `fn_release_shipment_funds(shipment_id_from_dispute)`. Update action paths to use `order_id` (same format).

**Affected files**:
- `supabase/queries/disputes/fn_cron_dispute_payout_timeout.sql` — add refund call
- `supabase/queries/disputes/fn_cron_dispute_shipping_timeout.sql` — replace `fn_release_order_funds` with `fn_release_shipment_funds`

**Scenarios**:
1. **Seller doesn't pay return label in 48h** → `fn_cron_dispute_payout_timeout` marks resolved, calls `fn_complete_shipment_refund(v_dispute.shipment_id)` for refund. Buyer notified.
2. **Buyer doesn't ship return in 48h** → `fn_cron_dispute_shipping_timeout` marks resolved, calls `fn_release_shipment_funds(v_dispute.shipment_id)` to release funds to seller. Seller notified.

**Edge cases**:
- Dispute has `shipment_id IS NULL` (pre-migration) → skip shipment-level operations, keep old behavior (no refund call for payout_timeout, call `fn_release_order_funds` for shipping_timeout)
- Multiple disputes on same order (one per seller) → each cron handles its own dispute independently

**Dependencies**: `fn_complete_shipment_refund` and `fn_release_shipment_funds` must be deployed. Old `fn_release_order_funds` kept as fallback for pre-migration disputes.

---

### 8.5 Fix fn_resolve_dispute_to_seller (direct UPDATE orders)

**Current state**: `fn_resolve_dispute_to_seller.sql` line 71: `UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id`. This bypasses the trigger-based order derivation.

**Target state**: Remove the direct `UPDATE orders`. The `fn_shipments_status_trigger` on `shipments` already derives order status. Instead, update the dispute's `shipment.status = 'completed'` (or leave it as-is if already delivered/completed). The order status trigger will propagate the change.

**Affected files**:
- `supabase/queries/disputes/fn_resolve_dispute_to_seller.sql` — remove `UPDATE orders`, add logic to mark shipment as completed

**Scenarios**:
1. **Admin resolves dispute to seller** — Dispute was on a delivered shipment. Admin clicks resolve to seller. Function updates dispute to `resolved`, updates `shipments.status = 'completed'`, trigger updates `orders.status`.
2. **Order with multiple shipments, only one disputed** — Only the disputed shipment gets marked completed. Other shipments remain in their current state. Order status is derived correctly by trigger.

**Edge cases**:
- Dispute has no `shipment_id` → fallback: update `orders` directly (pre-migration)
- Shipment already `completed` → idempotent skip

**Dependencies**: Shipment status trigger must be active.

---

## FASE 9 — RLS + Types + Limpieza

### 9.1 RLS policies for shipments

**Current state**: `shipments` table exists (in database.types.ts) but likely has NO RLS policies (default: only service_role can access).

**Target state**: Enable RLS on `shipments`. Add policies:
- **SELECT**: buyer (via `order.buyer_id`), seller (via `seller_id`), admin (via `is_admin()`)
- **INSERT**: only service_role (Edge Functions)
- **UPDATE**: seller can update their own shipment's `status`, `tracking_number`, `label_url`, `origin_address`; admin can update any
- **DELETE**: none (soft-delete not implemented)

**Affected files**:
- `supabase/migrations/*shipments_rls.sql` — NEW SQL migration

**Scenarios**:
1. **Buyer views order detail** → Can SELECT shipments WHERE `order.buyer_id = auth.uid()`. Sees all shipments in their order.
2. **Seller views their sales** → Can SELECT shipments WHERE `seller_id = auth.uid()`. Sees only their shipments.
3. **Admin views all** → `is_admin()` bypasses all restrictions.

**Edge cases**:
- Seller sees OTHER sellers' shipments in the same order → RLS prevents this (filtered by `seller_id`)
- Buyer must see ALL shipments in their order (including other sellers') → policy uses `order.buyer_id`, not `shipment.seller_id`

**Dependencies**: Deploy BEFORE any Edge Function that reads/writes `shipments` with user auth (not service_role).

---

### 9.2 Regenerar types + export Shipment types

**Current state**: `database.types.ts` includes `shipments` table (already generated). `packages/types/src/index.ts` does NOT export `Shipment` or `EnrichedShipment` types.

**Target state**: Run `supabase gen types typescript --local` to regenerate `database.types.ts` (ensures any schema changes since last gen are captured). Add exports in `index.ts`:
```typescript
export type Shipment = Tables<'shipments'>;
export type EnrichedShipment = { /* from 7.1 spec */ };
```

**Affected files**:
- `packages/types/src/database.types.ts` — regenerated
- `packages/types/src/index.ts` — add `Shipment`, `EnrichedShipment`, add `shipmentId` to action types

**Scenarios**:
1. **Schema added `shipments.return_label_url` after gen** → Regeneration picks it up.
2. **Frontend imports `EnrichedShipment`** → Type-safe access to shipment fields.

**Dependencies**: All SQL changes deployed before regeneration.

---

### 9.3 Dropear columnas migradas de orders

**Current state**: `orders` table still has `tracking_number`, `label_url`, `last_tracked_at`, `shipping_evidence`, `origin_address` columns. These are now in `shipments`.

**Target state**: Drop these columns from `orders` AFTER confirming no code references them. Data is preserved in `shipments` (backfilled in Fase 4).

**Affected files**:
- SQL migration: `ALTER TABLE public.orders DROP COLUMN tracking_number, DROP COLUMN label_url, DROP COLUMN last_tracked_at, DROP COLUMN shipping_evidence, DROP COLUMN origin_address;`

**Scenarios**:
1. **Column drop succeeds** — All references to `orders.tracking_number` in code must be migrated to `shipments.tracking_number`. Verify via grep.
2. **Column still referenced** — Must fail at runtime or compile time. That's correct — forces migration of all references.

**Edge cases**:
- `orders.tracking_number` is NOT NULL — must handle NULL in pre-migration orders or ensure all have tracking in `shipments`
- Admin-web might still reference old columns → check before dropping

**Dependencies**: All Fases 5-8 must be deployed. All code references to old columns must be cleaned up.

---

### 9.4 Cleanup dead functions and references

**Current state**: Multiple deprecated SQL functions still exist:
- `fn_mark_as_delivered` (order-level) — replaced by `fn_mark_shipment_delivered`
- `fn_mark_return_as_delivered` (old name) — replaced by `fn_mark_return_delivered`
- `fn_release_order_funds` (order-level) — replaced by `fn_release_shipment_funds`
- `fn_complete_dispute_refund` (old, with bug) — replaced by `fn_complete_shipment_refund`
- `fn_confirm_return_receipt` — replaced by `fn_seller_confirm_return_shipment`

**Target state**: Drop all dead functions with `DROP FUNCTION IF EXISTS public.<name>(<params>)`. Only drop AFTER confirming no cron, trigger, or Edge Function references them.

**Affected files**:
- SQL migration dropping functions
- Any remaining import references in frontend or Edge Functions

**Scenarios**:
1. **Function no longer called** → Drop succeeds, deploy clean.
2. **Function still referenced by an old cron** → Cron fails at runtime. That's the signal to update the cron first.

**Edge cases**: 
- Keep old functions as deprecated stubs that log warnings for one release cycle before dropping
- Write a verification SQL query: `SELECT proname FROM pg_proc WHERE proname IN ('fn_mark_as_delivered', 'fn_mark_return_as_delivered', ...)` to check if they exist before dropping

**Dependencies**: All callers must be migrated first.

---

## Execution Order

Following the dependency-driven approach from the proposal:

1. **Fase 9.1 — RLS for shipments** (deploy FIRST, unblocks all other fases that read/write shipments with user auth)
2. **Fase 8.1 — Fix auth in resolve-dispute-refund** (fixes blocking bug)
3. **Fase 8.2 — Fix fn_complete_dispute_refund** (fixes multi-seller refund bug)
4. **Fase 8.5 — Fix fn_resolve_dispute_to_seller** (remove direct orders UPDATE)
5. **Fase 8.4 — Migrate crons** (update payout_timeout + shipping_timeout)
6. **Fase 8.3 — Remove fn_confirm_return_receipt** (after all callers migrated)
7. **Fase 5.1 — get-shipping-quote** (multi-origin, independent)
8. **Fase 5.2 — generate-shipping-label** (shipment-level, reads RLS-protected table)
9. **Fase 5.3 — track-shipments cron** (reads shipments)
10. **Fase 5.4 — track-returns cron** (update RPC call name)
11. **Fase 6.1 — create-payment-intent** (add seller metadata)
12. **Fase 6.2 — stripe-webhooks** (verify fn_create_order_from_payment)
13. **Fase 7.1-7.3 — Frontend** (useShipments hook, summary screen, action card)
14. **Fase 7.4-7.5 — Bug fixes** (remove dead code)
15. **Fase 9.2 — Regenerate types** (after all SQL changes deployed)
16. **Fase 9.3 — Drop old columns** (after all code references migrated)
17. **Fase 9.4 — Cleanup dead functions** (LAST — only after nothing references them)
