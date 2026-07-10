# Proposal: Shipment Cancel Safety

## Intent

Prevent cancel actions from acting like whole-order refunds. The product concept of whole-order cancellation is deprecated; cancellation must be shipment-scoped for manual flows, while keeping the deployed `cancel-order` Edge Function name for compatibility.

## Scope

### In Scope
- Buyer manual cancellation only for `paid` shipments.
- `preparing` remains cron-only cancellation by timeout.
- `shipped+` routes to dispute/support, not cancellation.
- Shipment-only Stripe refund with explicit partial `amount`, shipment idempotency, metadata, and a `stripe_transfer_id` defensive block.
- Order detail SLA notices read live `system_settings` via `useSystemConfig`; keep the buyer unboxing/video notice.

### Out of Scope
- Disputes feature work.
- Rewriting the crons beyond consistency fixes.
- Renaming the deployed `cancel-order` function.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `shipments`: manual cancel eligibility, refund safety, and SLA copy become shipment-scoped and config-driven.

## Approach

- Keep `cancel-order` as the public function name, but make its behavior shipment-scoped for manual cancellation; add a clear legacy-name note.
- Reuse existing `fn_cancel_shipment` and the mostly-correct crons; do not broaden scope into dispute logic.
- Read cancellation SLA values from `system_settings` through the existing `useSystemConfig` hook.
- Gate the manual cancel endpoint with `system_settings.is_maintenance` as the emergency stop.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/cancel-order/index.ts` | Modified | Preserve legacy name, switch manual path to shipment scope. |
| `supabase/queries/orders/fn_cancel_shipment.sql` | Reused | Authoritative shipment cancel primitive. |
| `apps/frontend/app/profile/orders/[id].tsx` | Modified | Keep shipment cancel CTA and unboxing warning; wire shipment scope. |
| `apps/frontend/components/features/orders/OrderActionCard.tsx` | Modified | SLA copy/timers use live system settings values. |
| `apps/frontend/core/hooks/useSystemConfig.ts` | Reused | Source for real `system_settings` values. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legacy name confuses maintainers | Med | Add explicit legacy-name comment and scope docs. |
| Refunds drift from shipment amount | Low | Ship explicit shipment amount + idempotency. |
| Emergency stop blocks legitimate cancels | Low | Maintenance flag only for incident response. |

## Rollback Plan

Restore the previous `cancel-order` behavior and frontend call shape, keep `fn_cancel_shipment` unchanged, and disable the new maintenance gate if needed. No schema rollback expected.

## Dependencies

- Existing shipment model and `useSystemConfig` hook.
- Current `system_settings` row values.

## Success Criteria

- [ ] Manual buyer cancellation works only for `paid` shipments.
- [ ] `preparing` cancellation stays cron-only.
- [ ] Order-detail SLA copy matches live `system_settings` values.
- [ ] `cancel-order` remains compatible by name, but not by old whole-order behavior.
