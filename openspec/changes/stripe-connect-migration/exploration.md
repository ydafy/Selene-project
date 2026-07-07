# Exploration: stripe-connect-migration

## 1. Current State

Selene currently operates a **manual escrow/wallet system** built on top of Stripe PaymentIntents:

- **Single PaymentIntent per order**: The buyer pays the full cart amount via one `PaymentIntent` (stripe v2 `2025-12-15.clover`).
- **Wallet escrow**: When `payment_intent.succeeded` fires, `fn_create_order_from_payment` creates the order and credits each seller's `wallets.pending_balance` with the net payout (price minus commission minus shipping).
- **48h release cron**: `fn_cron_release_shipment_funds` moves funds from `pending_balance` → `available_balance` 48 hours after delivery.
- **Manual payouts**: Sellers request withdrawals via `fn_request_payout`, which creates a `payout_requests` row for admin CSV processing.
- **Dispute refunds**: `resolve-dispute-refund` edge function creates a Stripe refund (partial amount per shipment) and calls `fn_complete_shipment_refund` to reverse the wallet transaction.
- **Seller banking**: `seller_bank_accounts` stores CLABE + bank_name; `payout_requests` tracks manual withdrawals.

This system requires the platform to hold funds, manage ledger integrity, run cron jobs for releases, and manually process payouts. It is operationally heavy and scales poorly.

## 2. Affected Areas

| File | Why affected |
|------|-------------|
| `apps/frontend/core/store/useCheckoutStore.ts` | Checkout state assumes single PaymentIntent; needs to handle multiple intents or a single intent with Connect splits |
| `apps/frontend/core/store/useCartStore.ts` | Cart grouping by seller required for per-seller checkout |
| `supabase/functions/create-payment-intent/index.ts` | Core rewrite: must create per-seller PaymentIntents with `transfer_data[destination]` and `application_fee_amount` |
| `supabase/functions/stripe-webhooks/index.ts` | Webhook logic for `payment_intent.succeeded` must create orders; now may receive multiple intents per order |
| `supabase/functions/resolve-dispute-refund/index.ts` | Refunds now need `reverse_transfer: true` on Connect transfers; no wallet rollback needed |
| `supabase/functions/create-return-intent/index.ts` | Return shipping PaymentIntent logic stays similar but may need to charge the seller's connected account |
| `packages/types/src/database.types.ts` | Tables `wallets`, `wallet_transactions`, `payout_requests`, `seller_bank_accounts` become deprecated |
| `sql.sql` / `supabase/queries/` | Postgres functions `fn_create_order_from_payment`, `fn_release_shipment_funds`, `fn_cron_release_shipment_funds`, `fn_request_payout`, `fn_complete_shipment_refund` become obsolete |
| `supabase/functions/resolve-dispute/index.ts` | RPC calls may need to trigger Stripe Connect transfer reversals instead of wallet adjustments |
| Admin web dashboard | Payments overview (`admin_payments_overview` view) and seller directory need to pull from Stripe Connect instead of `payout_requests` |

## 3. Stripe Connect API Plan (Accounts v2)

### 3.1 Account Creation

Use the **Accounts v2 API** (`POST /v2/core/accounts`) for Express onboarding:

```typescript
const account = await stripe.v2.core.accounts.create({
  controller: {
    losses: { payments: 'stripe' },
    fees: { payer: 'account' },
    stripe_dashboard: { type: 'full' },
    requirement_collection: 'stripe',
  },
});
```

**Controller breakdown:**
- `losses.payments: 'stripe'` — Stripe handles negative balance liability (platform is NOT liable for chargebacks/refunds). This is the safest choice for a marketplace.
- `fees.payer: 'account'` — The **connected account** (seller) pays Stripe fees. This keeps the platform's commission clean.
- `stripe_dashboard.type: 'full'` — Seller gets full Stripe Express dashboard access.
- `requirement_collection: 'stripe'` — Stripe collects KYC/docs directly.

### 3.2 Onboarding Flow

1. Create `Account` with controller config above.
2. Store `stripe_account_id` in `profiles_private` (new column).
3. Create `AccountLink` for onboarding:
```typescript
const accountLink = await stripe.v2.core.accountLinks.create({
  account: account.id,
  use_case: {
    type: 'account_onboarding',
    account_onboarding: {
      configurations: ['merchant'],
      refresh_url: 'https://selene.app/seller/onboarding?retry',
      return_url: 'https://selene.app/seller/onboarding?success',
    },
  },
});
```
4. Redirect seller to `accountLink.url`.
5. Listen to `account.updated` webhook to detect `charges_enabled: true`.

### 3.3 PaymentIntent with Connect (Destination Charges)

For **multi-seller checkout**, we have two viable patterns:

**Option A: Separate PaymentIntent per seller (RECOMMENDED)**
- Create one `PaymentIntent` per seller with:
  - `transfer_data.destination: seller_stripe_account_id`
  - `application_fee_amount: platform_commission_cents`
- Pros: Clean isolation, one seller's failure doesn't block others, per-seller refund simple.
- Cons: Buyer sees multiple charges (UX concern), requires backend orchestration.

```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: sellerTotalCents,
  currency: 'mxn',
  customer: buyerCustomerId,
  automatic_payment_methods: { enabled: true },
  transfer_data: {
    destination: sellerStripeAccountId,
  },
  application_fee_amount: commissionCents,
  metadata: {
    seller_id,
    order_id,
    shipment_id,
  },
});
```

**Option B: Single PaymentIntent with manual TransferGroup**
- Create one `PaymentIntent` on the platform account.
- After success, create `Transfer` objects to each seller's account.
- Pros: Single charge for buyer.
- Cons: Transfer creation is async and can fail; requires manual TransferGroup management; refunds are more complex (must reverse transfers manually).
- **NOT recommended** for a marketplace with disputes.

### 3.4 Payouts

With Connect Express, **payouts are automatic** based on Stripe's schedule (default: daily rolling). Sellers log into their Express dashboard to see earnings. The platform does NOT need to manage `payout_requests` or `seller_bank_accounts`.

If manual payout control is needed, set `settings.payouts.schedule.interval: 'manual'` on the connected account and use `POST /v1/transfers` to push funds. But for Selene, automatic payouts are simpler and the industry standard.

### 3.5 Application Fees

The platform collects commission via `application_fee_amount` on each PaymentIntent. Stripe automatically transfers this to the platform account.

- `application_fee_amount` is capped at the total charge amount.
- The platform can query collected fees via `GET /v1/application_fees`.
- Connect fees (the cost of using Connect) are paid by the **connected account** when `fees.payer: 'account'`.

## 4. Multi-Seller Checkout Design with Connect

### 4.1 Cart → Seller Groups

```
Cart items: [GPU from Seller A, CPU from Seller A, RAM from Seller B]
↓
Group by seller:
  Seller A: GPU + CPU = $500
  Seller B: RAM = $150
↓
Per seller:
  Subtotal: $500 (A), $150 (B)
  Commission: $500 * 0.05 = $25 (A), $150 * 0.05 = $7.50 (B)
  Shipping: $50 (A), $30 (B)
  Total: $575 (A), $187.50 (B)
```

### 4.2 Checkout Flow

1. **Frontend** calls `create-payment-intent` with `productIds` and `addressId`.
2. **Edge function**:
   - Reserve products via `fn_reserve_products`.
   - Group by seller.
   - For each seller, verify `profiles_private.stripe_account_id` exists and `charges_enabled`.
   - If any seller has no Connect account, reject the checkout with `SELLER_NOT_ONBOARDED`.
   - Create one `PaymentIntent` per seller.
   - Store the mapping `{seller_id: payment_intent_id}` in `order_items` (new column `stripe_payment_intent_id`).
3. **Frontend** collects payment for each PaymentIntent sequentially (or use a single Payment Element that supports multiple intents? — see Open Questions).
4. **Webhook** `payment_intent.succeeded` fires for each intent.
   - `stripe-webhooks` creates/updates the order via `fn_create_order_from_payment` (modified to accept per-shipment PI IDs).
   - No wallet operations needed.

### 4.3 Order Schema Changes

- `orders` table: `stripe_payment_intent_id` becomes nullable (or rename to `stripe_payment_intent_ids` JSON array). Since we need per-seller intent IDs, the order-level single PI is no longer sufficient.
- `order_items` or `shipments`: Add `stripe_payment_intent_id` (string) to track which PI belongs to which seller.
- `orders` table: Add `stripe_transfer_group` (optional, if using Option B).

**Recommended:** Add `stripe_payment_intent_id` to `shipments` table (since each shipment already maps 1:1 with a seller within an order). This keeps the PI close to the seller it belongs to.

## 5. Migration Phases

### Phase 1 — Freeze (Week 1)
**Goal**: Stop new wallet writes without breaking in-flight orders.

- Add `stripe_account_id` column to `profiles_private` (nullable string).
- Add `stripe_payment_intent_id` to `shipments` (nullable string).
- Set `system_settings.is_maintenance = true` for brief checkout freeze (optional, but safer).
- Deploy new `create-payment-intent` v2 alongside v1 (feature flag or separate endpoint).
- **Do NOT yet disable** `fn_release_shipment_funds` or `fn_request_payout` — existing orders still use them.
- Update `stripe-webhooks` to handle BOTH old-style single PI (create order) and new-style multiple PIs (link to existing order). Use metadata to distinguish.

### Phase 2 — Seller Onboarding (Weeks 1-3)
**Goal**: Get all active sellers onto Stripe Connect.

- Build seller onboarding screen in `apps/frontend`:
  - "Start selling" → calls new edge function `create-connect-account`.
  - Redirect to Stripe AccountLink.
  - Return URL updates `profiles_private.stripe_account_id` and `stripe_onboarding_status`.
- Build admin dashboard view for "Sellers pending onboarding".
- Send email/push notifications to sellers prompting onboarding.
- For sellers who refuse: their products can be hidden or they can be prompted. But **do NOT block the marketplace** — only block checkout for their specific items if they haven't onboarded.

### Phase 3 — Checkout Cutover (Week 2-3)
**Goal**: New orders use per-seller PaymentIntents.

- Flip feature flag: `create-payment-intent` v2 becomes default.
- New orders create per-seller PIs with `transfer_data` and `application_fee_amount`.
- `stripe-webhooks` handles `payment_intent.succeeded` for new-style PIs:
  - Metadata contains `order_id`, `shipment_id`, `seller_id`.
  - Upsert order if not exists, or just update `shipments.stripe_payment_intent_id`.
  - No wallet operations.
- `fn_create_order_from_payment` is updated OR replaced by a new RPC `fn_create_order_from_connect_payment` that skips wallet creation.
- `products` status changes to `SOLD` as before.

### Phase 4 — Order Lifecycle (Week 3-4)
**Goal**: Remove wallet dependency from order completion.

- **Disable** `fn_cron_release_shipment_funds` cron job. With Connect, funds are released to sellers automatically by Stripe's payout schedule.
- **Remove** `fn_release_shipment_funds` from the hot path. Shipments still transition `delivered` → `completed` via `fn_mark_shipment_delivered`, but the wallet step is removed.
- Update `shipments` trigger `fn_derive_order_status` — it no longer needs to consider wallet state.
- Order status flow remains: `paid` → `preparing` → `shipped` → `delivered` → `completed`.
- The 48h grace period is now just a Stripe internal delay (buyer can still dispute within 48h, but the platform doesn't hold funds).

### Phase 5 — Disputes & Refunds (Week 4-5)
**Goal**: Handle disputes using Stripe Connect transfers.

- `resolve-dispute-refund` edge function:
  - Instead of refunding the PI and doing wallet rollback, use `stripe.refunds.create({ reverse_transfer: true, ... })`.
  - `reverse_transfer: true` pulls the funds back from the connected account automatically.
  - The platform's `application_fee` is also reversed proportionally.
  - Update DB: `fn_complete_shipment_refund` no longer touches wallets; it just marks `shipments.status = 'refunded'` and updates the order status.
- `resolve-dispute` edge function:
  - When admin rules for buyer: trigger `resolve-dispute-refund` automatically (or keep it manual? see Open Questions).
  - When admin rules for seller: no financial action needed; just close dispute.
- Return shipping (`create-return-intent`):
  - Still creates a PaymentIntent for the seller to pay return label fee.
  - But the seller could also be charged via `stripe.paymentIntents.create({ on_behalf_of: sellerAccountId, ... })` or a direct debit to their connected account.

### Phase 6 — Legacy Drain & Deprecation (Week 5-6)
**Goal**: Pay out existing wallet balances and deprecate old tables.

- Admin runs a one-time script: for every `wallets` with `available_balance > 0`:
  - Create a Stripe `Transfer` to the seller's connected account (or manual payout if they haven't onboarded yet).
  - Record in `wallet_transactions` as `payout`.
  - Zero out `wallets.available_balance`.
- After all balances are zeroed:
  - Mark `wallets`, `wallet_transactions`, `payout_requests`, `seller_bank_accounts` as deprecated (or move to `legacy_` prefix).
  - Remove `fn_request_payout`, `fn_release_shipment_funds`, `fn_cron_release_shipment_funds`, `fn_complete_shipment_refund` (or keep the refund one for non-Connect logic).
  - Update `packages/types` to exclude deprecated tables from the main export (or keep them for historical queries).
  - Update admin dashboard to show "Stripe Connect Earnings" instead of "Wallet Balance".

## 6. Data Model Changes

### Tables to ADD

| Table | Columns | Purpose |
|-------|---------|---------|
| `profiles_private` | `stripe_account_id: string | null` | Connected account ID |
| `profiles_private` | `stripe_onboarding_status: enum('pending', 'complete', 'rejected') | null` | KYC status |
| `shipments` | `stripe_payment_intent_id: string | null` | Per-seller PI |
| `system_settings` | `connect_enabled: boolean | null` | Feature flag for cutover |

### Tables to MODIFY

| Table | Change |
|-------|--------|
| `orders` | `stripe_payment_intent_id` becomes nullable (legacy orders still have it) |
| `order_items` | `commission_amount` stays; `net_payout` can stay for audit but is no longer used for wallet math |
| `shipments` | `status` enum stays; no new status needed |

### Tables to DEPRECATE (after Phase 6)

| Table | Replacement |
|-------|-------------|
| `wallets` | Stripe Connect Express dashboard |
| `wallet_transactions` | Stripe `BalanceTransaction` API (via `GET /v1/balance_transactions`) |
| `payout_requests` | Stripe automatic payouts (or `Transfer` API for manual) |
| `seller_bank_accounts` | Stripe collects banking via onboarding |
| `admin_payments_overview` view | New view pulling from Stripe API or `shipments` + `orders` |

### Functions to DEPRECATE

- `fn_release_shipment_funds`
- `fn_cron_release_shipment_funds`
- `fn_request_payout`
- `fn_complete_shipment_refund` (replaced by Stripe refund + reverse_transfer)
- `fn_create_order_from_payment` (needs rewrite to skip wallet steps)

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Seller hasn't onboarded** | High | Block checkout for their items. Show "Seller must complete onboarding" in cart. Allow sellers to save draft products but not publish until onboarded. |
| **Multi-seller: 1 of 3 PIs fails** | High | Implement an **order orchestrator** edge function: if any PI fails, cancel the successful ones (refund immediately) and release product reservations. This is the biggest engineering challenge. |
| **In-flight orders during cutover** | Medium | Keep old wallet functions running for orders created before the cutover. Use `orders.created_at` to determine which system to use. Dual-path in webhooks for 30 days. |
| **Stripe Connect fees** | Medium | With `fees.payer: 'account'`, sellers pay Stripe fees (~2.9% + 3 MXN). The platform's `application_fee` is net. Document this clearly for sellers so they understand their net payout. |
| **Return shipping payment** | Medium | Currently sellers pay via a separate PaymentIntent. With Connect, we could charge the seller's connected account directly via `Transfer reversal` or `PaymentIntent` on their behalf. Need to decide: keep current flow or simplify. |
| **Dispute refund reversal** | High | `reverse_transfer: true` only works if the connected account has sufficient balance. If the seller already withdrew funds, Stripe creates a negative balance on the seller's account. The platform is protected because `losses.payments: 'stripe'`. |
| **Stripe API version drift** | Low | Current code uses `2025-12-15.clover`. Accounts v2 requires a newer version. Upgrade the Stripe SDK across all edge functions to `2026-04-22.dahlia` (latest) before migration. |
| **Data loss / audit trail** | Medium | Do NOT drop `wallets`/`wallet_transactions` tables. Keep them read-only. Use Stripe webhooks to log financial events in `system_logs` for audit. |
| **Mexico-specific regulations** | Medium | Stripe Connect Express is available in Mexico. Ensure sellers provide RFC/CURP during onboarding (Stripe handles this in KYC). ISR/IVA withholding still needs to be calculated and reported; `order_items.sat_tax_withholding` can stay for reporting. |

## 8. Open Questions for the User

1. **Seller onboarding enforcement**: Should sellers be **required** to complete Connect onboarding before listing products, or should we allow them to list but block buyers at checkout? The former is cleaner but creates a barrier to entry.

2. **Multi-seller payment UX**: Do we accept the UX trade-off of multiple PaymentIntents (buyer sees multiple charges on their card statement), or do we invest in Option B (single PI + manual transfers) which is riskier but has better UX?

3. **Dispute refund automation**: Should the `resolve-dispute` edge function automatically trigger the Stripe refund when the admin rules for the buyer, or should the admin click a separate "Process Refund" button? Auto is faster but irreversible.

4. **Payout schedule**: Do we let Stripe handle automatic daily payouts (simplest), or do we want manual control over when sellers get paid (e.g., weekly, or after 7 days)? Manual requires `settings.payouts.schedule.interval: 'manual'` and more admin work.

5. **Existing wallet balances**: There are currently `available_balance` and `pending_balance` in `wallets`. Do we want to:
   - a) Transfer all available balances to sellers' Connect accounts immediately (one-time bulk transfer)
   - b) Let sellers withdraw via the old `payout_requests` system until balances are zero, then cut off
   - c) Absorb the balances as platform revenue (not recommended, legal issue)

6. **Return shipping**: Do we keep the current flow where the seller pays for return shipping via a separate PaymentIntent, or do we deduct the return label cost from the seller's `application_fee` (i.e., platform pays the label and takes it out of commission)?

7. **Stripe fees**: The platform currently calculates `service_fee` on the subtotal. With Connect, `application_fee_amount` is the platform's revenue. Should the platform continue to show a "service fee" to the buyer, or absorb it into the product price and just take the commission from the seller?

8. **ISR/IVA withholding**: The current system calculates `isr_withholding_pct` and `iva_withholding_pct` in `fn_create_order_from_payment`. With Connect, Stripe does not automatically withhold Mexican taxes. Do we need to:
   - a) Keep the `order_items.sat_tax_withholding` field for reporting and let sellers handle taxes themselves
   - b) Build a tax reporting module that queries Stripe earnings and applies withholdings
   - c) Integrate Stripe Tax (may not support Mexico marketplace scenario)

9. **Order-level vs Shipment-level PI**: Should we store the `stripe_payment_intent_id` on `shipments` (1 per seller) or on `order_items` (N per seller)? The former is cleaner because `shipments` already groups by seller.

10. **Testing**: Do we have Stripe Connect test accounts set up in the Stripe dashboard, and do we need to configure the `stripe-account` header in our edge function tests?

## 9. Recommendation

**Recommended approach**: Use **Stripe Connect Express with Accounts v2**, per-seller PaymentIntents (Option A), and automatic payouts.

**Why this approach:**
- It eliminates the manual escrow system entirely, removing the operational burden of cron jobs, wallet ledger integrity, and manual CSV payouts.
- `losses.payments: 'stripe'` protects the platform from chargeback liability.
- `fees.payer: 'account'` makes the seller responsible for Stripe fees, which is standard for marketplaces.
- Per-seller PaymentIntents provide the cleanest audit trail and the simplest refund logic.
- Automatic payouts are the industry standard and reduce engineering complexity.

**Key prerequisite**: Answer the Open Questions above, especially #1 (onboarding enforcement) and #2 (multi-seller UX), before moving to the `sdd-propose` phase.

**Effort estimate**: High (6-8 weeks across all phases, assuming 1 engineer). The biggest risks are the multi-seller checkout orchestration and the dual-path webhook handling during the cutover.
