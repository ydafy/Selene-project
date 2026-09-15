# Delta for Shipments

## MODIFIED Requirements

### Requirement: get-shipping-quote returns deterministic single-origin quote

`get-shipping-quote` MUST return exactly one Paquetexpress Ground MXN rate per seller's real valid Mexican origin ZIP, preset dimensions, and declared value. Its listing reference destination defaults to ZIP `06500`. It MUST reject other carriers, services, and any `ground_do`/`ground_od` option. No fallback is permitted.
(Previously: accepted multi-item multi-origin rates per product shipment.)

#### Scenario: Seller real origin with reference destination

- GIVEN origin ZIP `64000` and no destination ZIP
- WHEN the function runs
- THEN one Paquetexpress Ground MXN rate is returned
- AND the reference destination ZIP is `06500`

#### Scenario: Non-matching service rejected

- GIVEN an Envia response includes `ground_od`
- WHEN the filter runs
- THEN the quote is rejected with an error

### Requirement: Shipments Expose Allocation Correlation Fields

The system MUST store the fixed seller shipping reserve from the product publication snapshot in `shipments.shipping_cost` and `order_items.shipping_amount` with `shipping_payer = 'seller'`, `commission_amount`, and `net_payout`. `shipments.shipping_cost` MUST be integer cents; `order_items.shipping_amount` MUST be decimal MXN pesos. The shipment MUST transition to `paid` only after allocation persistence succeeds.
(Previously: stored `shipping_cost` as buyer-paid shipping without snapshot sourcing or unit separation.)

#### Scenario: Allocation persisted

- GIVEN one shipment with price `100,000` cents, snapshot commission `8,000` cents, snapshot reserve `18,200` cents
- WHEN allocation is computed
- THEN `shipments.shipping_cost = 18200` cents, `order_items.shipping_amount = 182.00` pesos, `shipping_payer = 'seller'`, `net_payout = 73,800` cents, and status is `paid`

#### Scenario: Missing allocation blocks paid

- GIVEN allocation persistence fails
- WHEN the flow completes
- THEN the shipment MUST NOT be marked `paid`

### Requirement: Stripe Shipment Refund Safety

The system MUST refund a shipment the subtotal plus proportional grossed-up buyer-paid fee, persist `cancellation_loss_cents` as the proportional `actual_stripe_fee_cents` share, exclude the seller shipping reserve recorded in `shipments.shipping_cost` and `order_items.shipping_amount`, block on `stripe_transfer_id`, and include `shipment_id`, `order_id`, caller role, reason, and `seguro_share_cents` in metadata.
(Previously: excluded seller-paid shipping without naming the reserve.)

#### Scenario: Partial refund amount

- GIVEN a `paid` shipment with subtotal `100,000` cents and reserve `18,200` cents
- WHEN the refund is created
- THEN the amount equals subtotal plus fee share, excludes reserve, and `cancellation_loss_cents` and idempotency key `cancel_shipment_{shipmentId}` are set

#### Scenario: Remaining refundable cap

- GIVEN a known remaining refundable amount
- WHEN the computed refund exceeds it
- THEN the endpoint rejects before Stripe with a refund-cap error

#### Scenario: Transfer already exists

- GIVEN `stripe_transfer_id IS NOT NULL`
- WHEN cancellation is requested
- THEN the system logs CRITICAL and refuses the refund

#### Scenario: Refund metadata

- GIVEN a valid cancellation refund
- WHEN the refund is created
- THEN metadata includes `shipment_id`, `order_id`, caller role, reason, and `seguro_share_cents`

### Requirement: Shipment-Scoped Cron Regression

The auto-cancel crons MUST remain shipment-scoped, use `order_expiration_hours` and `preparing_expiration_hours`, compute refund from the grossed-up buyer-paid fee excluding the seller shipping reserve recorded in `shipments.shipping_cost` and `order_items.shipping_amount`, and persist cancellation loss when reconciled.
(Previously: excluded seller-paid shipping without naming the reserve.)

#### Scenario: Cron processes one shipment

- GIVEN a multi-shipment order where one shipment times out
- WHEN the cron runs
- THEN only that shipment is cancelled/refunded, the buyer-paid fee basis is used, reserve is excluded, and `cancellation_loss_cents` is set when reconciled

## ADDED Requirements

### Requirement: Label Generation Records Evidence and Branch Handoff

`generate-shipping-label` MUST validate `paid` status, null tracking, seller/admin caller, anti-fraud limit, and Paquetexpress Ground MXN evidence. It MUST atomically set `preparing`, tracking, label, carrier, evidence, input hash, and `label_provider_cost_cents` as evidence only.
(Previously: atomic update did not reference evidence-only cost.)

#### Scenario: Label generated

- GIVEN a valid `paid` shipment with matching evidence
- WHEN the seller generates the label
- THEN status is `preparing`, `label_provider_cost_cents` is recorded, and branch-handoff guidance is shown

## Acceptance Criteria

- No stale buyer-pays shipping text remains.
- Single-origin quote, seller-paid reserve, and claim orchestration are explicit.
- Refund/cron exclude the seller shipping reserve.
- Branch-admission proof recorded before rollout.
