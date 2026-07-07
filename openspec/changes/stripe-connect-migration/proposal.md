# Proposal: Stripe Connect Express Migration

## Intent

Selene currently operates a **manual escrow/wallet system** on top of single-PI Stripe charges, with admin-driven CSV bank dispersion to sellers. This model is not viable for a regulated marketplace in Mexico (Ley Fintech CNBV, PLD/KYC requirements) and is operationally heavy: manual cron jobs, ledger integrity risk, CSV exports, and platform liability for chargebacks.

This change migrates Selene to **Stripe Connect Express (Accounts v2)** with destination charges. Stripe assumes KYC, payout banking, chargeback liability, and automatic daily payouts. The platform keeps order/dispute orchestration but exits the money-holding business.

**Quality bar: Production-ready, regulator-grade.** Real money, real sellers, real audit trail. No prototype-quality shortcuts.

## Scope

### In Scope

- Stripe Connect Express onboarding via Accounts v2 (`POST /v2/core/accounts` + AccountLink)
- Per-seller `PaymentIntent`s with `transfer_data.destination` and `application_fee_amount`
- Onboarding gate at first shipping-label generation (sellers can publish without Connect)
- Automatic daily payouts via Stripe (no platform-managed payout queue)
- Dispute refunds via `stripe.refunds.create({ reverse_transfer: true })`
- Return shipping as separate PaymentIntent on seller's connected account ($300 MXN flat from `system_settings`)
- "Seguro Selene" line item on buyer side (covers Stripe processing fee 3.9% + $3 MXN)
- 6% Selene commission as `application_fee_amount` (platform revenue)
- Legacy wallet drain: one-time mass Transfer of `wallets.available_balance` to Connect accounts
- Deprecation of `wallets`, `wallet_transactions`, `payout_requests`, `seller_bank_accounts`
- Dual-path webhooks during cutover (legacy single-PI orders coexist with new multi-PI orders)
- Admin dashboard views: onboarding status, Connect earnings, dispute refunds

### Out of Scope

- ISR/IVA tax withholding code (sellers operate under RESICO; dropped from system)
- Single-PaymentIntent multi-seller flow (Option B with manual TransferGroup — explicitly rejected)
- Stripe Tax integration
- Manual payout schedule control (Stripe automatic daily is final)
- Pre-existing dispute resolution UX (kept as-is, only refund mechanics change)
- Migrating historical wallet audit data into Stripe (kept read-only in DB)

## Capabilities

### New Capabilities

- `stripe-connect-onboarding`: Seller onboarding flow via Accounts v2 + AccountLink, status tracking on `profiles_private`
- `connect-checkout`: Per-seller PaymentIntent orchestration with destination charges and application fees
- `connect-dispute-refunds`: Refund flow with `reverse_transfer: true` for buyer-wins disputes
- `connect-return-shipping`: Seller-paid return label via PaymentIntent on connected account
- `legacy-wallet-drain`: One-time mass payout of existing wallet balances to Connect accounts

### Modified Capabilities

- `checkout`: Replaces single-PI flow with per-seller PIs; cart groups by seller
- `order-lifecycle`: Removes wallet release step from `delivered → completed` transition
- `dispute-resolution`: Refund mechanics switch from wallet rollback to Stripe reverse-transfer
- `seller-payouts`: Moves from `payout_requests` queue to Stripe automatic payouts

## Approach

**Account model**: Accounts v2 with controller properties — `losses.payments: 'stripe'` (Stripe absorbs chargebacks), `fees.payer: 'application'` (Selene pays processing fees, recovered via "seguro selene" line item), `stripe_dashboard.type: 'full'`, `requirement_collection: 'stripe'`.

**Checkout**: Cart groups by seller. `create-payment-intent` v2 creates one PI per seller with `transfer_data.destination = seller.stripe_account_id` and `application_fee_amount = 6% * subtotal_cents`. Buyer sees one charge per seller — accepted UX trade-off. If any PI fails post-confirmation, orchestrator refunds successful siblings and releases reservations.

**Onboarding gate**: Sellers list products freely. First sale triggers in-app onboarding prompt. Connect completion is enforced before generating the first shipping label, not at listing time.

**Order lifecycle**: Existing state machine (`paid → preparing → shipped → delivered → completed`) is preserved. Wallet writes are removed; Stripe owns fund release on its payout schedule.

**Disputes**: Admin verdict UX unchanged. When buyer wins: seller pays return label (separate PI on connected account) → buyer ships → tracking confirms delivery → admin triggers refund with `reverse_transfer: true` (Stripe pulls funds back from seller's connected account, including reversed application fee).

**Migration**: Six phases (see Phases section) with dual-path webhooks until legacy orders settle.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/create-payment-intent/index.ts` | Replaced (v2) | Per-seller PIs with `transfer_data` and `application_fee_amount` |
| `supabase/functions/create-connect-account/` | New | Accounts v2 creation + AccountLink generation |
| `supabase/functions/stripe-webhooks/index.ts` | Modified | Handle multiple PIs per order; dual-path with legacy single-PI |
| `supabase/functions/resolve-dispute-refund/index.ts` | Modified | Use `reverse_transfer: true`; drop wallet rollback |
| `supabase/functions/create-return-intent/index.ts` | Modified | PI on seller's connected account ($300 MXN flat) |
| `supabase/functions/generate-return-label/index.ts` | Modified | Gate on seller `stripe_account_id` + `charges_enabled` |
| `supabase/functions/drain-legacy-wallets/` | New | One-time mass Transfer to Connect accounts |
| `profiles_private` | Modified | Add `stripe_account_id`, `stripe_onboarding_status` |
| `shipments` | Modified | Add `stripe_payment_intent_id` |
| `system_settings` | Modified | Add `connect_enabled` flag, `return_shipping_cost_mxn` |
| `apps/frontend/core/store/useCheckoutStore.ts` | Modified | Multi-PI checkout state |
| `apps/frontend/core/store/useCartStore.ts` | Modified | Group cart by seller |
| `apps/frontend/app/seller/onboarding/` | New | Connect onboarding screen + return URL handlers |
| `apps/admin-web` | Modified | New views: Connect earnings, onboarding status; deprecate wallet/payouts pages |
| `wallets`, `wallet_transactions`, `payout_requests`, `seller_bank_accounts` | Deprecated | Read-only after Phase 6 |
| `fn_release_shipment_funds`, `fn_cron_release_shipment_funds`, `fn_request_payout`, `fn_complete_shipment_refund`, `fn_create_order_from_payment` | Deprecated/Replaced | Replaced by Connect-aware RPCs |
| `packages/types/src/database.types.ts` | Regenerated | After each migration |

## Phases Summary

| Phase | Goal | Key Deliverables |
|-------|------|------------------|
| **1. Freeze** | Stop wallet writes; prepare schema | New columns on `profiles_private` + `shipments`; dual-path webhooks; v2 endpoint deployed behind flag |
| **2. Onboarding** | Get sellers onto Connect | Onboarding screen; admin tracking dashboard; in-app prompts on first sale |
| **3. Checkout** | New orders use per-seller PIs | `create-payment-intent` v2 default; multi-PI webhook handling; orchestrator for partial failures |
| **4. Order Lifecycle** | Remove wallet from hot path | Disable release cron; strip wallet steps from order completion; preserve state machine |
| **5. Disputes** | Connect-native refunds | `reverse_transfer: true` refunds; return-label PI on connected account |
| **6. Legacy Drain** | Pay out and deprecate | Mass Transfer of `available_balance`; mark legacy tables read-only; admin UI cutover |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Seller not onboarded blocks shipping | High | First-sale onboarding prompt; gate at label generation only, not at listing; clear in-app messaging |
| One of N per-seller PIs fails mid-checkout | High | Orchestrator edge function: refund successful siblings, release reservations, surface failure to buyer |
| `reverse_transfer` fails (seller already withdrew) | Med | `losses.payments: 'stripe'` covers it — Stripe creates negative balance on seller, platform unaffected |
| In-flight legacy orders during cutover | Med | Dual-path webhook for 30+ days; route by `orders.created_at` and presence of `stripe_payment_intent_id` on shipments |
| Stripe API version drift (current `2025-12-15.clover`) | Low | Upgrade SDK to latest (`2026-04-22.dahlia` or newer) across all edge functions before Phase 1 |
| Mass wallet drain creates Stripe Transfer failures | Med | Drain script is idempotent + audited; failed Transfers logged to `admin_audit_logs`; admin can retry |
| Buyer confusion over multiple charges | Med | Checkout UI explicitly previews per-seller breakdown; receipt emails group by seller |
| Tax/regulatory edge cases (non-RESICO sellers) | Low | Out-of-scope for code; documented in seller TOS; reporting via Stripe BalanceTransaction export |

## Rollback Plan

**Per-phase rollback:**

1. **Phases 1-2**: Additive only. Drop new columns, revert edge function deployments, remove onboarding UI route. Legacy flow untouched.
2. **Phase 3**: Flip `system_settings.connect_enabled = false`. New orders fall back to legacy `create-payment-intent` v1. Existing Connect orders continue (they're independent).
3. **Phase 4**: Re-enable `fn_cron_release_shipment_funds`. Wallet writes resume for new orders if v1 is reactivated.
4. **Phase 5**: Revert `resolve-dispute-refund` to previous version. Connect-era refunds in flight must be manually reconciled via Stripe dashboard.
5. **Phase 6**: **Not rollback-able post-drain.** Legacy tables are read-only but data is intact; sellers would need to be re-onboarded to a reinstated manual flow. Treat Phase 6 as point-of-no-return.

**Data preservation**: `wallets`, `wallet_transactions`, `payout_requests`, `seller_bank_accounts` are NEVER dropped — they remain as historical audit records.

## Dependencies

- Stripe SDK upgrade to a Connect Accounts v2-compatible API version across all edge functions
- Stripe Connect platform enabled and approved for Mexico (account-level approval required from Stripe)
- `profiles_private` Edge Function write path (Zero Trust pattern already in place)
- New `system_settings` keys: `connect_enabled`, `return_shipping_cost_mxn`
- `packages/types` regeneration after each schema migration

## Success Criteria

- [ ] All active sellers have `stripe_account_id` with `charges_enabled = true` (or are blocked from shipping)
- [ ] New orders create one `PaymentIntent` per seller with correct `application_fee_amount` (6%) and `transfer_data.destination`
- [ ] Buyer's card statement shows N charges for an N-seller order, each labeled with seller-recognizable descriptor
- [ ] "Seguro Selene" line item appears on buyer checkout breakdown matching Stripe fee (3.9% + $3 MXN)
- [ ] Buyer-wins dispute triggers refund with `reverse_transfer: true`; seller's Connect balance reflects the reversal
- [ ] Return shipping is paid via a separate PaymentIntent on the seller's connected account ($300 MXN)
- [ ] Stripe automatic daily payouts visible in seller's Express dashboard; no `payout_requests` rows created for Connect-era orders
- [ ] Legacy wallet balances drained to Connect accounts; `wallets.available_balance = 0` for all migrated sellers
- [ ] Admin dashboard shows Connect-sourced earnings instead of wallet ledger
- [ ] Dual-path webhook correctly routes legacy single-PI events and new multi-PI events without crossover
- [ ] Zero ISR/IVA withholding code paths remain in production edge functions
- [ ] All financial events written to `admin_audit_logs` (Connect transfers, reversals, drain operations)
