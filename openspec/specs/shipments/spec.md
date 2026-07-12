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
- Shipments capture the platform `stripe_payment_intent_id` and `stripe_transfer_id`.
- Allocation correlation fields are present before marking the shipment `paid`.
- `stripe_transfer_id` is written exactly once during admin release.
- Manual cancellation is shipment-scoped with explicit `shipmentId`.
- Buyer/seller cancellation eligibility limited to own `paid` shipments.
- `preparing` cancellation remains cron-only via `preparing_expiration_hours` timeout.
- Stripe refunds use per-shipment explicit amount, idempotency key, and caller-role metadata.
- `system_settings.is_maintenance` gates the manual cancel endpoint.
- SLA cancellation/preparing timers read from live `system_settings` values.
- Auto-cancel crons use shared buyer-paid refund basis excluding seller-paid shipping.
- Seller-paid shipping excluded from refund calculations; refund capped at remaining refundable amount.

### Requirement: Shipment Records Stripe Settlement References

The system MUST persist Stripe settlement references on each shipment for single-charge multi-seller checkout and future refund/dispute/release flows.

#### Scenario: Shipment created from platform payment success

- GIVEN a successful single-charge PaymentIntent for an order with two sellers
- WHEN shipments are created
- THEN each shipment stores the platform `stripe_payment_intent_id`
- AND `stripe_transfer_id` remains null until the admin release creates the transfer

#### Scenario: Shipment receives transfer on manual release

- GIVEN a completed shipment without `stripe_transfer_id`
- WHEN admin release creates the seller transfer
- THEN the shipment stores the returned `stripe_transfer_id`
- AND the transfer is grouped under the order-level `transfer_group`

### Requirement: Shipments Expose Allocation Correlation Fields

The system MUST store per-shipment allocation fields that correlate the shipment to the order-level charge and seller settlement.

#### Scenario: Shipment allocation is persisted at payment success

- GIVEN shipments are created from a single-charge order
- WHEN allocation is computed
- THEN each shipment stores `shipping_cost` and links to order_items with `commission_amount`, `shipping_amount`, `shipping_payer`, and `net_payout`
- AND the shipment transitions to `paid` only after allocation persistence succeeds

### Requirement: Manual Cancellation is Shipment-Scoped

The Edge Function `cancel-order` is a legacy name. Manual cancellation MUST be shipment-scoped and MUST NOT be whole-order.

#### Scenario: Buyer cancels from shipment detail

- GIVEN a `paid` shipment at `/profile/orders/[id]?shipment_id=shp_123`
- WHEN the buyer confirms cancellation
- THEN the payload includes `orderId` and `shipmentId`
- AND only the referenced shipment is cancelled and refunded

#### Scenario: Missing shipment scope

- GIVEN a manual request with `orderId` but no `shipmentId`
- WHEN the backend validates
- THEN it rejects with 422 and performs no cancellation or refund

### Requirement: Manual Cancellation Eligibility

The system MUST allow buyer manual cancellation only for `paid` shipments. The system MUST allow seller manual cancellation only for the seller's own `paid` shipment. `preparing` cancellation MUST remain cron-only by `preparing_expiration_hours` timeout.

#### Scenario: Paid shipment cancels

- GIVEN a shipment with `status='paid'`
- WHEN the buyer triggers manual cancel
- THEN the shipment is cancelled and a partial refund is issued

#### Scenario: Non-cancelable shipment states

- GIVEN a shipment in `preparing`, `shipped`, `delivered`, `completed`, or dispute/refunded state
- WHEN the buyer triggers manual cancel
- THEN the request is rejected and routed to dispute/support

#### Scenario: Seller cancels own paid shipment

- GIVEN a seller views their own `paid` shipment
- WHEN the seller confirms cancellation
- THEN the shipment is cancelled and refunded

#### Scenario: Seller attempts cancel on non-owned or non-paid shipment

- GIVEN a seller views a shipment they do not own, or a shipment not in `paid`
- WHEN the seller attempts to trigger cancel
- THEN the CTA is hidden and any direct request is rejected

### Requirement: Stripe Shipment Refund Safety

The system MUST issue Stripe refunds shipment-only with explicit partial amount equal to the shipment subtotal plus that shipment's proportional share of the grossed-up buyer-paid fee, and MUST persist the platform's proportional share of `orders.actual_stripe_fee_cents` as `orders.cancellation_loss_cents`. It MUST block or alert if `stripe_transfer_id` exists. Refund metadata MUST include `shipment_id`, `order_id`, caller role, reason, and `seguro_share_cents`.
(Previously: refund amount used the legacy ungrossed buyer-paid fee and did not persist Stripe loss.)

#### Scenario: Partial refund amount

- GIVEN a `paid` shipment
- WHEN the refund is created
- THEN the amount equals the shipment subtotal plus its proportional share of the grossed-up buyer-paid fee
- AND it never includes seller-paid shipping
- AND a single-shipment cancellation equals the original charge amount
- AND `cancellation_loss_cents` is set to the proportional actual fee share when available
- AND the idempotency key is `cancel_shipment_{shipmentId}`

#### Scenario: Remaining refundable cap

- GIVEN a payment with a known remaining refundable amount
- WHEN the computed refund would exceed that cap
- THEN the endpoint rejects before Stripe is called with a clear refund-cap error

#### Scenario: Transfer already exists

- GIVEN a shipment with `stripe_transfer_id IS NOT NULL`
- WHEN cancellation is requested
- THEN the system logs a CRITICAL alert and refuses the refund

#### Scenario: Refund metadata

- GIVEN a valid shipment cancellation refund
- WHEN the refund is created
- THEN metadata includes `shipment_id`, `order_id`, caller role, reason, and `seguro_share_cents`

### Requirement: Emergency Maintenance Stop

The system MUST block the manual cancellation endpoint when `system_settings.is_maintenance` is true, before any mutation.

#### Scenario: Maintenance mode

- GIVEN `system_settings.is_maintenance = true`
- WHEN a buyer submits a manual cancellation request
- THEN the endpoint returns a maintenance error and performs no mutation

### Requirement: Settings-Driven SLA Copy

SLA notices MUST read `order_expiration_hours` and `preparing_expiration_hours` from `system_settings` via `useSystemConfig`; only fallback values may be hardcoded. The unboxing/video notice MUST remain visible when eligible.

#### Scenario: SLA timer uses live settings

- GIVEN the buyer views the order detail SLA notice
- WHEN `useSystemConfig` returns configured hours
- THEN the notice uses those values

#### Scenario: Unboxing notice remains

- GIVEN the buyer is eligible for the unboxing/video safety notice
- WHEN the SLA notice is rendered
- THEN the unboxing notice remains visible and is not replaced

### Requirement: Shipment-Scoped Cron Regression

The `auto-cancel-orders` and `auto-cancel-preparing` crons MUST remain shipment-scoped, continue using `order_expiration_hours` and `preparing_expiration_hours`, and MUST compute refund amount from the grossed-up buyer-paid fee while persisting cancellation loss when reconciled.
(Previously: cron refund amount was computed from the legacy fee and did not persist loss.)

#### Scenario: Cron processes one shipment

- GIVEN a multi-shipment order where one shipment times out
- WHEN the cron runs
- THEN only the timed-out shipment is cancelled and refunded
- AND the refund amount uses the grossed-up buyer-paid fee
- AND `cancellation_loss_cents` is set when the actual fee is reconciled

## ADDED Requirements

### Requirement: Cancellation Loss Persistence

The system MUST compute and persist `orders.cancellation_loss_cents` as the cancelling shipment's proportional share of `orders.actual_stripe_fee_cents`. If `actual_stripe_fee_cents` is NULL, the loss MUST be NULL.

#### Scenario: Reconciled actual fee

- GIVEN an order with two equal shipments and `actual_stripe_fee_cents` of 20,000
- WHEN one shipment is cancelled
- THEN `cancellation_loss_cents` is set to 10,000

#### Scenario: Unreconciled actual fee

- GIVEN an order with `actual_stripe_fee_cents` NULL
- WHEN a shipment is cancelled
- THEN `cancellation_loss_cents` is NULL
- AND the buyer refund is still issued in full

### Requirement: Cancellation Verification

Tests MUST verify frontend scope wiring, backend unsafe state rejection, Stripe refund behavior, settings-driven SLA copy, and no cross-shipment mutation.

#### Scenario: Unsafe state rejection

- GIVEN a request to cancel a `shipped` shipment
- WHEN the backend validates
- THEN it returns 422 and makes no Stripe refund

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

### cancel-order

Manual cancellation entry point. Legacy name preserved for deployed compatibility; behavior is shipment-scoped.

Accepts:
- `orderId: string`
- `shipmentId: string` (required — missing scope rejected with 422)
- `reason?: string`

Auth & validation:
- Rejects when `system_settings.is_maintenance` is true (503)
- Buyer-only: JWT `auth.uid()` must match `order.buyer_id` (403)
- Seller-only: JWT `auth.uid()` must match `shipment.seller_id` (403)
- Shipment must belong to the provided order (422)
- Shipment status must be `paid`; `preparing` is cron-only (422)
- `stripe_transfer_id IS NOT NULL` logs CRITICAL and refuses refund

Refund:
- Amount: `SUM(price_at_purchase)` from shipment items + proportional buyer-paid fee share, excluding seller-paid shipping
- Capped against `charge.amount - charge.amount_refunded` when charge is available
- Idempotency key: `cancel_shipment_{shipmentId}`
- Metadata: `{ shipment_id, order_id, caller_role, reason }`
- `reverse_transfer` applies only to legacy manual-cancel flows with an actual connected transfer; auto-cancel refunds on platform-held PIs do not set it

DB mutation: calls `fn_cancel_shipment(p_shipment_id, p_cancelled_by_role : 'buyer' | 'seller', p_reason)` using a service-role Supabase client after Edge Function actor validation and refund sequencing.

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

- Cancels shipments where no tracking label was created within `order_expiration_hours` (default 48h)
- Uses shared `computeShipmentRefundAmountCents` from `_shared/refund-basis.ts` for buyer-paid refund amount
- Refund excludes seller-paid shipping; caps against actual charge when available
- Calls `fn_cancel_shipment(p_shipment_id, 'system', ...)` via service-role client for atomic rollback

### auto-cancel-preparing

- Cancels shipments in `preparing` without carrier scan after `preparing_expiration_hours` (default 72h)
- Uses shared `computeShipmentRefundAmountCents` from `_shared/refund-basis.ts` for buyer-paid refund amount
- Refund excludes seller-paid shipping; caps against actual charge when available
- Calls `fn_cancel_shipment(p_shipment_id, 'system', ...)` via service-role client for atomic rollback

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
    canCancel: boolean;             // (isBuyer || isSeller) && status='paid'
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

- `useShipments(orderId)` — fetches shipments with items/products/seller/dispute joins; computes `permissions.canCancel` as `(isBuyer || isSellerOwnShipment) && status === 'paid'`
- `useOrderActions` — `generateLabel({ shipmentId })`, `confirmDelivery({ shipmentId })`, `cancelOrder({ shipmentId })` overloads
- `useCancellationSettings` — exposes `orderExpirationHours`/`preparingExpirationHours` from `useSystemConfig` with 48/72 fallbacks

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
