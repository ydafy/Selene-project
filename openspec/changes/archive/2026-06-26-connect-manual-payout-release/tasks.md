# Tasks: Connect Manual Payout Release

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650-930 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (DB+Types) → PR 2 (Edge Functions) → PR 3 (Reconcile+Disputes) → PR 4 (Admin UI) → PR 5 (Mobile fixes) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB schema + shared types | PR 1 | Foundation; no backend logic |
| 2 | Release + queue Edge Functions | PR 2 | Depends on PR 1; core backend |
| 3 | Webhook reconcile + dispute scoping | PR 3 | Depends on PR 1; shipment-ctx fixes |
| 4 | Admin release queue UI | PR 4 | Depends on PR 1+2 |
| 5 | Mobile dispute context fix | PR 5 | Depends on PR 3 |

## Phase 1: DB Schema & Types (PR 1)

- [x] 1.1 Create migration: `connect_payout_runs` table (idempotency_key UNIQUE, seller_id, amount, status, actor_id, stripe_payout_id, timestamps)
- [x] 1.2 Create `connect_payout_run_shipments` (shipment_id FK, run_id FK, net_payout, UNIQUE shipment per terminal status)
- [x] 1.3 Create `admin_connect_payout_release_view` with eligibility gates, `release_amount_cents`, ineligible reason
- [x] 1.4 Add unique partial index on shipment_id where status is terminal; FK indexes; service-role-only grants
- [x] 1.5 Regenerate `packages/types/src/database.types.ts`
- [x] 1.6 Add typed contracts to `packages/types/src/index.ts` for release/queue/dispute APIs

## Phase 2: Backend Core (PR 2)

- [x] 2.1 Convert `release-connect-payout` to admin POST with role check + idempotency guard
- [x] 2.2 Validate batch: all shipments completed, no dispute, seller payout-ready, Connect account active
- [x] 2.3 Compute amount from `order_items.net_payout` by shipment IDs; persist run + mappings before Stripe
- [x] 2.4 Call `stripe.payouts.create` with batch amount; mark run `pending_reconciliation`
- [x] 2.5 Create `get-connect-payout-release-queue` Edge Function returning eligible sellers + rejected reasons + amounts

## Phase 3: Reconciliation & Dispute Scoping (PR 3)

- [x] 3.1 Handle `payout.paid` in `stripe-webhooks`: update run → paid, mark shipments released exactly once
- [x] 3.2 Handle `payout.failed`/`payout.canceled`: update run status, set `reconciliation_needed` on partial failure
- [x] 3.3 Modify `create-dispute`: require `shipmentId`, verify shipment belongs to order, reject invalid context
- [x] 3.4 Derive dispute `seller_id` from `shipments.seller_id` instead of order-first-item fallback

## Phase 4: Admin Web UI (PR 4)

- [x] 4.1 Add `useConnectPayoutReleaseQueue` hook: query queue + release mutation, typed from shared contracts
- [x] 4.2 Add release queue section to PaymentsPage: eligible seller batch, select shipments, release action
- [x] 4.3 Add disabled states for ineligible shipments, eligibility reason tooltips, reconciliation indicators

## Phase 5: Mobile Frontend Fixes (PR 5)

- [x] 5.1 Read `shipment_id` from search params in `report/[id].tsx`; reject dispute creation without it
- [x] 5.2 Add `shipmentId` to `openDispute` payload and query invalidations in `useOrderActions`
