# Stripe Fee Gross-Up Specification

## Purpose

Define deterministic domestic MXN Stripe fee gross-up, actual-fee reconciliation, and auditable platform loss for buyer charges.

## Requirements

### Requirement: Domestic MXN Integer-Cent Gross-Up

The system MUST compute the domestic Mexico buyer charge as `charge_cents = ceil((subtotal_cents + 348) * 100_000 / 95_824)`, covering Stripe's 3.6% of total + MXN 3 fixed fee plus 16% VAT on the fee. The system MUST use one shared, pure, side-effect-free helper for backend PaymentIntent creation and frontend checkout summary.

#### Scenario: Typical cart

- GIVEN a cart subtotal of MXN 5,000.00 (500,000 cents)
- WHEN the helper is called from backend and frontend
- THEN both return 522,154 cents
- AND the buyer total equals that value

#### Scenario: Small subtotal

- GIVEN a subtotal of MXN 10.00 (1,000 cents)
- WHEN the helper is called
- THEN it returns a positive integer that covers the MXN 3 fixed fee and VAT
- AND the slack is at most 2 cents

### Requirement: Bounded Rounding Slack

The system MAY collect up to 2 cents of rounding slack per charge. The system MUST NOT under-collect the domestic Stripe fee.

#### Scenario: Slack accrues to platform

- GIVEN a subtotal of MXN 5,000.00
- WHEN the grossed-up charge succeeds
- THEN the platform keeps any slack as margin
- AND the collected amount is never below Stripe's actual domestic cost

#### Scenario: Exact integer

- GIVEN a subtotal where the formula yields an exact integer
- WHEN the charge is computed
- THEN the slack is zero cents

### Requirement: Authoritative Actual Fee Reconciliation

The system MUST persist `orders.actual_stripe_fee_cents` and `orders.stripe_fee_reconciled_at` from the `payment_intent.succeeded` webhook using `BalanceTransaction.fee` as the authoritative value. If reconciliation is unavailable, both columns MUST remain NULL.

#### Scenario: Successful reconciliation

- GIVEN a charge whose `BalanceTransaction.fee` is 21,992 cents
- WHEN the webhook processes `payment_intent.succeeded`
- THEN `actual_stripe_fee_cents` is set to 21992
- AND `stripe_fee_reconciled_at` is set to the processing time

#### Scenario: Missing balance transaction

- GIVEN a succeeded event where the balance transaction cannot be retrieved
- WHEN the webhook runs
- THEN both reconciliation columns remain NULL
- AND order creation continues normally

### Requirement: Cancellation Loss Auditability

The system MUST compute platform loss for a cancelled shipment as the shipment's proportional share of `orders.actual_stripe_fee_cents`. The system MUST persist it in `orders.cancellation_loss_cents`. If the actual fee is unreconciled, the loss MUST be NULL.

#### Scenario: Reconciled fee

- GIVEN an order with two equal shipments and `actual_stripe_fee_cents` of 20,000
- WHEN one shipment is cancelled
- THEN `cancellation_loss_cents` is set to 10,000
- AND the buyer receives a full refund of the shipment's buyer-paid amount

#### Scenario: Unreconciled fee

- GIVEN an order with `actual_stripe_fee_cents` NULL
- WHEN a shipment is cancelled
- THEN `cancellation_loss_cents` is NULL
- AND the buyer is still refunded in full

### Requirement: Seller Commission Semantics Unchanged

The system MUST keep `orders.service_fee_amount` and per-item `commission_amount` as seller-side commission only. The grossed-up buyer fee MUST NOT be stored in `service_fee_amount`.

#### Scenario: Allocation persists commission

- GIVEN a checkout with a grossed-up buyer fee
- WHEN allocation is written
- THEN `service_fee_amount` reflects seller commission
- AND does not include the Stripe fee

### Requirement: Explicit Non-Goals

The system MUST NOT apply the domestic gross-up to international cards, Adaptive Pricing, multi-currency, saved-card classification, post-charge buyer reconciliation UX, admin badges, dispute-module changes, or shipping insurance.

#### Scenario: International card treated as domestic estimate

- GIVEN a charge that Stripe classifies as international
- WHEN the checkout helper runs
- THEN it still returns the domestic estimate
- AND any under-collection is accepted as a documented non-goal

## Acceptance Criteria

- Backend and frontend produce the same grossed-up charge for every domestic MX subtotal within a ±1 cent test tolerance until VAT rounding is confirmed by a second data point.
- `actual_stripe_fee_cents` and `stripe_fee_reconciled_at` are written by the success webhook.
- Cancellation loss is the proportional share of the actual fee and is NULL when unreconciled.
- `service_fee_amount` remains seller commission only.

## Non-Goals

- International card surcharge handling.
- Adaptive Pricing or multi-currency.
- `payment_methods` schema changes.
- `system_settings` alert thresholds.