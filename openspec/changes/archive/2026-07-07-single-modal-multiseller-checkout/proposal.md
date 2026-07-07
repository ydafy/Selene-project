# Proposal: Single-Modal Multi-Seller Checkout

## Intent

Replace the current per-seller PaymentSheet loop with one buyer payment modal and one card charge for multi-seller orders. The checkout must stay simple for buyers, while backend settlement remains seller-scoped, retry-safe, and compatible with Selene's manual admin payout release model.

## Scope

### In Scope
- Single platform `PaymentIntent` for the full order total (`SummaryBreakdown` stays primary UX).
- Backend allocation ledger per shipment/seller; no buyer-facing seller net/commission/shipping split.
- Store Stripe `transfer_group` plus compatibility IDs for future cancel/dispute/refund/release flows.

### Out of Scope
- Automatic seller payout after payment success.
- Deep cancel/dispute/refund implementation.
- Buyer-visible `SellerPaymentBreakdown` in checkout.

## Capabilities

### New Capabilities
- `single-modal-multiseller-checkout`: one buyer charge, shared payment state, backend allocation records, retry-safe `payment_processing` recovery.

### Modified Capabilities
- `connect-payout-release`: manual admin release remains the only seller cash-out path; it must consume the new settlement identifiers.
- `shipments`: persist Stripe settlement references needed for later release/reversal compatibility.

## Approach

Create one platform charge at checkout, keyed with `transfer_group`, and persist per-shipment allocation rows instead of creating per-seller buyer charges. Do **not** auto-transfer to sellers on payment success. If post-payment allocation/settlement work fails transiently, keep the order in `payment_processing` and let ops/admin recovery complete the transfer/release step later. Manual admin release after shipment completion remains the only seller payout trigger.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/frontend/core/hooks/usePaymentProcess.ts` | Modified | One PaymentSheet flow; remove seller loop |
| `apps/frontend/core/store/useCheckoutStore.ts` | Modified | Single client secret / no seller index |
| `apps/frontend/app/checkout/payment.tsx` | Modified | Keep `SummaryBreakdown`; remove `SellerPaymentBreakdown` |
| `supabase/functions/create-connect-payment/index.ts` | Modified | Create one platform PI and settlement metadata |
| `supabase/functions/stripe-webhooks/index.ts` | Modified | Persist payment + allocation state, idempotently |
| `supabase/functions/release-connect-payout/index.ts` | Modified | Manual release continues from shipment-level records |
| `packages/types/src/index.ts` | Modified | Update checkout/payment contracts |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Payment succeeds but settlement write fails | Med | Retry-safe `payment_processing` + idempotent recovery |
| Refund/dispute paths need later contract work | High | Persist Stripe IDs/status now for compatibility |

## Rollback Plan

Re-enable the existing per-seller PaymentSheet flow, keep manual payout release unchanged, and ignore the new single-charge settlement fields until the new path is stable.

## Dependencies

- Existing Stripe Connect manual-release flow and settlement IDs.
- Supabase schema/types updates for shipment-level Stripe references.

## Success Criteria

- [ ] Buyer completes checkout through one modal and one charge.
- [ ] Seller allocation is stored internally without exposing commission/net breakdown to buyers.
- [ ] Manual admin payout release still controls seller cash-out after shipment completion.
