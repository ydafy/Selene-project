# Delta for Shipments

## MODIFIED Requirements

### Requirement: Order Item net_payout Calculation

The `net_payout` stored in `order_items` by `fn_create_order_from_payment` MUST include SAT tax withholding as a deduction. The formula changes from:

```sql
-- Before:
net_payout = price - (price * commission_pct) - COALESCE(shipping_cost, 0)

-- After:
sat_tax_withholding = price * (isr_pct + iva_pct)
net_payout = price - (price * commission_pct) - sat_tax_withholding - COALESCE(shipping_cost, 0)
```

(Previously: `net_payout` only deducted commission and shipping, omitting legally-required SAT withholding)

#### Scenario: Downstream functions inherit correct net_payout

- GIVEN `fn_create_order_from_payment` stores `net_payout` with SAT withholding included
- WHEN `fn_release_shipment_funds`, `fn_complete_shipment_refund`, `fn_cancel_order`, `fn_cancel_shipment`, or `fn_resolve_dispute_to_seller` read `SUM(net_payout)` from `order_items`
- THEN they produce correct values automatically — no function-level changes needed

#### Scenario: Refund reverses the full net_payout including withholding

- GIVEN a shipment with `net_payout = 720` (which includes the $90 withholding already deducted)
- WHEN `fn_complete_shipment_refund` processes a refund
- THEN the seller's pending balance is reduced by $720 — the refund reversal is correct because the original credit was also $720