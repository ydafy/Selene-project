# Delta for Single-Modal Multi-Seller Checkout

## MODIFIED Requirements

### Requirement: Buyer Summary Hides Seller Settlement Split

The system MUST render the checkout summary with `SummaryBreakdown`, MUST NOT display per-seller net, commission, or shipping split, and MUST display the grossed-up buyer processing line computed by the shared helper.
(Previously: summary did not include a grossed-up processing line.)

#### Scenario: Payment screen

- GIVEN a multi-seller order subtotal
- WHEN the payment screen renders
- THEN `SummaryBreakdown` shows the grossed-up processing line and total
- AND `SellerPaymentBreakdown` is absent

#### Scenario: Backend/frontend agreement

- GIVEN a reserved cart grouped by seller
- WHEN the frontend summary and backend PaymentIntent are computed
- THEN both totals match within 1 cent

### Requirement: Single Platform PaymentIntent

The system MUST create one platform-account PaymentIntent in MXN for the grossed-up buyer-visible total and MUST NOT create per-seller PaymentIntents. The PaymentIntent amount MUST equal the shared helper output for the order subtotal plus buyer-paid shipping. The PaymentIntent metadata MUST include `grossed_up_total_cents` and `domestic_seguro_cents`.
(Previously: PaymentIntent amount was derived from the legacy `seguro` formula.)

#### Scenario: Create checkout intent

- GIVEN a reserved cart grouped by seller
- WHEN `create-connect-payment` runs
- THEN it returns one `clientSecret`, one `transferGroup`, and the grossed-up buyer-visible total
- AND the PaymentIntent omits `transfer_data.destination` and `application_fee_amount`

#### Scenario: Seller-paid shipping

- GIVEN items with seller-paid shipping costs
- WHEN the PaymentIntent amount is computed
- THEN the buyer total excludes shipping costs
- AND the gross-up applies only to the subtotal plus buyer-paid shipping

#### Scenario: Multi-seller total

- GIVEN a cart with items from two sellers and buyer-paid shipping
- WHEN the PaymentIntent is created
- THEN the amount equals the grossed-up total of the combined item subtotal and buyer-paid shipping

### Requirement: Durable Per-Shipment Allocation

The system MUST persist per-shipment/per-item allocation before marking the order `paid`, including gross amount, service fee, seller-paid shipping, seller net, the shipment's proportional share of the grossed-up buyer fee (`seguro_cents`), `payment_intent_id`, and `transfer_group`.
(Previously: allocation did not include the grossed-up buyer fee share.)

#### Scenario: Payment succeeds

- GIVEN the platform PaymentIntent succeeds
- WHEN the order and shipments are created
- THEN each `order_item` stores `commission_amount`, `shipping_amount`, `shipping_payer='seller'`, and `net_payout`
- AND each `shipment` stores the platform `stripe_payment_intent_id` and its `seguro_cents`

#### Scenario: Allocation write fails

- GIVEN the PaymentIntent succeeds but allocation persistence fails
- WHEN the failure is detected
- THEN the order stays in `payment_processing` and is surfaced to admin/ops recovery without becoming `paid`

## ADDED Requirements

### Requirement: Shared Gross-Up Helper

The system MUST use a single shared integer-cents helper for frontend summary, backend PaymentIntent amount, and per-shipment allocation. The helper MUST be pure and side-effect-free.

#### Scenario: Helper consistency

- GIVEN any domestic MX cart subtotal
- WHEN the helper is called from frontend, backend, and allocation
- THEN all three callers receive the same integer-cents result

## Acceptance Criteria

- One PaymentSheet modal and one platform charge for any checkout.
- Buyer summary displays the grossed-up processing line.
- Backend and frontend totals agree within 1 cent.
- Allocation records include per-shipment `seguro_cents`.
- `service_fee_amount` remains seller commission only.
