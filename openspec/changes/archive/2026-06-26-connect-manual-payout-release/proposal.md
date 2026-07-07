# Proposal: Connect Manual Payout Release

## Intent

Stripe Connect payouts are already configured as manual, but the approved migration contract still says automatic Stripe payouts. Selene needs the proposal updated to match the real escrow-like business rule: admins release seller funds only after shipment-level completion safety. Before that release can be trusted, dispute, routing, and payout logic must stop using order-level shortcuts that can target the wrong seller or amount.

## Proposal question round / assumptions

- Assumptions confirmed: Selene-controlled manual release, shipment-scoped disputes, admin queue in-product, and no refund path after completion in v1.0.

## Scope

### In Scope

- Admin “Payments / release funds” queue for eligible Connect shipments.
- Shipment-scoped payout eligibility, dispute/report context, and seller-safe payout amount calculation.
- Payout-run persistence, audit trail, and Stripe payout reconciliation.

### Out of Scope

- `shipment-cancel-safety` follow-up.
- Prepare-label `shipment_id` cleanup, notification deep-link polish, and evidence storage cleanup.

## Capabilities

### New Capabilities

- `connect-payout-release`: Admin queue and controlled payout action for eligible Connect shipments, with seller batching, idempotency, and shipment mapping.
- `connect-payout-reconciliation`: Payout-run tracking plus webhook/retry reconciliation for paid/failed payout outcomes.

### Modified Capabilities

- `shipments`: Require shipment-scoped dispute creation, order/report routing with `shipment_id`, and payout eligibility/read models keyed by shipment and seller.

## Approach

Use a Selene-admin release flow, not Stripe automatic rolling payouts. A shipment is releasable only when `shipments.status = 'completed'`, no active shipment dispute exists, the seller is payout-ready, and the release amount comes from shipment-level money data rather than the seller’s full Stripe balance. Admin release may batch multiple eligible shipments for one seller into one payout, but the run must persist shipment ids, amounts, actor, Stripe payout id, and reconciliation state.

## Affected Areas

| Area                                                 | Impact   | Description                                                          |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `supabase/functions/release-connect-payout/index.ts` | Modified | Replace full-balance payout behavior with shipment-safe release runs |
| `supabase/functions/create-dispute/index.ts`         | Modified | Persist shipment-scoped dispute context                              |
| `supabase/functions/stripe-webhooks/index.ts`        | Modified | Reconcile payout lifecycle events                                    |
| `apps/admin-web/src/pages/PaymentsPage.tsx`          | Modified | Add release queue and action UX                                      |

## Risks

| Risk                                     | Likelihood | Mitigation                                                                          |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| Wrong seller/shipment released           | High       | Block release on missing `shipment_id`, shipment read model, or scoped dispute data |
| Stripe payout succeeds but DB sync fails | Med        | Persist payout runs and add webhook/retry reconciliation                            |

## Rollback Plan

Disable the admin release action, stop creating new payout runs, and fall back to manual ops review in Stripe Dashboard while keeping payout-run records for reconciliation. Do not mark shipments released from UI-only state.

## Dependencies

- Existing `stripe-connect-migration` rollout, Stripe payout events enabled, and regenerated shared types after schema changes.

## Success Criteria

- [ ] Admin can release only eligible completed shipments, never a seller’s full available balance.
- [ ] Multi-seller disputes and report flows resolve the correct `shipment_id`, seller, and shipment detail context.
- [ ] Every payout run is auditable and reconciled for success/failure without duplicate releases.
