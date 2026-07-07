# Tasks: Stripe Connect Express Migration

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Estimated changed lines: ~900-1,300
Suggested split: PR 1 → PR 2 → PR 3
Delivery strategy: ask-on-risk

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Schema + SDK bump | PR 1 | tracker branch base |
| 2 | Onboarding + checkout | PR 2 | base = PR 1 |
| 3 | Lifecycle + cleanup | PR 3 | base = PR 2 |

Cross-cutting: run `bun db:types` after each schema/RPC migration; update `packages/types/src/database.types.ts` and `packages/types/src/index.ts`.

## Phase 1 — Freeze

- [x] T-001 | Add freeze migration for `stripe_onboarding_status`, `profiles_private.stripe_account_id`, `shipments.stripe_payment_intent_id`, `system_settings.connect_enabled`, and nullable `orders.stripe_payment_intent_id` | Depends: - | Files: `supabase/migrations/20260603000000_stripe_connect_schema.sql`, `packages/types/src/database.types.ts`, `packages/types/src/index.ts` | L | AC: migration applies; regenerated types expose new fields.
- [x] T-002 | Upgrade Stripe SDK/API version to `2026-04-22.dahlia` and register Connect webhook/test-account setup | Depends: T-001 | Files: `supabase/functions/create-payment-intent/index.ts`, `stripe-webhooks/index.ts`, `resolve-dispute-refund/index.ts`, `create-return-intent/index.ts`, `manage-payment-methods/index.ts`, `auto-cancel-orders/index.ts`, `auto-cancel-preparing/index.ts`, `cancel-order/index.ts`, `generate-return-label/index.ts` | M | AC: edge functions compile on one pinned version; webhook endpoint is ready.

## Phase 2 — Onboarding

- [x] T-003 | Create `create-connect-account` + seller onboarding hook/screen + admin tracking view | Depends: T-001,T-002 | Files: `supabase/functions/create-connect-account/index.ts`, `apps/frontend/core/hooks/useConnectOnboarding.ts`, `apps/frontend/app/sell/onboarding.tsx`, `apps/admin-web/src/pages/SellerOnboardingPage.tsx`, `apps/admin-web/src/hooks/useSellerOnboarding.ts`, `apps/admin-web/src/App.tsx` | L | AC: onboarding starts pending; admin sees seller status.

## Phase 3 — Checkout Cutover

- [x] T-004 | Rewrite `create-payment-intent`, add Connect RPCs, and route dual-path webhooks | Depends: T-003 | Files: `supabase/functions/create-payment-intent/index.ts`, `supabase/functions/stripe-webhooks/index.ts`, `supabase/queries/orders/fn_create_shipment_from_payment.sql`, `supabase/queries/orders/fn_create_order_from_payment.sql` | L | AC: one PI per seller; legacy and Connect events stay isolated.
- [x] T-005 | Update cart/checkout state and UI for multi-PI confirmation | Depends: T-004 | Files: `apps/frontend/core/store/useCartStore.ts`, `apps/frontend/core/store/useCheckoutStore.ts`, `apps/frontend/core/hooks/usePaymentProcess.ts`, `apps/frontend/app/checkout/index.tsx`, `apps/frontend/app/checkout/payment.tsx` | L | AC: UI shows seller breakdown and confirms each charge safely.

## Phase 4 — Order Lifecycle

- [x] T-006 | Disable release-cron, guard order derivation, and add `reconcile-connect-payments` replay | Depends: T-004,T-005 | Files: `supabase/queries/triggers/shipments/fn_cron_release_shipment_funds.sql`, `supabase/queries/orders/fn_derive_order_status.sql`, `supabase/queries/shipments/fn_release_shipment_funds.sql`, `supabase/functions/reconcile-connect-payments/index.ts` | M | AC: Connect shipments bypass wallet release; missed webhooks can replay.

## Phase 5 — Disputes & Refunds

- [x] T-007 | Switch refunds/returns to Connect-aware flows | Depends: T-003,T-006 | Files: `supabase/functions/resolve-dispute-refund/index.ts`, `supabase/queries/shipments/fn_complete_shipment_refund.sql`, `supabase/functions/resolve-dispute/index.ts`, `supabase/functions/create-return-intent/index.ts` | L | AC: buyer-wins uses `reverse_transfer`; return labels charge the connected account.

## Phase 6 — Legacy Drain & Cleanup

- [x] T-008 | Create legacy drain job and admin execution dashboard | Depends: T-003,T-006 | Files: `supabase/functions/drain-legacy-wallets/index.ts`, `apps/admin-web/src/pages/DrainLegacyWalletsPage.tsx`, `apps/admin-web/src/hooks/useDrainLegacyWallets.ts` | L | AC: only successful transfers zero wallets; failures stay auditable.
- [x] T-009 | Deprecate legacy payout SQL/functions, replace payments overview with Connect earnings, and remove mobile wallet/BBVA UI | Depends: T-008 | Files: `supabase/queries/payments/fn_request_payout.sql`, `supabase/queries/shipments/fn_complete_shipment_refund.sql`, `supabase/queries/shipments/fn_release_shipment_funds.sql`, `supabase/queries/triggers/shipments/fn_cron_release_shipment_funds.sql`, `supabase/migrations/*connect_earnings*`, `apps/admin-web/src/pages/PaymentsPage.tsx`, `apps/admin-web/src/hooks/usePayoutRequests.ts`, `apps/admin-web/src/hooks/useUpdatePayoutStatus.ts`, `apps/frontend/app/profile/wallet.tsx`, `apps/frontend/app/profile/withdraw.tsx`, `apps/frontend/core/store/useWalletStore.ts` | L | AC: legacy payout paths are read-only/removed and no shipped UI depends on them.
