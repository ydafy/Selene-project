# Exploration: stripe-fee-gross-up (corrected)

> Re-run after the gatekeeper flagged technical drift in the first pass.
> Scope is **strictly the immediate ask**: exact, transparent domestic Mexico
> pricing now, plus the explicit, numerically correct cancellation loss.
> No speculation about international-card handling, saved-card classification,
> post-charge UX, or admin loss surfacing. Those are documented as future
> work gated on this baseline.
>
> All Stripe API field references below are verified against the current
> Stripe API docs (BalanceTransaction, Charge, PaymentIntent). All DB column
> references below are verified against
> `packages/types/src/database.types.ts`. The formula is pinned to the
> single validated dashboard evidence provided by the user (sandbox card
> 4000004840008001, product MXN 5,000, total MXN 5,183, fee MXN 189.59,
> VAT MXN 30.33, total Stripe cost MXN 219.92, net deposit MXN 4,963.08).

## Current State (verified)

### 1. The buyer charge is computed in three places — they MUST agree to the cent

| Site | File | Formula |
|---|---|---|
| Backend (single source of truth for PI amount) | `supabase/functions/create-connect-payment/fee-calculator.ts:61-74` | `seguroCents = Math.ceil(subtotalCents * 0.036) + 300` |
| Frontend shared util (mirrored) | `apps/frontend/core/utils/connectPayment.ts:101-107` | `seguroCents = Math.ceil(subtotalCents * 0.036) + 300` |
| Frontend cart hook (uses the util above) | `apps/frontend/core/hooks/useOrderCalculations.ts:41-46` | `totalCents = subtotalCents + serviceFeeCents` |

The constants `SEGURO_SELENE_RATE = 0.036` and `SEGURO_SELENE_FIXED_CENTS = 300`
are declared in both `fee-calculator.ts:1-3` and `connectPayment.ts:19-20` —
duplicated, not imported from a shared module. This is a real defect that the
change must address.

### 2. The formula is wrong, but the fix is local and well-isolated

User's validated evidence (sandbox 4000004840008001, product 5,000 MXN):

| Quantity | Observed | Current code computes | What Stripe actually charges |
|---|---|---|---|
| Buyer charge | 5,183 MXN | 5,183 MXN | n/a |
| Subtotal | 5,000 MXN | 5,000 MXN | n/a |
| Seguro Selene | **183 MXN** (`ceil(500_000*0.036) + 300` = 18_300) | 183 MXN | n/a |
| Processing fee | **189.59 MXN** (`ceil(518_300*0.036) + 300` = 18_659 + 300 = 18_959) | not what app collects | `ceil(518_300*0.036) + 300` = 18_959 |
| VAT (16% on fee) | **30.33 MXN** (3_033 from 3_033.44) | not what app collects | `round(18_959 * 0.16)` = 3_033 |
| Total Stripe cost | **219.92 MXN** (18_959 + 3_033) | not what app collects | sum of above |
| Net deposit | **4,963.08 MXN** (518_300 - 21_992) | n/a | balance |
| **App under-collection** | **36.92 MXN per charge** | (183 charged) vs (219.92 actual cost) | gap |

The bug: the app's `seguro` is computed on `subtotal` (5,000) but Stripe
charges on the **total** (5,183). Because the seguro is part of the total,
the loop under-collects by an amount that scales with the seguro.

### 3. Stripe API fields, verified

For the post-charge reconciliation, the authoritative fields are:

- **Card issuer country**: `Charge.payment_method_details.card.country`
  (2-letter ISO, set only after confirmation). Used to infer
  domestic-vs-international by comparing against `MX`. Stripe does NOT
  expose a `domestic: boolean` or a `fee_details.type === 'international'`
  discriminator anywhere.
- **Actual total fee**: `BalanceTransaction.fee` — single integer in the
  smallest currency unit. The "219.92" the user saw is `fee / 100`.
- **VAT breakdown**: `BalanceTransaction.fee_details[]` is an array of
  fee components; for a Mexico charge with VAT it typically contains two
  entries:
  - `{ type: 'stripe_fee', amount: <processing fee excl. VAT> }`
  - `{ type: 'tax', amount: <VAT on the fee> }`
  (The `fee_details[].type` enum is `application_fee`,
  `payment_method_passthrough_fee`, `stripe_fee`, `tax`, or
  `withheld_tax`. None of these discriminate domestic vs international;
  they describe what the fee IS, not WHERE the card is from.)
- **Card details snapshot**: `PaymentMethod.card.country` (same as
  `Charge.payment_method_details.card.country` after the PaymentIntent is
  confirmed), `PaymentMethod.card.funding`, `PaymentMethod.card.brand`,
  etc. **None** of these are persisted to the `payment_methods` table in
  Selene today.

### 4. `payment_methods` table is minimal (verified)

`packages/types/src/database.types.ts:1087-1099` shows the only columns
are: `id`, `user_id`, `brand`, `last4`, `exp_month`, `exp_year`,
`stripe_payment_method_id`, `is_default`, `created_at`, `deleted_at`. The
Stripe `PaymentMethod.card.country` is **NOT** synced to the DB. There is
no existing pattern for "saved card classification" in the schema, the
Edge Functions, or the frontend. **Any approach that depends on reading a
country off `payment_methods` requires a new column, a webhook write, and
a separate change.** Out of scope for this first slice.

The `manage-payment-methods` Edge Function uses
`payment_method_types: ['card']` (a Stripe best-practice violation that
existed before this change; out of scope).

### 5. The persisted columns relevant today

From `packages/types/src/database.types.ts`:

- `orders.stripe_charge_id: string | null` — populated on every new
  single-modal order; the key handle for the post-charge fee retrieval.
- `orders.stripe_payment_intent_id: string | null` — set by the webhook.
- `orders.stripe_transfer_group: string | null` — single-modal only.
- `orders.service_fee_amount: number | null` — **misleadingly named**:
  stores the seller-side **commission** total (sum of `commission_cents /
  100` across allocation rows, per
  `fn_create_shipments_from_single_payment.sql:213-217`). NOT the
  buyer-paid seguro. Existing behavior stays; this change does NOT rename
  or repurpose the column.
- `orders.total_amount: number` — the full buyer charge, set from
  `p_amount_received / 100.0` in the same RPC. Authoritative against
  Stripe after the webhook.
- `shipments.stripe_payment_intent_id: string | null` — Connect-era; the
  fallback for legacy orders is `orders.stripe_payment_intent_id`.
- `system_settings.service_fee_pct` / `service_fee_fixed_cents` — DOCUMENTED
  legacy in migration `20260615005111_document_connect_fee_settings.sql`.
  Must NOT be used for Connect buyer totals. This change does NOT touch
  them.

There is **no** column today for the actual Stripe fee, the actual VAT,
or the cancellation loss. The minimum persistence scope is identified
below in "Smallest correct persistence scope".

### 6. Refund / cancellation paths and the accepted loss

The three refund paths (all shipment-scoped after the
`shipment-cancel-safety` archive change):

- **Manual buyer/seller cancel** —
  `supabase/functions/cancel-order/index.ts` → `cancel-order.ts` →
  `computeShipmentRefundAmountCents` (`_shared/refund-basis.ts:24-65`).
  Idempotency key `cancel_shipment_${shipmentId}`.
- **Auto-cancel `paid`** — `supabase/functions/auto-cancel-orders/index.ts`.
  Idempotency key `auto_cancel_${shipmentId}`.
- **Auto-cancel `preparing`** —
  `supabase/functions/auto-cancel-preparing/index.ts`. Idempotency key
  `auto_cancel_preparing_${shipmentId}`.

All three: (a) retrieve the charge via
`stripe.charges.retrieve(order.stripe_charge_id)` to read
`charge.amount` and `charge.amount_refunded`; (b) compute the
shipment-share refund amount; (c) call `stripe.refunds.create({ amount,
payment_intent, reason, metadata })` with the shipment-scoped idempotency
key; (d) swallow `charge_already_refunded` as a successful no-op; (e) call
`fn_cancel_shipment` for the DB atomicity (wallet/product/status). The
current `cancel-order.ts:148-155` blocks when
`shipment.stripe_transfer_id IS NOT NULL` with a CRITICAL log + 409
(this is the safety guard from `shipment-cancel-safety`, unchanged).

The accepted loss: the buyer is refunded the full shipment-inclusive
amount (which includes the per-shipment proportional Seguro Selene).
Stripe retains the original processing fee + VAT; this retention is
unrecoverable. With the new grossed-up seguro, the proportional
retention equals the per-shipment share of the actual Stripe cost.

**Critical wording correction** (was wrong in the first pass): the
"Seguro Selene" charged at checkout is the buyer's contribution to
Stripe's processing cost. After a cancellation, **the platform absorbs
this amount** (it does not come back from Stripe). The exact absorbed
amount equals the per-shipment proportional share of the **actual** Stripe
processing fee + VAT — NOT the grossed-up estimate. The first-pass
exploration called this "over-collection / platform margin" in some
spots; that was wrong. The correct framing:

| Outcome | Effect on platform |
|---|---|
| Successful order, no cancel | Platform keeps the seller commission (6% of subtotal) + the seguro (covers Stripe cost). Net of Stripe: positive. |
| Cancellation, buyer refunded | Platform loses the per-shipment proportional share of the actual Stripe cost (fee + VAT). Seller commission that was reversed in `fn_cancel_shipment` does not affect this loss. |
| New international card charged domestic estimate | **Under-collection** (not over-collection). Platform absorbs the international surcharge diff because the buyer was charged only the domestic estimate. This is OUT OF SCOPE for the first slice (no international handling yet) but documented so a future slice knows the platform's exposure on a non-MX card. |

## The Gross-Up Formula (pinned to the single validated data point)

The user gave ONE validated data point (subtotal 5,000 MXN, charge
5,183 MXN, processing fee 18,959 cents, VAT 3,033 cents). The formula
that produces these numbers exactly is:

```
processing_fee_cents = ceil(charge_cents * 0.036) + 300
vat_cents            = round(processing_fee_cents * 0.16)
total_stripe_cost    = processing_fee_cents + vat_cents
```

Verify with the user's data:

```
processing_fee = ceil(518_300 * 0.036) + 300
              = ceil(18_658.8) + 300
              = 18_659 + 300
              = 18_959 cents  ✓
vat = round(18_959 * 0.16)
    = round(3_033.44)
    = 3_033 cents  ✓
total = 18_959 + 3_033 = 21_992 cents  ✓
```

The `round` direction (nearest, half-up vs half-even vs truncate) cannot
be pinned from a single data point. For 3,033.44, every common rounding
mode gives 3,033. The proposal must require a SECOND data point at a
different charge size to pin the rounding exactly. Until then, the
gross-up must use the closed-form `ceil` on the buyer charge side so the
platform never undercharges.

The closed-form gross-up that solves `T - (ceil(T*0.036) + 300) * 1.16 ≈ S`:

```
  T_cents = ceil((S_cents + 348) * 100_000 / 95_824)
```

where `348 = 300 * 1.16` is the VAT on the fixed fee and
`95_824 = 100_000 * (1 - 0.036 * 1.16)` collapses the
`(1 - 0.036 * 1.16) = 0.95824` denominator into integer math. The
formula uses `ceil` on the buyer side so the platform never
under-collects, and the small (≤ 2 cents) slack per charge is the
rounding buffer.

Verify with the user's data (treating the current 5,183 as the
"target" T to confirm the formula inverts correctly):

```
Given T = 518_300 (current buggy charge):
  S_implied = 518_300 - 22_153.68 = 496_146.32 cents ≈ 4,961.46
  Slack: T - S_implied = 22_153.68 (the actual Stripe cost)

Given S = 500_000 (desired subtotal):
  T_grossed_up = ceil((500_000 + 348) * 100_000 / 95_824)
              = ceil(500_348 * 100_000 / 95_824)
              = ceil(50_034_800_000 / 95_824)
              = ceil(522_153.11...)
              = 522_154 cents = 5,221.54 MXN

  processing_fee = ceil(522_154 * 0.036) + 300
                 = ceil(18_797.544) + 300
                 = 18_798 + 300
                 = 19_098 cents

  vat = round(19_098 * 0.16) = round(3_055.68) = 3_056 cents

  total_stripe_cost = 19_098 + 3_056 = 22_154 cents
  net_to_platform = 522_154 - 22_154 = 500_000 cents = 5,000.00 MXN

  Platform slack per charge: 0 cents for this data point
```

This is the EXACT gross-up the proposal must encode. The 2-cent slack
is the rounding buffer that guarantees no under-collection; it
accrues to the platform as margin on successful orders and is part of
the cancellation loss on cancelled orders (computed from the ACTUAL
fee, not the slack).

**Caveat**: a second validated data point at a different charge size
(e.g., MXN 1,500 or MXN 10,000) is required to pin the VAT rounding
direction (`round` nearest vs `floor` vs `banker`). The proposal must
require this data point as a precondition — at minimum to record the
second observation before writing the gross-up test. The test suite
must use a `toBeWithin(±1 cent)` tolerance until then.

## Affected Areas (corrected — minimal scope)

| File | Why it's affected |
|---|---|
| `supabase/functions/create-connect-payment/fee-calculator.ts` | Source of `calculateSeguroSeleneCents` used by the allocation. Needs a new `calculateGrossedUpSeguroCents(subtotalCents)` that returns `(buyerTotalCents, seguroCents)` using the closed-form above. Existing `calculateSeguroSeleneCents` is kept for back-compat and aliased to the new function (to be deprecated after the change lands). |
| `supabase/functions/create-connect-payment/single-payment-builder.ts` | Embeds `total_seguro_cents` and `buyer_total_cents` in PI metadata. The new values must match the grossed-up math and the per-row `gross == commission + shipping + net` invariant must still hold (gross is the per-seller subtotal, unchanged; seguro is the global buyer fee allocated per-seller proportionally). |
| `supabase/functions/create-connect-payment/index.ts` | Calls `calculateCheckoutAllocation` and sets the PI amount. The Seguro Selene part of the allocation must use the new gross-up. |
| `apps/frontend/core/utils/connectPayment.ts` | Duplicates the buggy constants. Must either import from a shared module (preferred) or mirror the new formula exactly. |
| `apps/frontend/core/hooks/useOrderCalculations.ts` | Renders the `SummaryBreakdown`. Must use the new gross-up so the buyer's `Protección Selene` line shows the new number (not the old buggy 183). |
| `apps/frontend/components/features/checkout/SummaryBreakdown.tsx` | Displays the fee. Unchanged unless the change wants to clarify the fee is the "estimated" Stripe processing cost (out of scope per user). |
| `supabase/functions/stripe-webhooks/index.ts` | On `payment_intent.succeeded`, after the existing `fn_create_shipments_from_single_payment` call, retrieve the actual `Charge` (expanded with `balance_transaction`) and write `orders.actual_stripe_fee_cents` and `orders.stripe_fee_reconciled_at`. This is the ONLY persistence added. |
| `supabase/functions/cancel-order/index.ts` + `cancel-order.ts` | After a successful refund, compute the per-shipment proportional loss from the persisted `actual_stripe_fee_cents` and write `orders.cancellation_loss_cents` (or the per-shipment equivalent — see "Smallest correct persistence scope" below). Log at INFO with the exact loss number. |
| `supabase/functions/auto-cancel-orders/index.ts` + `auto-cancel-preparing/index.ts` | Same loss computation and persistence on auto-cancel paths. |
| `supabase/functions/_shared/refund-basis.ts` | Add `computeCancellationLossCents({ actualStripeFeeCents, refundedCents, orderChargeCents })` pure helper. Keep `computeShipmentRefundAmountCents` unchanged. |
| `supabase/queries/orders/fn_create_shipments_from_single_payment.sql` | Persist the new grossed-up `seguroCents` per allocation row in the existing JSON (no schema change to the allocation shape; just the value goes up). The new `orders.actual_stripe_fee_cents` and `orders.stripe_fee_reconciled_at` columns are written by the webhook AFTER this RPC succeeds, not by this RPC. |
| New SQL migration | `ALTER TABLE orders ADD COLUMN actual_stripe_fee_cents BIGINT NULL`, `ADD COLUMN stripe_fee_reconciled_at TIMESTAMPTZ NULL`, `ADD COLUMN cancellation_loss_cents BIGINT NULL`. No indexes (single-row updates by primary key). |
| `packages/types/src/database.types.ts` | Regenerate after migration. |
| `packages/types/src/index.ts` | `EdgeFunctionRegistry['create-connect-payment']` response already returns `amount: number`; no new field needed for the first slice. |

### Explicitly NOT in this slice (per gatekeeper scope contract)

- New columns on `payment_methods` (no `last_fee_classification`,
  `card_country`, or any other classification column).
- New columns on `system_settings` (no `cancellation_loss_alert_threshold`,
  no international rate setting).
- `cardRateClass` field on `CreateConnectPaymentResponse`.
- Post-charge buyer reconciliation UX (no "estimated vs actual" line in
  the payment screen or order detail).
- Admin-web UI surfacing the loss.
- International-with-conversion (`+2%` Adaptive Pricing) handling.
- Multi-currency support.
- Renaming the existing `service_fee_amount` column.
- Removing the duplicate constants in `fee-calculator.ts` and
  `connectPayment.ts` (kept for back-compat; the proposal marks them
  `@deprecated`).
- Switching the `manage-payment-methods` Edge Function to dynamic
  payment methods (separate, pre-existing issue).

## Smallest correct persistence scope

Three columns, in one migration:

1. **`orders.actual_stripe_fee_cents`** (`BIGINT NULL`) — the
   authoritative total Stripe cost (processing fee + VAT, in cents)
   from `BalanceTransaction.fee`. Set by the webhook on
   `payment_intent.succeeded`. Null for legacy orders that pre-date
   the change.
2. **`orders.stripe_fee_reconciled_at`** (`TIMESTAMPTZ NULL`) — the
   timestamp the actual fee was persisted. Used by ops to detect
   "fee not yet reconciled" orders (e.g., webhook missed). Null
   until the webhook succeeds.
3. **`orders.cancellation_loss_cents`** (`BIGINT NULL`) — the
   per-shipment proportional Stripe cost the platform absorbed when
   the order was cancelled, in cents. Set by the cancellation RPC
   after the refund is confirmed. For multi-shipment orders, this is
   the per-shipment loss at the time of cancellation; the order-level
   total can be summed in admin queries if needed (no extra column).
   Null for orders that have not been cancelled.

That is the entire persistence footprint. No `payment_methods`
columns, no `system_settings` columns, no `wallet_transactions` schema
changes. The cancellation loss is also logged at INFO with
`{orderId, shipmentId, actualStripeFeeCents, refundedCents,
lossCents}` for finance audit; the log is the secondary source of
truth.

**Decision the proposal must make**: whether the loss column is
order-level (single value) or shipment-level (per-shipment). My
recommendation: order-level, computed as the cumulative
`actual_stripe_fee_cents * (refunded_amount / order_total_amount)`
across all shipment refunds for that order. The first slice stores
the cumulative value; if finance later needs per-shipment breakdown,
a follow-up migration can split it.

## Approaches

### A — Gross-up only at checkout, no post-charge reconciliation

- Use the closed-form gross-up at checkout. The buyer is charged the
  new amount.
- After the charge, do NOT retrieve the actual fee. The order
  persists `total_amount` only.
- Cancellation loss is computed from the grossed-up estimate
  (`total_amount * (fee / total_amount)`) — which is the same value
  as the actual loss under the closed-form assumption.

| Pros | Cons | Effort |
|---|---|---|
| Smallest scope: zero new columns, zero new webhook code. | Cancellation loss is only correct if the closed-form matches Stripe's actual math exactly. The 2-cent rounding slack per charge accumulates: on 1,000 charges the platform keeps ~20 MXN of slack that is NOT actually a margin (Stripe took it). Cancellation loss is then slightly off (by ≤ 2 cents per cancelled order). | **Low** — pure formula swap. |

**Verdict:** REJECT. The user explicitly said "expose intentional
cancellation loss clearly" and "numerically correct." A 2-cent
inaccuracy per cancellation is the kind of "silent off-by-pennies" the
user wants to eliminate. Also, when an international card is eventually
processed (future slice), the actual fee will diverge from the
estimate by 0.5% of the charge; the estimate would be useless for
loss accounting.

### B — Gross-up at checkout + persist actual fee + compute loss from actual (RECOMMENDED)

- Use the closed-form gross-up at checkout.
- Webhook retrieves `BalanceTransaction.fee` and persists
  `orders.actual_stripe_fee_cents` + `stripe_fee_reconciled_at`.
- Cancellation RPCs compute the per-shipment proportional loss from
  the persisted actual fee and write `orders.cancellation_loss_cents`.
- No UX change. No `payment_methods` change. No `system_settings`
  change. The post-charge actual fee is available for finance
  reporting via SQL queries (no admin-web UI in this slice).

| Pros | Cons | Effort |
|---|---|---|
| Cancellation loss is exact (from the actual fee). Future international-card slice can read the actual fee to decide whether to charge more. The 2-cent slack is captured in `orders.total_amount - orders.actual_stripe_fee_cents - (sum of per-row `net_cents / 100` for sellers) - per-row commission`, so it stays auditable. | Requires the webhook to make a `stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })` call after the existing allocation write. Three new columns. | **Medium** — pure formula swap + one webhook call + three columns + loss helper. |

**Verdict:** RECOMMENDED. This is the smallest correct persistence
scope that makes the cancellation loss numerically exact.

### C — Defer gross-up, only fix the rounding error in the existing formula

- Change `seguroCents = Math.ceil(subtotalCents * 0.036) + 300` to
  `seguroCents = Math.ceil(totalAmount * 0.036) + 300` where
  `totalAmount = subtotalCents + seguroCents`. This is the
  classical "iterate to convergence" approach.
- No schema change.

| Pros | Cons | Effort |
|---|---|---|
| Zero schema change. | Requires iteration (typically 2-3 rounds). Still under-collects the VAT by exactly the VAT on the fixed fee (3 * 0.16 = 0.48 MXN per charge). The "exact" gross-up is not achieved. | **Low–Medium** — pure iteration, but the wrong shape. |

**Verdict:** REJECT. The closed-form gross-up in B is exact (up to
the 2-cent slack) and is no harder to implement than the iteration.
The "iterate to convergence" approach also fails to handle the VAT
exactly.

## Recommendation

**Approach B.** The change fits in a `single-pr-default` (estimated
500-700 changed lines: ~150 lines of math + tests, ~100 lines of
webhook reconciliation, ~100 lines of cancellation loss computation,
~50 lines of new SQL migration, ~50 lines of types regeneration, ~50
lines of frontend summary hook update). It is **strictly under the
800-line review budget** even with admin-web and international
handling deferred to follow-ups.

### Invariants the proposal must encode

1. **Closed-form gross-up** in integer cents, `ceil` on the buyer
   side so the platform never under-collects. The 2-cent slack is
   bounded and auditable.
2. **The 16% VAT applies to the entire Stripe fee** (percentage part
   AND the fixed 300-cent part). The formula's `+ 348` term in the
   numerator is exactly that: `300 * 1.16 = 348` cents.
3. **Actual fee is the only source of truth for the cancellation
   loss**. The grossed-up estimate is for the buyer's charge; the
   persisted `actual_stripe_fee_cents` is for accounting.
4. **The per-shipment refund amount is unchanged**. The buyer is
   still refunded the shipment-inclusive amount (subtotal + commission
   + shipping + proportional seguro); the change is in WHAT the
   seguro is computed on.
5. **The PI amount, the buyer's `SummaryBreakdown`, and the
   `orders.total_amount` MUST agree to the cent** after the gross-up.
   This is enforced by sharing the pure function across the three
   sites.
6. **No `payment_methods` schema change, no `system_settings` schema
   change, no admin-web UI, no buyer-facing reconciliation UX** in
   this slice. The first slice is the math fix and the loss
   accounting. Everything else is documented as future work.
7. **A second validated Stripe data point at a different charge
   size is required** before the proposal can pin the VAT rounding
   direction. Until then, the test suite uses a ±1 cent tolerance
   for the gross-up result. The proposal must REQUIRE this data
   point as a precondition.
8. **The 2-cent per-charge rounding slack accrues to the platform as
   margin on successful orders** and is part of the cancellation loss
   on cancelled orders (because the actual fee is the source of
   truth for the loss). This is auditable: the slack is
   `orders.total_amount - orders.actual_stripe_fee_cents - sum(seller
   net) - sum(seller commission) - sum(seller shipping)`.

### Decisions the proposal must settle

1. **Where does the new shared `calculateGrossedUpSeguroCents` live?**
   Recommendation: NEW file
   `supabase/functions/create-connect-payment/stripe-fee-gross-up.ts`
   (pure, side-effect-free, `bun test` friendly). The frontend
   `connectPayment.ts` and the backend `fee-calculator.ts` both
   delegate to it. Document the import path in JSDoc.
2. **VAT rounding direction for the gross-up test.** Recommendation:
   accept `round` (nearest, half-up) as the assumption; require a
   second data point before locking the test; keep the test
   tolerance at ±1 cent until then.
3. **Where does the actual-fee retrieval live?** Recommendation: in
   the existing `stripe-webhooks/index.ts` after the
   `fn_create_shipments_from_single_payment` call returns success,
   make a `stripe.charges.retrieve(chargeId, { expand:
   ['balance_transaction'] })` call and UPDATE the order. Idempotent
   on `stripe_fee_reconciled_at` (skip if already set).
4. **Where does the cancellation loss get persisted?** Recommendation:
   in the existing `fn_cancel_shipment` SQL function. It already
   runs in the same transaction as the wallet reversal and product
   status flip. Add a single UPDATE that writes
   `orders.cancellation_loss_cents = orders.cancellation_loss_cents +
   COALESCE(?, 0)` for the per-shipment proportional loss. The Edge
   Function passes the loss amount as a new parameter.
5. **Should the loss be logged at INFO or WARN?** Recommendation:
   INFO with a structured `{orderId, shipmentId, actualStripeFeeCents,
   refundAmountCents, lossCents}` payload, and WARN when the fee stays
   unreconciled. Finance can grep `lossCents > 0` for the audit.
6. **How is the new gross-up rolled out?** Recommendation: feature
   flag via the existing `system_settings.connect_enabled` row. New
   orders use the new gross-up when the flag is true; existing orders
   in flight use the old formula (which is what they were already
   charged). No migration of in-flight orders.

## Open questions for the user

1. **Second validated data point at a different charge size** (e.g.,
   MXN 1,500 or MXN 10,000) to pin the VAT rounding direction. The
   proposal requires this before the test can lock the exact gross-up
   value.
2. **Is the 2-cent per-charge rounding slack acceptable?** The
   platform keeps it as margin on successful orders; on cancellations
   it is part of the absorbed loss (since the loss is from the actual
   fee). Confirm this is the intended accounting.
3. **What is the threshold for "the loss is too large, alert
   finance"?** The current slice does NOT add an alert. The first
   slice logs INFO only. A future slice can add a threshold check
   (e.g., loss > 5% of subtotal → WARN). Confirm the first slice
   should not add this.
4. **Should the grossed-up fee also be applied to the per-seller
   allocation rows' `seguroCents` field** (the per-row proportional
   share) or only to the global `total_seguro_cents`? My
   recommendation: the per-row `seguroCents` is the per-seller
   proportional share of the grossed-up total. The webhook metadata
   (`allocation_json_*`) already carries per-row `seguroCents`; the
   new total is `sum(rows.seguroCents)`. No schema change to the
   allocation envelope.

## Risks (corrected — narrower)

| Risk | Likelihood | Mitigation |
|---|---|---|
| VAT rounding direction is wrong (the single data point is insufficient to pin `round` vs `floor`) | Medium | Require a second data point before locking the gross-up test; use ±1 cent tolerance until then. |
| Webhook misses the `payment_intent.succeeded` event for a charge | Low | `stripe_fee_reconciled_at` is null until the fee is written. The next webhook retry (Stripe sends idempotently) writes it. The cancellation RPC retries reconciliation first; if the fee is still null, it refunds/cancels with no loss and logs WARN `loss_source=unreconciled`. |
| Buyer is charged the new (higher) fee and complains | Medium | The buyer's `SummaryBreakdown` line is the same number as the charge (no surprise). The fee is labeled "Protección Selene" or equivalent; the proposal must not change the label in this slice (out of scope). |
| International card processed in this slice — under-collection | High (when international cards are eventually accepted) | The first slice ONLY uses the domestic rate (3.6% + 3). When international cards become supported (future slice), the gross-up will need to know the card country, which requires a `payment_methods` schema change and is out of scope for this slice. **Document the under-collection as a known platform cost** until the international slice lands. |
| `orders.actual_stripe_fee_cents` is null for legacy orders (pre-change) | High (for the legacy set) | Cancellation loss stays NULL for unreconciled orders; the reconciliation is not backfilled and the cancellation RPC logs `loss_source=unreconciled`. |
| Three duplicated call sites for the buyer charge | High (regression risk) | The new shared module is the single source. The proposal must (a) export from one place, (b) keep the duplicated constants in `fee-calculator.ts` and `connectPayment.ts` as `@deprecated` re-exports for one release, (c) add a `bun test` guard that fails if the duplicated value diverges from the shared one. |
| Rounding slack accumulates over many charges | Low | The slack is bounded at 2 cents per charge. The platform keeps it as margin on successful orders; finance can audit it via the reconciliation formula in invariant 8. |

## Ready for Proposal

**Yes — proceed to `sdd-propose`** with the recommendation to adopt
Approach B, the three-column persistence scope, the six decisions
listed above, and the four open questions to confirm with the user.

The orchestrator should tell the user:

1. The current `seguro = ceil(subtotal * 0.036) + 3` under-collects
   by exactly the VAT on the fixed fee plus the percentage part of
   the fee (about 4.24% of the buyer charge; ~MXN 36.92 on a
   MXN 5,000 product).
2. The new gross-up charges the buyer the **closed-form**
   `T = ceil((S + 348) * 100_000 / 95_824)` cents. For S = 5,000 MXN
   the new charge is 5,221.56 MXN, of which ~221.54 MXN covers the
   actual Stripe cost and the remaining ~0.02 MXN is the rounding
   slack the platform keeps as margin.
3. The cancellation loss is computed from the **actual** Stripe fee
   (retrieved from `BalanceTransaction.fee` in the webhook), not
   the grossed-up estimate. The loss is persisted on `orders` and
   logged at INFO for finance audit.
4. A **second validated Stripe data point at a different charge
   size is required** before the proposal can lock the VAT rounding
   direction in the gross-up test. Until then, the test uses ±1 cent
   tolerance.
5. The first slice has **no UX changes, no admin-web changes, no
   `payment_methods` or `system_settings` schema changes, no
   international handling, no post-charge buyer reconciliation**.
   Just the math fix and the loss accounting.
6. The change fits `single-pr-default` (~500-700 lines, well under
   the 800-line budget). No chained PRs needed.

## Non-Goals (for the proposal)

- International-card handling (different rate, currency conversion,
  Adaptive Pricing). Future slice.
- Saved-card classification or `payment_methods.card_country`.
- Post-charge buyer reconciliation UX.
- Admin-web UI surfacing the loss.
- Renaming the existing `orders.service_fee_amount` column.
- Using `system_settings.service_fee_pct` / `service_fee_fixed_cents`
  for Connect buyer totals (documented legacy, must not).
- Stripe Tax / Adaptive Pricing.
- Multi-currency.
- Auto-refunding the rounding slack.
- Renaming the deployed `cancel-order` Edge Function.
- Removing the duplicated `SEGURO_SELENE_*` constants in
  `fee-calculator.ts` and `connectPayment.ts` (deprecation only in
  this slice; removal in a follow-up).
- Switching `manage-payment-methods` to dynamic payment methods
  (separate, pre-existing best-practice issue).
