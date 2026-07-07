# Spec: Multi-Seller Shipment Architecture

> **Source of Truth** — generated from SDD `complete-shipment-migration` (archived 2026-05-29)

---

## Overview

Shipments are the central entity for multi-seller orders. Each order can have N shipments (one per seller). Every shipment has its own tracking, label, carrier, and dispute lifecycle. The order status is **derived** from its shipments via `fn_shipments_status_trigger`.

## Requirements

### Requirement: Shipment-Scoped Dispute and Report Context

The system MUST preserve `shipment_id` through order/report navigation and dispute creation flows for multi-seller safety.

#### Scenario: Buyer opens dispute from shipment context

- GIVEN an order with multiple seller shipments
- WHEN buyer starts dispute/report from a shipment action
- THEN the request includes `order_id` and `shipment_id`

#### Scenario: Missing shipment context

- GIVEN dispute/report request contains only `order_id`
- WHEN validation executes
- THEN the system SHALL reject the request as invalid context

### Requirement: Seller Resolution Uses Shipment Ownership

The system MUST derive dispute seller context from `shipments.seller_id` for the provided `shipment_id` and MUST NOT infer seller from `order.items[0]`.

#### Scenario: Correct seller is selected in multi-seller order

- GIVEN one order containing shipments from seller A and seller B
- WHEN a dispute is created for seller B shipment
- THEN seller B is recorded as dispute seller

#### Scenario: Shipment does not belong to order

- GIVEN `shipment_id` does not belong to the provided `order_id`
- WHEN dispute creation is requested
- THEN the system SHALL reject creation and MUST NOT persist dispute data

### Requirement: Verified Review Identity Contract

The system MUST preserve shipment-safe review identity as `(reviewer_id, shipment_id, product_id)`. A valid verified-purchase attribution MUST reference a product that belongs to the shipment being reviewed.

#### Scenario: Shipment-safe identity for a completed purchase

- GIVEN a buyer completed delivery for a shipment item
- WHEN a review is created for that item
- THEN review identity is represented by `(reviewer_id, shipment_id, product_id)`
- AND verified attribution is tied to that shipment-product linkage

#### Scenario: Invalid or missing linkage

- GIVEN a review record lacks valid shipment-product linkage
- WHEN profile trust badges are evaluated
- THEN the record MUST NOT be treated as a verified purchase

### Requirement: Public-Profile Dependency and Eligibility Guard

Shipment-level `canReview` remains the eligibility source for buyer review flows. Until the separate orders/multi-seller review-creation fix is complete, consumers SHOULD treat this identity contract as the target dependency and MUST NOT introduce fallback attribution logic that can mis-assign seller trust signals.

#### Scenario: Current dependency state

- GIVEN the orders/multi-seller creation fix is not yet complete
- WHEN a capability documents verified-purchase behavior
- THEN it references shipment-level `canReview` and the target identity tuple as the contract-safe dependency

#### Scenario: Unsafe fallback attempt

- GIVEN an implementation attempts order-first fallback attribution
- WHEN shipment-safe linkage cannot be proven
- THEN the behavior is rejected for verified-purchase trust signaling

### Requirement: V1 Shipment-Scoped Identity vs V2 Per-Product Reviews

The current V1 implementation ships ONE review per shipment, scoped to the shipment's first product (`currentShipment.items[0].product_id`). This is intentionally narrower than the long-term V2 contract, which will allow ONE review per product within a shipment. Both versions MUST preserve the `(reviewer_id, shipment_id, product_id)` identity tuple and MUST NOT fall back to `order.items[0]` attribution, which is the multi-seller mis-assignment bug.

#### Scenario: V1 single review per shipment

- GIVEN a completed shipment with one or more products
- WHEN the buyer submits a review from the order detail
- THEN the review is scoped to `currentShipment.id` and `currentShipment.items[0].product_id`
- AND only ONE review may be created per shipment for that buyer

#### Scenario: V2 one review per product within a shipment

- GIVEN the per-product review expansion is delivered
- WHEN a shipment contains multiple products
- THEN the buyer may submit one review per `(shipment_id, product_id)` pair
- AND the verified-purchase badge continues to require the full identity tuple

#### Scenario: No order-first fallback

- GIVEN any review-creation flow (V1 or V2)
- WHEN shipment-safe product identity is unavailable
- THEN the implementation MUST NOT substitute `order.items[0]` and MUST leave `shipment_id`/`product_id` null

## Acceptance Criteria

- `openDispute` contract includes `shipment_id`.
- Report and dispute routes reject missing/invalid shipment scope.
- Dispute seller mapping is shipment-based, not order-first-item based.

## Core Design

### Order ↔ Shipment Relationship

- One `order` → N `shipments` (one per distinct seller)
- Each `order_item` belongs to exactly one `shipment`
- Order status is computed: lowest-priority exception → highest-progress shipment
  - Priority: `dispute > refunded > cancelled > refunded_cancelled`
  - Progress: `paid < preparing < shipped < delivered`
  - All completed → `completed`

### Shipment Status Flow

```
paid → preparing → shipped → delivered → completed
         ↓           ↓
      cancelled   refunded / dispute
```

### Shipment Data Model

```typescript
interface Shipment {
  id: string;
  order_id: string;
  seller_id: string;
  status: 'paid' | 'preparing' | 'shipped' | 'delivered' | 'completed' | 'cancelled' | 'refunded';
  tracking_number: string | null;
  label_url: string | null;
  carrier: string | null;
  origin_address: Json;
  envia_shipment_id: string | null;
  delivered_at: timestamp | null;
  created_at: timestamp;
  updated_at: timestamp;
}
```

---

## RLS Policies (shipments)

| Policy | Operation | Condition |
|--------|-----------|-----------|
| `shipments_select_buyer` | SELECT | `order.buyer_id = auth.uid()` via subquery on orders |
| `shipments_select_seller` | SELECT | `seller_id = auth.uid()` |
| `shipments_select_admin` | SELECT | `is_admin()` |
| `shipments_insert_service_role` | INSERT | service_role only (client-side block for authenticated) |
| `shipments_update_seller` | UPDATE | `seller_id = auth.uid()` AND `status IN ('paid','preparing','shipped')` |
| `shipments_update_admin` | UPDATE | `is_admin()` |

Seller can only update status/tracking/label while shipment is in early stages (before `delivered`).

---

## Edge Functions

### get-shipping-quote

Accepts:
```typescript
{
  items: Array<{ originZip: string; packageId: string; price: number; sellerId: string }>;
  destinationZip?: string;
}
```

Returns:
```typescript
{ rates: Record<string, ShippingOption[] | null> }
// key = sellerId, null = Envia API failed for that origin
```

- Groups by `(originZip, sellerId)`. Same seller + same zip = one package.
- Calls Envia `/rate/` per group.
- Partial failure model: if one origin fails, other sellers still get rates.

### generate-shipping-label

Accepts:
```typescript
{ shipmentId: string; originAddress: AddressObject; shippingEvidence: { images: string[] } }
```

Validates:
- Shipment exists and `status = 'paid'`
- `tracking_number IS NULL`
- Caller is seller (`shipment.seller_id = auth.uid()`) or admin
- Anti-fraud: seller has < 10 shipments in `preparing`/`shipped` (counted in shipments table)

Updates: `shipments.status = 'preparing'`, `tracking_number`, `label_url`, `carrier`, `origin_address`

### track-shipments

Cron: queries `shipments WHERE status IN ('preparing','shipped') AND tracking_number IS NOT NULL`
- Batch size: 50, ordered by `last_tracked_at ASC NULLS FIRST`
- Envia `generaltrack/` → delivered → call `fn_mark_shipment_delivered(shipment_id)`
- Update `last_tracked_at` for all tracked shipments

### track-returns

Cron: queries `disputes WHERE status = 'waiting_return' AND return_tracking_number IS NOT NULL`
- Call `fn_mark_return_delivered(p_dispute_id)` on delivery detection
- Updates `disputes.return_last_tracked_at`

---

## Stripe Integration

### create-payment-intent

After `fn_reserve_products`:
1. Query `products` for each `product_id` → get `seller_id` and `shipping_cost`
2. Group reserved items by `seller_id`
3. Sum shipping costs per seller (buyer-pays only)
4. Add to PaymentIntent metadata:
   - `seller_ids: JSON.stringify([...sellerIds])`
   - `seller_shipping: JSON.stringify({ [sellerId]: shippingCost })`
5. Total amount unchanged (buyer pays all shipping)

### stripe-webhooks

On `payment_intent.succeeded`:
- Calls `fn_create_order_from_payment` (already multi-seller capable)
- Creates: 1 order + N shipments (one per seller) + order_items with correct `shipment_id`

---

## Dispute Resolution (shipment-level)

### resolve-dispute-refund

Input: `{ disputeId: string }`

Auth: admin OR `dispute.seller_id === auth.uid()`

Flow:
1. Validate `dispute.status IN ('return_delivered', 'waiting_return')`
2. Stripe refund (full PaymentIntent, idempotent)
3. Call `fn_complete_shipment_refund(p_shipment_id)` (filters by seller_id)
4. Fallback if `dispute.shipment_id IS NULL`: call `fn_complete_dispute_refund(p_order_id, p_dispute_id)` with seller filter

### fn_complete_shipment_refund

```sql
-- Deducts only the disputed seller's pending balance
UPDATE wallet_transactions
SET status = 'refunded'
WHERE shipment_id = p_shipment_id;

UPDATE wallets SET pending_balance = pending_balance - v_net_payout
WHERE seller_id = v_seller_id;
```

### fn_release_shipment_funds

```sql
-- Moves seller's pending balance to available
UPDATE wallets SET
  available_balance = available_balance + v_net_payout,
  pending_balance = pending_balance - v_net_payout
WHERE seller_id = v_seller_id;
```

---

## Crons

### fn_cron_dispute_payout_timeout

- Marks dispute as `resolved` (buyer didn't pay return label in 48h)
- Calls `fn_complete_shipment_refund(shipment_id)` if `shipment_id IS NOT NULL`
- Fallback: `fn_release_order_funds(order_id)` for pre-migration disputes

### fn_cron_dispute_shipping_timeout

- Marks dispute as `resolved` (buyer didn't ship return in 48h)
- Calls `fn_release_shipment_funds(shipment_id)` if `shipment_id IS NOT NULL`
- Fallback: `fn_release_order_funds(order_id)` for pre-migration disputes

### fn_cron_return_delivery_timeout

- Marks dispute as `resolved` if return not delivered within 10 days
- Calls `fn_complete_shipment_refund(shipment_id)` on buyer win

### fn_cron_release_shipment_funds

- Releases funds to seller if shipment not disputed within 15 days of delivery
- Uses `delivered_at` (not `updated_at`) for 48h grace period

### auto-cancel-orders

- Cancels orders with no shipment created within `order_expiration_hours`
- Uses direct `fn_cancel_shipment` RPC (not Edge Function call) for atomic rollback

### auto-cancel-preparing

- Cancels shipments in `preparing` without carrier scan after `preparing_expiration_hours` (default 72h)
- Stripe partial refund per shipment + `fn_cancel_shipment` RPC direct

### track-shipments / track-returns

- Cron triggers (described above)

---

## Frontend Types

```typescript
export interface EnrichedShipment extends Tables<'shipments'> {
  items: (Tables<'order_items'> & { product: Product })[];
  seller: Pick<Profile, 'id' | 'name' | 'avatar_url'> | null;
  dispute: Dispute | null;
  isBuyer: boolean;
  isSeller: boolean;
  permissions: {
    canGenerateLabel: boolean;      // seller + status='paid' + no tracking
    canConfirmDelivery: boolean;    // buyer + status in ('shipped','delivered')
    canCancel: boolean;             // status='paid'
    canReport: boolean;             // buyer + dispute window
    canPayReturn: boolean;          // seller + dispute.return_payout_status='pending'
    canUploadReturnEvidence: boolean; // buyer + dispute.status='waiting_return'
    canReview: boolean;             // buyer + completed + no review
    showTracking: boolean;           // tracking_number not null
    showDeliveredBanner: boolean;    // seller + status='delivered'
  };
}
```

### Screens

- `/profile/orders/summary/[id]` — Multi-seller order overview, lists `OrderShipmentCard` per shipment
- `/profile/orders/[id]?shipmentId=` — Order detail with optional shipment filter
- `OrderActionCard` accepts optional `shipment: EnrichedShipment` prop

### Hooks

- `useShipments(orderId)` — fetches shipments with items/products/seller/dispute joins
- `useOrderActions` — `generateLabel({ shipmentId })`, `confirmDelivery({ shipmentId })` overloads

### Removed Dead Code

- `return_shipped` status (does not exist in enum)
- `confirmReturnReceipt` mutation
- `canConfirmReturnReceipt` permission
- `fn_confirm_return_receipt` SQL function

---

## Deprecated / Removed

### Dropped from orders table

`tracking_number`, `label_url`, `last_tracked_at`, `shipping_evidence`, `origin_address` — now in shipments.

### Dropped functions

| Function | Replaced by |
|----------|-------------|
| `fn_mark_as_delivered` | `fn_mark_shipment_delivered` |
| `fn_mark_return_as_delivered` | `fn_mark_return_delivered` |
| `fn_release_order_funds` | `fn_release_shipment_funds` |
| `fn_complete_dispute_refund` | `fn_complete_shipment_refund` (deprecated, kept for pre-migration) |
| `fn_confirm_return_receipt` | `fn_seller_confirm_return_shipment` |

---

## Rollback Plan

1. **Edge Functions**: `supabase functions deploy <name>` to previous version. Old paths untouched.
2. **SQL**: Old functions kept as fallback for pre-migration disputes. Cron references updated point-by-point.
3. **Frontend**: `summary/[id]` is additive. Old `orders/[id]` unchanged. `useShipments` returns empty for no shipments.
4. **Column drop**: Columns preserved in `shipments` (backfilled). Can be re-added from backup before Fase 9.3.

---

## Dependencies

1. Fases 1-4 executed in production (shipments table must exist with data)
2. `fn_mark_shipment_delivered`, `fn_complete_shipment_refund`, `fn_release_shipment_funds` deployed
3. Envia.com API keys in Supabase secrets
4. Stripe webhook secret configured

## Success Criteria

- [x] All 4 Edge Functions (Fase 5) deploy and produce correct multi-seller output
- [x] Stripe checkout creates 1 order + N shipments for N distinct sellers
- [x] Frontend shows multi-seller summary page when order has >1 seller
- [x] `resolve-dispute-refund` accepts authenticated sellers (not just admins)
- [x] Dispute crons operate at shipment-level without breaking existing disputes
- [x] Shipments RLS restricts reads to buyer/seller/admin
- [x] No `fn_confirm_return_receipt` references remain in codebase
- [x] `tracking_number`, `label_url` columns dropped from `orders`
- [x] `return_shipped` dead code removed from `useOrders.ts`
- [x] `confirmReturnReceipt` dead mutation removed from `useOrderActions.ts`