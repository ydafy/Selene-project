# Design: Connect Manual Payout Release

## Technical Approach

Replace the cron-style `release-connect-payout` with an admin-only, shipment/batch-scoped release workflow. The database becomes the source of truth for eligibility, selected shipments, payout amount, idempotency, and reconciliation. Stripe is called only after the requested shipment batch is locked and validated.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Keep current full-balance payout | Simple, but pays the seller's whole available Stripe balance and cannot map funds safely to shipments. | Reject. Compute release amount from selected `order_items.net_payout` by `shipment_id`. |
| Release one payout per shipment | Maximum traceability, but creates excess Stripe payouts. | Batch eligible shipments for one seller into one payout run, with per-shipment mapping rows. |
| UI-only release state | Fast, but unrecoverable after Stripe/DB partial failure. | Persist payout run before Stripe call and reconcile via webhook/retry. |
| Public table reads | Easier frontend access, but finance data is admin-only. | Use service-role Edge Functions with explicit admin checks, matching `get-connect-earnings`. |

## Data Flow

    Admin PaymentsPage
      └─ useConnectPayoutReleaseQueue ──→ get-connect-payout-release-queue
              └─ admin_connect_payout_release_view

    Admin selects seller batch
      └─ release-connect-payout {sellerId, shipmentIds, idempotencyKey}
          ├─ validate admin + lock eligible shipments
          ├─ create/reuse connect_payout_runs + shipment mappings
          ├─ Stripe payouts.create(amount=sum shipment net payout, currency=mxn)
          └─ mark run pending_reconciliation

    Stripe payout.paid/failed/canceled
      └─ stripe-webhooks ──→ reconcile run ──→ update run + shipments.stripe_payout_id exactly once

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/*_connect_manual_payout_release.sql` | Create | Add `connect_payout_runs`, `connect_payout_run_shipments`, indexes, constraints, and `admin_connect_payout_release_view`. Regenerate `packages/types/src/database.types.ts`. |
| `supabase/functions/release-connect-payout/index.ts` | Modify | Convert to admin POST mutation; remove balance-wide payout; validate seller batch and idempotency. |
| `supabase/functions/get-connect-payout-release-queue/index.ts` | Create | Admin read API for eligible/rejected reasons and seller grouping. |
| `supabase/functions/stripe-webhooks/index.ts` | Modify | Handle `payout.paid`, `payout.failed`, `payout.canceled` using payout metadata/run id. |
| `supabase/functions/create-dispute/index.ts` | Modify | Require `shipmentId`, verify shipment belongs to order/buyer, derive `seller_id` from `shipments.seller_id`, insert `shipment_id`. |
| `apps/admin-web/src/hooks/useConnectEarnings.ts` | Modify | Split/extend with release queue query and release mutation, typed from shared registry. |
| `apps/admin-web/src/pages/PaymentsPage.tsx` | Modify | Add release queue, selected seller batch action, disabled states, retry/reconcile indicators. |
| `apps/frontend/app/profile/orders/report/[id].tsx` | Modify | Read `shipment_id` from search params and pass it to `openDispute`. Reject missing buyer dispute context. |
| `apps/frontend/core/hooks/useOrderActions.ts` | Modify | Add `shipmentId` to `openDispute` payload and invalidations. |
| `packages/types/src/index.ts` | Modify | Add typed contracts for `release-connect-payout`, `get-connect-payout-release-queue`, and `create-dispute.shipmentId`. |

## Interfaces / Contracts

`release-connect-payout` request: `{ sellerId: string; shipmentIds: string[]; idempotencyKey: string }`.

Response: `{ success: true; runId: string; stripePayoutId?: string; status: 'pending_reconciliation'|'paid'|'failed'|'canceled'|'reconciliation_needed'; amount: number } | { success:false; error:string }`.

Eligibility requires: `shipments.status='completed'`, `completed_at IS NOT NULL`, Connect PI exists, no successful payout mapping, no active `disputes` for the shipment, seller has `profiles_private.stripe_account_id`, and refreshed Connect status is payout-ready. View exposes `release_amount_cents = round(sum(order_items.net_payout) * 100)`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | amount calculation, idempotency reuse, shipment validation, webhook status transitions | `bun test` for pure helpers/handlers with mocked Supabase/Stripe |
| Integration | SQL view eligibility, active dispute exclusion, mapping uniqueness | local Supabase SQL tests or migration fixtures |
| E2E | Admin sees eligible seller batch and releases once; report route preserves `shipment_id` | manual/admin web flow plus Expo route smoke test |

## Migration / Rollout

Deploy DB first with service-role-only grants and indexes on `(seller_id,status,stripe_payout_id)`, `connect_payout_runs(idempotency_key)`, and mapping `shipment_id UNIQUE WHERE terminal success`. Disable existing cron for `release-connect-payout` before enabling the admin button. Keep `shipments.stripe_payout_id` as denormalized compatibility, updated only by reconciliation.

## Open Questions

- [ ] Confirm whether `release_amount_cents` should include shipping/insurance already embedded in `order_items.net_payout` or use a new explicit Connect settlement column.
