## Exploration: connect-manual-payout-release

### Current State
Stripe Connect is already implemented as a destination-charge flow, but the approved `stripe-connect-migration` contract and the shipped code disagree on payouts. `supabase/functions/create-connect-account/index.ts` sets connected accounts to manual payouts, `supabase/functions/release-connect-payout/index.ts` releases funds from Selene, and the admin web `/payments` page is only a read-only Connect earnings view backed by `admin_connect_earnings_view` and `get-connect-earnings`. Order/dispute state is mostly shipment-driven (`shipments`, `fn_derive_order_status`, `track-shipments`, `track-returns`, `resolve-dispute-refund`), but payout release is not yet modeled as a safe admin-controlled workflow.

### Affected Areas
- `supabase/functions/create-connect-account/index.ts` — enables manual Stripe payout scheduling today.
- `supabase/functions/release-connect-payout/index.ts` — existing payout releaser; currently cron-oriented and not admin-driven.
- `supabase/functions/get-connect-earnings/index.ts` — current admin finance read API.
- `apps/admin-web/src/pages/PaymentsPage.tsx` — current finance page; read-only earnings table, no release action.
- `apps/admin-web/src/hooks/useConnectEarnings.ts` — pulls Connect earnings rows only.
- `supabase/migrations/20260613000000_connect_cutover_completion.sql` — defines `admin_connect_earnings_view` and disables legacy payout requests when Connect is enabled.
- `supabase/migrations/20260603000002_connect_payout_tracking.sql` — adds `shipments.stripe_payout_id`, the only current Connect payout tracking field.
- `supabase/functions/resolve-dispute-refund/index.ts` — Connect refunds use `reverse_transfer: true`; payout eligibility must stay compatible with this.
- `supabase/functions/resolve-dispute/index.ts` — seller/buyer verdicts move disputes into payout-affecting states.
- `supabase/functions/track-shipments/index.ts` + `supabase/queries/shipments/fn_mark_shipment_delivered.sql` — drive `delivered` transitions.
- `supabase/queries/shipments/fn_release_shipment_funds.sql` + `supabase/queries/triggers/shipments/fn_cron_release_shipment_funds.sql` — legacy release logic; useful reference for business timing, but not the Connect implementation.
- `supabase/queries/orders/fn_confirm_shipment_delivery.sql` + `supabase/queries/disputes/fn_resolve_dispute_to_seller.sql` — can move shipments to `completed`, which should be the business gate for release.
- `supabase/functions/stripe-webhooks/index.ts` — currently reconciles payment and onboarding events only; no payout event reconciliation exists.
- `supabase/functions/refresh-connect-account-status/refresh-connect-account-status.ts` — existing seller readiness refresh path; release flow should reuse it.
- `supabase/functions/create-dispute/index.ts` — current dispute creation is still order-level and does not persist `shipment_id`, which is a risk for shipment-level payout release.
- `packages/types/src/index.ts` — typed edge registry has no `release-connect-payout` admin contract yet.

### Approaches
1. **Stripe Dashboard manual payouts only** — Ops uses Stripe Dashboard directly and Selene keeps only a read-only internal list.
   - Pros: Lowest implementation effort; good emergency fallback; no new admin mutation API.
   - Cons: Stripe Dashboard does not know Selene business rules (`completed`, dispute state, shipment scope, internal audit intent); payout actions desync from app state; no app-level idempotency or approval trail.
   - Effort: Low

2. **Selene admin payout release queue** — Admins review eligible Connect shipments in Selene and trigger payout releases through a controlled Edge Function.
   - Pros: Best fit for escrow-like business control; can enforce shipment eligibility, seller readiness, audit logging, idempotency, and Stripe failure handling; keeps finance ops inside the product.
   - Cons: Requires new release read model, mutation contract, payout-run tracking, and reconciliation work; more implementation than Dashboard-only.
   - Effort: Medium

3. **Keep the current cron-based `release-connect-payout` flow** — Continue auto-scanning completed shipments and creating payouts.
   - Pros: Already exists in code.
   - Cons: Not aligned with the user’s manual-control intent; not admin-reviewed; currently unsafe because it pays the seller’s full available Stripe MXN balance per shipment, not a shipment-scoped release amount.
   - Effort: Low

### Recommendation
Use **Approach 2: Selene admin payout release queue**, with **shipment-level eligibility** and **seller-level payout batching**. The release unit should be shipment-level because Connect money is created per seller shipment (`stripe_payment_intent_id` on `shipments`), disputes/refunds are shipment-sensitive, and multi-seller orders should not block unrelated sellers. The actual Stripe payout execution can batch multiple eligible shipments for the same seller into one payout run, but the queue must track which shipments were included.

This should be a **separate follow-up OpenSpec change** (`connect-manual-payout-release`) that explicitly supersedes the payout parts of `stripe-connect-migration`, instead of silently editing the older change in place. The verify failure is valuable audit evidence that the contract changed.

Recommended payout eligibility contract:
- Eligible unit: `shipment`, not whole `order`.
- Business gate: `shipments.status = 'completed'` and `completed_at IS NOT NULL`.
- Financial gate: `shipments.stripe_payment_intent_id IS NOT NULL` and shipment not already attached to a successful payout release.
- Dispute gate: no active dispute for the shipment; buyer-win/refund paths must exclude release; seller-win resolved disputes may release once shipment is moved back to `completed`.
- Seller readiness gate: seller has `profiles_private.stripe_account_id` and refreshed Connect status with both charging/payout readiness satisfied.
- Idempotency: release action needs an explicit release-run idempotency key; retries must not create duplicate payouts.
- Audit: every admin-triggered release should write `admin_audit_logs` plus a dedicated payout release record mapping seller, payout id, shipment ids, amount, actor, and timestamps.
- Failure handling: Stripe payout creation failure must leave shipments unreleased and retryable; DB update failure after Stripe success must mark a reconciliation-needed state.
- Reconciliation: add payout reconciliation (webhook and/or polling) because current `stripe-webhooks` does not process payout lifecycle events.

### Risks
- `release-connect-payout` currently uses `stripe.balance.retrieve(...).available` and pays the full seller balance per shipment, which can mis-attribute pooled funds and starve later shipments.
- Current finance read model (`admin_connect_earnings_view`) has no eligibility flag, no seller net release amount, no payout status beyond `shipments.stripe_payout_id`, and no dispute/readiness join.
- `create-dispute` is still order-level and does not persist `shipment_id`, which weakens shipment-level payout safety for multi-seller orders.
- `stripe-webhooks` has no payout event handling, so Selene cannot currently reconcile `payout.paid` / `payout.failed` style outcomes.
- `admin_seller_onboarding_view` exposes `charges_enabled` only; a release queue should verify payout readiness too.
- Dashboard home still computes “Por Dispersar” from legacy `wallets.available_balance`, so admin finance KPIs are not yet Connect-native.

### Ready for Proposal
Yes — propose a separate change that modifies the Connect payout contract, adds an admin payout release queue/read model, introduces payout-run persistence + reconciliation, and fixes shipment-vs-order dispute/payout scoping before relying on manual payout control in production.
