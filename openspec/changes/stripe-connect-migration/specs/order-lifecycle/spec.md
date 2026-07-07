# Delta for Order Lifecycle

## MODIFIED Requirements

### Requirement: Connect Dispute Refunds (replaces existing resolve-dispute-refund section)

The `resolve-dispute-refund` edge function MUST route by shipment type: for Connect shipments (`shipments.stripe_payment_intent_id IS NOT NULL`), it MUST call `stripe.refunds.create({ reverse_transfer: true })` and MUST NOT call `fn_complete_shipment_refund`. For legacy shipments, it MUST use the existing wallet rollback path. The `fn_complete_shipment_refund` SQL function MUST include a guard: `WHERE stripe_payment_intent_id IS NULL` to prevent wallet double-writes during dual-path period.
(Previously: resolve-dispute-refund called Stripe refund then unconditionally called fn_complete_shipment_refund for wallet rollback)

#### Scenario: Admin triggers refund after buyer-wins dispute (Connect)

- GIVEN a Connect-era dispute with `shipment_id` where `stripe_payment_intent_id IS NOT NULL`
- WHEN admin triggers refund
- THEN the system calls `stripe.refunds.create({ reverse_transfer: true })`, updates DB status, and does NOT call `fn_complete_shipment_refund`

#### Scenario: Admin triggers refund after buyer-wins dispute (Legacy)

- GIVEN a legacy-era dispute where `stripe_payment_intent_id IS NULL`
- WHEN admin triggers refund
- THEN the system calls Stripe refund and `fn_complete_shipment_refund` for wallet rollback

#### Scenario: Seller has insufficient Connect balance for refund

- GIVEN a Connect refund with `reverse_transfer: true` where seller balance is insufficient
- WHEN Stripe processes the refund
- THEN Stripe creates a negative balance on the seller's connected account (per `losses.payments: stripe`) and the system logs the audit entry

#### Scenario: Refund for legacy wallet-era order

- GIVEN a dispute from before Connect cutover
- WHEN admin triggers refund
- THEN the system uses the legacy wallet rollback path via `fn_complete_shipment_refund`

### Requirement: Return Shipping on Connected Account (replaces existing return shipping section)

The `create-return-intent` edge function MUST create a PaymentIntent on the seller's connected account (`on_behalf_of = seller.stripe_account_id`) for the flat return shipping cost defined in `system_settings.return_shipping_cost_mxn`. The `generate-return-label` function MUST gate on seller `stripe_account_id` presence and `charges_enabled = true`.
(Previously: return shipping used platform-level PaymentIntent without connected account routing)

#### Scenario: Seller pays for return label after buyer-wins verdict

- GIVEN a buyer-wins dispute on a Connect-era shipment
- WHEN the seller initiates return label generation
- THEN the system creates a PaymentIntent on the seller's connected account for the configured return shipping cost

#### Scenario: Return label payment fails due to insufficient funds

- GIVEN a seller with insufficient funds on their connected account
- WHEN the return shipping PaymentIntent is created
- THEN the system returns a payment failure error and blocks label generation
