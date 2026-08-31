# Exploration: post-purchase-reliability-audit

## Scope

Fresh root-cause audit for the multi-seller post-purchase domain of Selene
(Mexican used-PC marketplace): Envia label generation, tracking &
reconciliation, cancellation/refund, disputes/returns, escrow/manual seller
payout release, admin actions, webhooks, and safety crons. Frontend is in
scope only where it depends on backend contracts.

This change is **not a fix** — it is a discovery/decision artifact. It
classifies every observed surface as **Preserve / Adapt / Replace / Unknown**
so a future proposal can target the smallest durable slices.

Status of pre-existing related work verified in this audit:

- `shipping-label-envia-option-fix` (in flight, locally modified but not
  deployed).
- `connect-manual-payout-release` (deployed: 20260621000000 migration; the
  Edge Function `release-connect-payout` was rewritten since session #431).
- `stripe-connect-migration` (deployed for Phase 1; remaining Phase 2 items
  still open per #201).
- `shipment-cancel-safety` (UX decisions #648 / #649 honored; backend
  eligibility enforced in `cancel-order/cancel-order.ts`).

Current Envia API surface assumptions from this audit:

- `/ship/generate/` returns tracking, label URL, shipment id, and total price.
- `/ship/cancel/` requires carrier + tracking number and only works before
  carrier pickup/network entry.
- `/ship/generaltrack/` accepts a batched tracking-number array.
- `ENVIA_API_URL_*` and `ENVIA_API_KEY_*` env vars must be honored by every
  caller; today only `_shared/envia-shipping.ts` honors them.

## Current State

### Envia label generation

**Primary path (in-flight, local)** — `supabase/functions/generate-shipping-label/index.ts`
plus `supabase/functions/_shared/envia-shipping.ts` (new shared helper,
uncommitted). The Edge Function already calls
`runLabelClaimOrchestration(...)` with a `preflight → claim → markSent →
provider → finalize/orphan` state machine. The pending migration
`20260713210000_envia_shipping_label_hardening.sql` adds
`shipments.label_generation_state`,
`shipments.claim_token`,
`shipments.claim_expires_at`,
`shipments.service`,
`shipments.print_format`,
`shipments.print_size`,
`shipments.label_provider_cost_cents`,
`shipments.label_generated_at`, a `shipment_label_events` audit table, and
six `SECURITY DEFINER` RPCs (`fn_claim_shipment_label`,
`fn_mark_shipment_label_sent`, `fn_finalize_shipment_label`,
`fn_mark_shipment_label_rejected`, `fn_mark_shipment_label_orphan`,
`fn_reconcile_shipment_label`). All RPCs require `auth.role() = 'service_role'`,
gated by `SET search_path = public, pg_temp`. Backfill sets
`label_generation_state = 'generated'` for any shipment with a label URL,
envia_shipment_id, or tracking number.

The Edge Function currently still writes `shipping_evidence` (existing column
in `database.types.ts`) at line 352 in the same transaction. The hardening
migration does not add or alter that column, so the write remains valid.
**However**, evidence capture should eventually route through
`shipment_label_events` for audit consistency.

**Secondary path (legacy, still live)** — `generate-return-label/index.ts`
hardcodes `carrier: 'paquetexpress'`, `service: 'ground'`, `printFormat:
'PDF'`, `printSize: 'STOCK_4X6'` and uses the untracked Envia URL config
(`Deno.env.get('ENVIA_API_URL_SANDBOX' / '_PROD')` with
`https://api.envia.com` / `https://api-test.envia.com` hardcoded fallbacks).
**No claim orchestration, no orphan handling, no idempotency key beyond
"row already has return_tracking_number" check.** If Envia accepts the
request but the DB update fails, it returns 200 with a `warning` field and the
tracking number is now stuck in Envia with no Selene record — exactly the
orphan-label problem this audit is meant to prevent.

### Tracking crons

**`track-shipments/index.ts`** — shipment-scoped (queries `shipments`),
batches `/ship/generaltrack/`, calls `fn_mark_shipment_delivered`, bulk-updates
`last_tracked_at`. **Hardcoded `https://api-test.envia.com`** instead of
using the shared `resolveEnviaRuntimeConfiguration`. Reads `last_tracked_at`
for ordering (column exists, no index added by recent migrations).

**`track-returns/index.ts`** — dispute-scoped (queries `disputes`),
batches `/ship/generaltrack/`, calls `fn_mark_return_delivered`. Filters
`status IN ('waiting_return', 'return_shipped')` — confirming `return_shipped`
is a real, persistent status (the #52 gap is fixed). **Same hardcoded URL
problem.**

### Cancellation & refund

**`cancel-order/index.ts`** — requires `shipmentId`, calls
`resolveManualShipmentCancelPlan({ ... })` (in `cancel-order.ts`). The plan
module rejects any state other than `paid` with `SHIPMENT_NOT_CANCELABLE`
(enforces decision #648/#649: buyer manual cancel only in `paid`; seller
manual cancel not available; `preparing` is auto-cancel-only by cron).
Stripe refund is computed from
`computeShipmentRefundAmountCents(...)` (proportional buyer fee + shipment
subtotal, capped by remaining refundable cents). Stripe refund is executed
**before** the DB cancel; `charge_already_refunded` is handled idempotently.
On RPC failure after a successful Stripe refund, logs `CRITICAL` and returns
500 with an ops-actionable message.

**`auto-cancel-orders/index.ts` / `auto-cancel-preparing/index.ts`** —
both use `system_settings.{order,preparing}_expiration_hours`, both grab a
`system_settings.auto_cancel_*_running` lock to prevent concurrent runs,
both invoke `resolveAutoCancelShipmentCancellationGate` (refuses to cancel
if PI is missing or refund amount invalid), both execute
`computeShipmentRefundAmountCents` and `allocateCancellationLossCents`,
both do Stripe refund → RPC cancel, both sleep 500ms between shipments.

**`resolve-dispute-refund/index.ts`** — accepts `disputeId` only (the
`EdgeFunctionRegistry` in `packages/types/src/index.ts` still declares
`{orderId, disputeId}` — contract drift). Auth: admin **or** the dispute's
seller. Validates `dispute.status IN ('return_delivered','waiting_return')`.
Computes refund amount from the disputed shipment's `order_items` only
(fix for prior #19 Bug 2: previously summed all sellers' items). Resolves PI:
Connect uses `shipments.stripe_payment_intent_id`, legacy uses
`orders.stripe_payment_intent_id`. Sets `reverse_transfer: true` on Connect
refunds (Stripe handles seller's balance deduction). Idempotency key
`refund_dispute_${disputeId}`. Connect path skips
`fn_complete_shipment_refund` (avoids double-wallet-rollback) and updates
`shipments.status = 'refunded'` directly.

### Disputes & returns

**`create-dispute/index.ts`** — requires both `orderId` and `shipmentId`,
validates shipment belongs to order, validates shipment has a seller,
validates order status in `('shipped','delivered')` and 48h delivered window.
Idempotent via Postgres UNIQUE constraint (catches `23505` and returns 409).
Notifications to seller + buyer.

**`fn_resolve_dispute_to_seller.sql` / `fn_resolve_dispute_to_buyer.sql`** —
called by `resolve-dispute/index.ts` after admin auth. **Unverified in this
audit whether both functions route via `shipments` for status updates and
delegate to `fn_release_shipment_funds` / `fn_complete_shipment_refund` when
`dispute.shipment_id IS NOT NULL`** — the prior #19 design said they should
fall back to order-level updates for pre-migration disputes without
`shipment_id`. The `shipments` table in `database.types.ts` shows
`status: order_status_enum` (not `shipment_status_enum`) which means the
shipment and order share the same status enum — not necessarily a defect,
but worth a runtime check.

**`fn_release_shipment_funds.sql`** — Connect guard (skips wallet for
Connect shipments, marks shipment completed), 48h grace period, dispute
check, per-shipment `net_payout` from `order_items`, wallet move
`pending → available`, ledger insert, shipment marked completed (trigger
propagates to order).

**`fn_complete_shipment_refund.sql`** — Connect guard (skips wallet for
Connect), status check, per-shipment `net_payout`, wallet reversal, ledger
insert, products set `IN_REVIEW`, shipment marked refunded (trigger
propagates to order), dispute auto-resolved, buyer + seller notified.

### Escrow / manual payout release

**`admin_connect_payout_release_view`** (`security_invoker = true`) —
eligibility per row with explicit `ineligible_reason`: completed + has
`completed_at` + has Connect PI + no active dispute + no active release + has
`shipping_cost` + has `stripe_account_id` + onboarding complete + release
amount > 0. Revoked from `anon, authenticated`; granted only to
`service_role`. Active-release partial unique index
(`idx_connect_payout_run_shipments_active_once`) prevents double-release at
the DB layer.

**`release-connect-payout/index.ts` (rewritten since #431)** —
`parseReleaseRequestBody` → `releaseConnectPayout(...)` orchestrator.
Idempotency: `findRunByIdempotencyKey` returns the existing run so retries
reuse the same Stripe payout id; **this directly addresses the prior
`pending_reconciliation` stuck-run root cause** by ensuring an in-flight
Stripe call cannot be duplicated. Pre-flight:
`retrieveConnectedBalance({stripeAccountId})` runs **before** any Stripe
payout create, returning `stripe_balance_insufficient` with
`required_amount_cents` vs `available_amount_cents` if balance is short.
Status machine: `pending_reconciliation` → `paid` (via
`payout.paid` webhook reconciliation) **or** `failed` (terminal) **or**
`reconciliation_needed` (ambiguous, requires ops attention). Reuses Stripe
idempotency keys for transfers and payouts. Detailed Stripe error logging
(`stripeErrorType`, `stripeErrorCode`, `stripeRequestId`,
`stripeStatusCode`) — addresses #431's "thin observability" finding.

**`stripe-webhooks/index.ts` payout reconciliation** — handles
`payout.paid`, `payout.failed`, `payout.canceled` via
`reconcileConnectPayoutEvent(...)`. Looks up run by stripe_payout_id first,
then by metadata.run_id; updates run status with idempotent
`is(stripe_payout_id, null)` + `in(recoverable_missing_payout_id_statuses)`
guards. Marks shipment `stripe_payout_id` (also idempotent). On success, the
admin queue automatically excludes the shipment from future release batches
via the view.

**`manual_repair_connect_payout_stuck_runs.sql`** — explicit ROLLBACK-default
safety script for pre-#431-fix historical stuck runs. Requires operator
Stripe verification before COMMIT.

### Settlement creation

**`fn_create_shipment_from_payment.sql`** — Connect per-seller PI flow
(legacy). Persists `shipments.shipping_cost` from
`seller_shipping_deduction_cents` metadata (with `shipping_cents` legacy
fallback). **Hardcoded `net_payout = ROUND(p.price * 0.94, 2)`** — assumes a
flat 6% commission; the modern single-modal path passes
`commission_cents` per row from metadata, so reconciliation could drift if
Stripe metadata is missing. Idempotent on `stripe_payment_intent_id`.

**`fn_create_shipments_from_single_payment.sql`** — single-modal
multi-seller settlement (current). Shell-then-allocation recovery model:
insert order shell (`status='pending'`, `payment_processing=false`) before
the allocation block; on allocation failure, inner block rolls back, shell
is marked `payment_processing=true` with `payment_processing_reason` and
returned to webhook as `{success:false, status:'payment_processing'}` (200 to
Stripe, no retry). Deterministic shipment IDs (`ON CONFLICT DO NOTHING`)
prevent duplicates across re-attempts. Per-seller commission distribution
absorbs residuals in the last item so row sums reconcile exactly.

**`stripe-webhooks/index.ts`** — three-path branch:
`type === 'return_shipping'` → `fn_log_return_payment`; `single_modal` →
`fn_create_shipments_from_single_payment`; `connect_per_seller` or
`metadata.seller_id` → `fn_create_shipment_from_payment`; legacy
pre-Connect → `fn_create_order_from_payment`. DLQ via `webhook_dlq` table
on any unhandled error. **Confirms all four paths can fire** depending on
the historical or current Stripe metadata shape — there is no migration
deadline to retire the legacy path yet.

### Frontend contracts (in scope where backend is concerned)

`packages/types/src/index.ts`:

- `EnrichedShipment` already exposes `items`, `dispute`, `isBuyer`, `isSeller`,
  and a `permissions` bag (no `canGenerateReturnLabel` mismatch).
- `EdgeFunctionRegistry` declares
  `resolve-dispute-refund: { payload: { orderId, disputeId } }` but the
  Edge Function only reads `disputeId`. **Contract drift — flag for frontend
  call-site review.**
- `generate-shipping-label.payload` declares both `orderId` and `shipmentId`
  as optional but the Edge Function requires `shipmentId`. Legacy callers
  still passing `orderId` will silently receive a 422 (Zod missing UUID).
- `cancel-order.payload: { orderId, shipmentId, reason? }` — matches the
  shipped API.
- `create-dispute.payload: CreateDisputeRequest` — matches shipped API.
- `release-connect-payout.payload: ConnectPayoutReleaseRequest` — matches.
- `create-connect-payment.payload` requires `quantity: 1` per the recent
  Connect-seller rejection for quantity > 1 (per #426).

`apps/frontend/core/hooks/useShipments.ts`,
`apps/frontend/core/hooks/useOrderActions.ts`,
`apps/frontend/core/hooks/useReturnPayment.ts`,
`apps/frontend/core/hooks/useShippingQuote.ts` — present and consistent
with backend contracts at the type level.

## Transition / Invariant Matrix

| Surface                                        | Current Path                                                           | Idempotency                                           | Concurrency                           | Financial Risk                                                                | Decision                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Envia label (out)                              | generate-shipping-label + claim orchestration                          | claim_token + 6 RPCs                                  | claim row lock                        | Envia fee → `label_provider_cost_cents` written; payout view subtracts it     | **Preserve** (post-deploy)                       |
| Envia label (return)                           | generate-return-label (legacy, no claim)                               | `return_tracking_number IS NOT NULL` check            | None                                  | Orphan if DB fails post-Envia                                                 | **Replace**                                      |
| Track shipments                                | track-shipments + fn_mark_shipment_delivered                           | RPC idempotency assumed                               | Batch 50, N+1 last_tracked_at updates | None                                                                          | **Adapt** — switch to shared runtime config      |
| Track returns                                  | track-returns + fn_mark_return_delivered                               | RPC idempotency assumed                               | Batch 50                              | None                                                                          | **Adapt** — switch to shared runtime config      |
| Cancel (manual)                                | cancel-order + fn_cancel_shipment                                      | Stripe idempotencyKey                                 | Maintenance flag                      | Refund before DB cancel; Connect reverse_transfer                             | **Preserve**                                     |
| Cancel (auto paid)                             | auto-cancel-orders + fn_cancel_shipment                                | Stripe idempotencyKey + lock flag                     | Lock                                  | Refund before DB cancel; cancellation loss allocation                         | **Preserve**                                     |
| Cancel (auto preparing)                        | auto-cancel-preparing + fn_cancel_shipment                             | Stripe idempotencyKey + lock flag                     | Lock                                  | Same                                                                          | **Preserve**                                     |
| Dispute (buyer)                                | create-dispute + UNIQUE (shipment_id)                                  | DB unique violation → 409                             | None                                  | None                                                                          | **Preserve**                                     |
| Dispute resolve (admin)                        | resolve-dispute + fn_resolve_dispute_*                                 | Admin-only RPC                                        | None                                  | Funds routed by shipment-level update                                         | **Preserve** — verify SQL against shipment_id    |
| Dispute refund                                 | resolve-dispute-refund                                                 | Stripe idempotencyKey                                 | None                                  | Per-shipment refund amount; Connect reverse_transfer; legacy skips wallet     | **Preserve**                                     |
| Return payment                                 | create-return-intent + fn_log_return_payment                           | Stripe idempotencyKey                                 | None                                  | Sets `return_payout_status='paid'` + status='return_shipped' (per #52)        | **Preserve**                                     |
| Payout release                                 | release-connect-payout + admin view                                    | Idempotency key reuse                                 | DB unique partial index               | Stripe balance preflight; Stripe reverse_transfer-aware; stuck-run repair SQL | **Preserve**                                     |
| Payout reconciliation                          | stripe-webhooks payout.* events                                        | DB-level idempotency via `is(stripe_payout_id, null)` | Multiple updaters allowed             | Recovery via `attachRunPayoutId`                                              | **Preserve**                                     |
| Stripe webhook settlement (single-modal)       | stripe-webhooks single_modal + fn_create_shipments_from_single_payment | PI unique + shipment_id unique + shell recovery       | None                                  | Shell-on-failure recovery; admin ops re-runs                                  | **Preserve**                                     |
| Stripe webhook settlement (Connect per-seller) | stripe-webhooks connect_per_seller + fn_create_shipment_from_payment   | PI unique + idempotent branch                         | None                                  | Hardcoded 6% commission net_payout; **drift risk vs single-modal**            | **Adapt** — accept metadata cents or remove path |
| Stripe webhook settlement (legacy)             | stripe-webhooks legacy + fn_create_order_from_payment                  | None visible                                          | None                                  | Pre-Connect only                                                              | **Replace** — sunset after migration deadline    |

## Affected Areas (verified)

Edge Functions (`supabase/functions/`):

- `auto-cancel-orders/index.ts` — locked, refund-first, Connect-aware.
- `auto-cancel-preparing/index.ts` — locked, refund-first, Connect-aware.
- `cancel-order/index.ts` + `cancel-order.ts` — shipment-scoped, manual-only
  on `paid`.
- `connect-onboarding-return/index.ts` — out of scope (not post-purchase).
- `create-connect-account/index.ts` — out of scope.
- `create-connect-payment/index.ts` — out of scope.
- `create-dispute/index.ts` + `create-dispute.ts` — shipment-scoped,
  idempotent.
- `create-payment-intent/index.ts` — pre-Connect, superseded by
  `create-connect-payment`.
- `create-return-intent/index.ts` + `create-return-intent.ts` — Stripe PI
  for return shipping label.
- `delete-account/index.ts` — out of scope.
- `drain-legacy-wallets/index.ts` — mentioned in #201, present but not
  verified in this audit.
- `generate-return-label/index.ts` — **legacy, hardcoded Envia options, no
  claim orchestration** (Replace candidate).
- `generate-shipping-label/index.ts` — rewired to claim orchestration
  locally; deployment pending.
- `get-connect-earnings/index.ts` — out of scope.
- `get-connect-payout-release-queue/index.ts` — well-formed (see #274).
- `get-seller-onboarding/index.ts` — out of scope.
- `get-shipping-quote/index.ts` — in scope but **not fully read in this
  audit**; prior spec said single-origin/single-package; current flow may
  pre-date the multi-seller cart.
- `manage-payment-methods/index.ts` — out of scope.
- `reconcile-connect-payments/index.ts` — wired from
  `stripe-webhooks/payout.*` (not directly read in this audit).
- `refresh-connect-account-status/index.ts` + helper — out of scope.
- `release-connect-payout/index.ts` + helper — full rewrite since #431.
- `release-funds/index.ts` — legacy, superseded by release-connect-payout.
- `resolve-dispute/index.ts` — admin-only verdict via
  `fn_resolve_dispute_*`.
- `resolve-dispute-refund/index.ts` — shipment-scoped, admin OR seller.
- `return-delivery-timeout/index.ts` — cron (not read; presumes
  `fn_cron_return_delivery_timeout` and `fn_mark_return_delivered`).
- `rollback-connect-payment/index.ts` — mentioned but not in current EF
  listing; likely already removed.
- `stripe-webhooks/index.ts` — three-path + reconciliation + DLQ.
- `track-returns/index.ts` — hardcoded URL (Adapt).
- `track-shipments/index.ts` — hardcoded URL (Adapt).

Shared helpers (`supabase/functions/_shared/`):

- `auto-cancel-safety.ts` — gate, refuses to cancel without verified PI/refund.
- `connect-status.ts` — Stripe account normalization (out of scope).
- `envia-shipping.ts` — **new** shared Envia config + claim orchestration.
- `refund-basis.ts` — proportional buyer fee + cancellation loss allocation.
- `stripe-fee-gross-up.ts` — buyer-side fee math (referenced by
  create-connect-payment).

Queries (`supabase/queries/`):

- `disputes/fn_cron_dispute_payout_timeout.sql`,
  `disputes/fn_cron_dispute_shipping_timeout.sql`,
  `disputes/fn_cron_return_delivery_timeout.sql` — crons (not fully read in
  this audit; presumed aligned with #19 spec).
- `disputes/fn_resolve_dispute_to_buyer.sql`,
  `disputes/fn_resolve_dispute_to_seller.sql`,
  `disputes/fn_lock_dispute.sql`, `disputes/fn_unlock_dispute.sql` —
  admin RPCs.
- `orders/fn_cancel_order.sql`, `orders/fn_cancel_shipment.sql`,
  `orders/fn_check_order_access.sql`,
  `orders/fn_confirm_delivery.sql`,
  `orders/fn_confirm_shipment_delivery.sql`,
  `orders/fn_create_order_from_payment.sql` — pre-Connect legacy.
- `orders/fn_create_shipment_from_payment.sql` — Connect per-seller.
- `orders/fn_create_shipments_from_single_payment.sql` — single-modal current.
- `orders/fn_derive_order_status.sql` — shipment trigger consumer.
- `payments/admin_connect_payout_release_view_shipping_cost_fix.sql` —
  manual patch for `shipments.shipping_cost` subtraction (per #426).
- `payments/fn_log_return_payment.sql` — sets `return_payout_status='paid'`
  and status='return_shipped' (per #52).
- `payments/fn_request_payout.sql` — legacy wallet payout (Connect guard
  added in cutover).
- `payments/manual_repair_connect_payout_stuck_runs.sql` — ROLLBACK-default
  repair.
- `products/fn_reserve_products.sql`,
  `products/fn_release_products.sql`,
  `products/fn_release_stale_reservations.sql` — checkout hardening (per
  20260701).
- `return/fn_buyer_submit_return_evidence.sql`,
  `return/fn_mark_return_delivered.sql`,
  `return/fn_seller_initiate_return_label.sql`,
  `return/fn_seller_submit_return_evidence.sql` — return logistics.
- `shipments/fn_complete_shipment_refund.sql`,
  `shipments/fn_mark_shipment_delivered.sql`,
  `shipments/fn_release_shipment_funds.sql`,
  `shipments/fn_seller_confirm_return_shipment.sql` — shipment-scoped money.
- `triggers/shipments/fn_cron_release_shipment_funds.sql`,
  `triggers/shipments/fn_shipments_status_trigger.sql` — propagation.

Migrations (`supabase/migrations/`):

- `20260528000000_drop_legacy_columns.sql`,
  `20260528000001_drop_legacy_functions.sql` — Fases 5–9 cleanup (per #19
  Task 4.5/4.6).
- `20260529*_lock_columns.sql` — locks for auto-cancel and concurrency.
- `20260601030309_add_sat_tax_withholding.sql`,
  `20260601040000_admin_payments_overview.sql`,
  `20260601040001_fix_admin_payments_security.sql` — payouts/security.
- `20260603*` — Stripe Connect schema + lifecycle + payout tracking.
- `20260604*`, `20260605000000_on_auth_user_updated_trigger.sql` — auth
  trigger repair.
- `20260608000000_product_deletion_hardening.sql` — product-side.
- `20260613000000_connect_cutover_completion.sql` — fn_request_payout with
  Connect guard.
- `20260615005111_document_connect_fee_settings.sql` — settings docs.
- `20260615100000_add_onboarding_refreshed_at.sql` — refresh throttle.
- `20260621000000_connect_manual_payout_release.sql` — payout runs + view +
  RLS (deployed).
- `20260701000000_reservation_lifecycle_hardening.sql`,
  `20260702000000_single_modal_checkout_settlement.sql`,
  `20260703000000_single_modal_settlement_rpc.sql` — single-modal flow.
- `20260706000000_reviews_unique_per_product.sql`,
  `20260706000001_drop_legacy_unique_order_review.sql` — reviews.
- `20260711042329_stripe_fee_gross_up.sql` — buyer fee gross-up.
- `20260713210000_envia_shipping_label_hardening.sql` — **PENDING DEPLOY**
  (label generation state + 6 RPCs + audit table + system_settings
  Paquetexpress-only CHECK).

Types:

- `packages/types/src/database.types.ts` (lines 1778–1902 confirm
  `shipments` columns pre-hardening; current state does NOT yet include
  `service`, `print_format`, `print_size`, `label_generation_state`,
  `claim_token`, `claim_expires_at`, `label_provider_cost_cents`,
  `label_generated_at`).
- `packages/types/src/index.ts` — contract types reviewed above.

Frontend:

- `apps/frontend/components/features/auth/RegisterForm.tsx` — modified
  locally (out of scope; auth change).
- `apps/frontend/core/hooks/useShipments.ts`,
  `apps/frontend/core/hooks/useOrderActions.ts`,
  `apps/frontend/core/hooks/useReturnPayment.ts`,
  `apps/frontend/core/hooks/useShippingQuote.ts` — consistent with backend.

OpenSpec:

- `openspec/specs/shipments/spec.md` — well-formed contract (cancellation,
  ownership, allocation correlation).
- `openspec/specs/connect-payout-release/spec.md` — admin gate, idempotency,
  amount-from-allocation.
- `openspec/specs/connect-payout-reconciliation/spec.md` — payout event
  reconciliation.
- `openspec/changes/shipping-label-envia-option-fix/exploration.md` —
  already on disk; this audit supersedes it for the broader post-purchase
  reliability framing.
- `openspec/changes/post-purchase-reliability-audit/` — empty before this
  write.

## Verified Facts vs. Suspected Defects vs. Legacy/Dead vs. Remote Gaps

### Verified facts

- Hardcoded `paquetexpress/ground` print options were the cause of the
  Envia 1170 error and are now configurable via `system_settings.envia_*`
  with a CHECK constraint that fails closed if unset.
- The `return_shipped` dispute status is real and persistent; both
  `track-returns` and `generate-return-label` transition into it.
- `release-connect-payout` no longer creates duplicate payout runs on retry
  because `findRunByIdempotencyKey` reuses the existing run.
- All Edge Functions that touch money do Stripe refund **before** the DB
  cancel and handle `charge_already_refunded` as an idempotent success.
- `admin_connect_payout_release_view` is `security_invoker = true` and
  revoked from authenticated — admin access is server-side only via the
  Edge Function with service_role.
- Active-release partial unique index prevents double-release at the DB
  layer regardless of any UI bug.

### Suspected defects

- **D1 (CRITICAL)** — `generate-return-label/index.ts` lines 209–210 still
  hardcode `carrier: 'paquetexpress'`, `service: 'ground'`, `printFormat:
'PDF'`, `printSize: 'STOCK_4X6'`. It also returns a 200 with a `warning`
  string when the DB update fails post-Envia, which leaves the label
  orphaned in Envia. This is the same class of bug the
  `shipping-label-envia-option-fix` change is solving for outbound labels,
  but the return path was never refactored.
- **D2 (HIGH)** — `track-shipments/index.ts` and `track-returns/index.ts`
  hardcode `https://api-test.envia.com` and bypass
  `resolveEnviaRuntimeConfiguration`. In production, the API key switches
  to `ENVIA_API_KEY_PROD` based on `ENVIA_MODE`, but the URL stays on the
  test endpoint. Any future `ENVIA_API_URL_PROD` override is ignored.
- **D3 (MEDIUM)** — `fn_create_shipment_from_payment.sql` line 196 hardcodes
  `net_payout = ROUND(p.price * 0.94, 2)` for legacy Connect per-seller PIs.
  The single-modal path passes `commission_cents` per row from metadata, so
  the two flows can diverge if a future change ever adjusts the commission
  rate.
- **D4 (MEDIUM)** — `resolve-dispute-refund` payload contract in
  `EdgeFunctionRegistry` declares `{orderId, disputeId}` but the Edge
  Function only reads `disputeId`. Frontend callers passing `orderId` will
  not break today (the field is just ignored), but a future cleanup may
  mistakenly narrow the type and break callers.
- **D5 (MEDIUM)** — `generate-shipping-label/index.ts` line 352 still
  writes to `shipments.shipping_evidence`. The hardening migration does
  not add or alter this column, so the write remains valid, but the
  audit/event log now lives in `shipment_label_events` and the two
  evidence stores can drift.
- **D6 (LOW)** — `track-shipments` orders by `last_tracked_at` without an
  index. For large `shipments` tables this is a sequential sort; harmless
  at current volumes but worth flagging.
- **D7 (LOW)** — `shipments.status` reuses `order_status_enum` (verified
  from `database.types.ts`). This is intentional for cross-aggregation but
  makes it harder to introduce shipment-only states without a migration.

### Legacy / dead paths (still live)

- The pre-Connect legacy `payment_intent.succeeded` branch in
  `stripe-webhooks/index.ts` (around lines 500–569) calls
  `fn_create_order_from_payment`. It is preserved for historical replays;
  no current checkout path produces this metadata shape.
- `fn_create_order_from_payment` is still callable by the legacy branch
  and is not yet dropped (per #19 Task 4.6, drops were planned for Fase 9
  cleanup).
- `release-funds` Edge Function is not read in this audit but appears in
  the EF listing — likely superseded by `release-connect-payout` for
  Connect shipments.
- `fn_release_shipment_funds` Connect-skip path updates
  `shipments.status='completed'` directly without the webhook
  reconciliation layer; the admin queue still picks up these shipments
  for release because the view filters on `status='completed'` and
  `has_completed_at`.
- The `connect_per_seller` webhook branch is the original Connect flow
  before single-modal was introduced; any historical PI replayed by
  Stripe still routes here.
- `get-shipping-quote` is still single-origin/single-package per the prior
  multi-seller design (#19 Task 5.1) — pre-migration state, not dead.

### Remote deployment / type-generation gaps

- **G1** — Migration `20260713210000_envia_shipping_label_hardening.sql`
  is on disk but **not applied** to remote Supabase.
- **G2** — The new `_shared/envia-shipping.ts` is **not committed** (git
  shows it as untracked, alongside `__tests__/envia-shipping.test.ts`).
- **G3** — `supabase/functions/deno.json` is **not committed**.
- **G4** — `supabase/functions/generate-shipping-label/auth-order.test.ts`
  is **not committed**.
- **G5** — `supabase/functions/generate-shipping-label/index.ts`,
  `diagnostics.ts`, and `diagnostics.test.ts` are locally modified but not
  committed.
- **G6** — `apps/frontend/components/features/auth/RegisterForm.tsx` is
  locally modified — **out of scope**; do not bundle into a post-purchase
  change.
- **G7** — `packages/types/src/database.types.ts` does not yet reflect the
  hardening migration's new columns (`service`, `print_format`,
  `print_size`, `label_generation_state`, `claim_token`, `claim_expires_at`,
  `label_provider_cost_cents`, `label_generated_at`); `bun db:types` has
  not been run after the migration.
- **G8** — Per the AGENTS.md, the maintainer applies Supabase SQL manually
  in the Dashboard and deploys Edge Functions manually. The pending
  deployment is a maintainer action, not an agent action.

## Approaches Considered for `generate-return-label` (D1)

1. **Adapt — reuse the existing claim orchestration.** Move
   `generate-return-label` to a mirror of the new shared orchestration,
   with the claim row on `disputes` instead of `shipments`. Pros:
   consistent state machine, identical audit table, no new concept.
   Cons: requires dispute table schema additions or a parallel
   `dispute_label_events` table.
2. **Replace — pull the option from the original outbound label.** The
   return shipment goes from the buyer back to the seller's
   `shipment.origin_address`. Use the same `shipments.carrier / service /
print_format / print_size` that was used for the original outbound
   label, then call the claim orchestration. Pros: zero new schema,
   reuses persisted data. Cons: assumes outbound and return carriers are
   the same; need a fallback if not.
3. **Preserve — fix only the carrier/service hardcoding, leave the rest.**
   Read `system_settings.envia_*` like the outbound function. Pros: tiny
   diff. Cons: still leaves the orphan-label bug; still no idempotency;
   still no claim token.

Recommended: **Approach 2** when the hardening migration is live; the
shared `service/print_format/print_size` columns on `shipments` are exactly
what is needed. Fall back to `system_settings.envia_*` if the shipment has
not yet generated a label.

## Approaches Considered for Cron URL Configuration (D2)

1. **Adapt — call `resolveEnviaRuntimeConfiguration` at the top of each
   cron.** Pros: minimal code, reuses the shared helper, validates URL.
   Cons: introduces Deno.env reads to two more files.
2. **Replace — lift the cron into the shared module's pattern by having
   `_shared/envia-shipping.ts` export a `withEnvia({ mode, ... })`
   helper.** Pros: consistent envelope. Cons: bigger refactor.

Recommended: **Approach 1** with the validation already present in
`resolveEnviaRuntimeConfiguration` (https-only unless `localhost`
dev seam).

## Recommended Delivery Slices (independent)

Each slice below should land as its own PR/work unit, each independently
testable in production, and each respecting the AGENTS.md deployment
contract.

- **Slice 1 — Deploy + regenerate.** Deploy
  `20260713210000_envia_shipping_label_hardening.sql` to remote Supabase
  manually. Operator populates
  `system_settings.envia_carrier='paquetexpress'`, `envia_service`, and
  `envia_print_format`, `envia_print_size` with validated production
  values. Run `bun db:types`. Update `packages/types/src/index.ts` only
  if `EnrichedShipment` needs the new columns (it likely does not —
  `EnrichedShipment` is for UI; the new columns are persisted but not
  displayed).
- **Slice 2 — Outbound label Edge Function deploy.** Deploy the updated
  `generate-shipping-label` Edge Function. Commit the new
  `_shared/envia-shipping.ts`, `__tests__/envia-shipping.test.ts`,
  `auth-order.test.ts`, `diagnostics.test.ts`, and `deno.json` first.
  Smoke test on the sandbox with a paid shipment. Verify
  `shipment_label_events` is populated and `label_generation_state`
  transitions correctly. This addresses the orphan-label bug and the
  hardcoded Paquetexpress option.
- **Slice 3 — Return label refactor (D1).** Adapt
  `generate-return-label/index.ts` to use the shared claim orchestration
  helper with the per-dispute claim token. Add a
  `dispute_label_events` audit table mirroring
  `shipment_label_events`. Remove the 200-with-warning path; require
  durable DB write before returning success.
- **Slice 4 — Cron runtime config (D2).** Adapt
  `track-shipments/index.ts` and `track-returns/index.ts` to call
  `resolveEnviaRuntimeConfiguration` and bail with a 500 + structured
  log if config is missing. No behavior change otherwise.
- **Slice 5 — Observability for orphan labels.** Add a read-only admin
  view `admin_label_reconcile_queue` listing shipments with
  `label_generation_state IN ('orphan_pending', 'retryable_rejected')`
  with admin `reconcile_shipment_label` RPC wired to the Edge Function
  or directly invoked. This is the operational safety net.
- **Slice 6 — Frontend contract drift cleanup (D4).** Update
  `EdgeFunctionRegistry` in `packages/types/src/index.ts`:
  - `resolve-dispute-refund.payload: { disputeId }` (drop `orderId`).
  - `generate-shipping-label.payload: { shipmentId, originAddress,
shippingEvidence }` (drop `orderId`).
    Run `bun test` after the change to catch any caller that breaks.
- **Slice 7 — Evidence store unification (D5).** Either remove the
  `shipping_evidence` writes from `generate-shipping-label` (route
  evidence via `shipment_label_events.metadata`) or document
  `shipping_evidence` as the read model for the UI and
  `shipment_label_events.metadata` as the audit log. Recommend the
  latter to avoid migration churn.
- **Slice 8 — Connect per-seller commission drift fix (D3).** In
  `fn_create_shipment_from_payment.sql`, replace
  `ROUND(p.price * 0.94, 2)` with metadata-driven math
  (pass commission via `commission_cents` in the metadata like the
  single-modal flow). If this path is being sunset, document the
  deadline.

## Risks

- **R1** — Migration deploy + Edge Function deploy are coupled: if the
  migration is applied after the Edge Function code ships, every call to
  `generate-shipping-label` will fail with "column does not exist" until
  the migration runs. Slice 1 must land first.
- **R2** — Hardcoded `paquetexpress/ground` in `generate-return-label`
  means return labels may also fail with Envia 1170 if Paquetexpress
  changes its API (the same sandbox instability that triggered the
  outbound fix). Slice 3 addresses this.
- **R3** — The `system_settings.envia_*` CHECK constraint forces
  `paquetexpress` and requires a complete tuple; if production values
  are wrong on first deploy, the entire label-generation path fails
  closed with `ENVIA_CONFIGURATION_INVALID`. The hardening migration
  has a comment reminding the operator.
- **R4** — `fn_create_shipment_from_payment` commission math
  (`ROUND(p.price * 0.94, 2)`) and the single-modal path's metadata
  cents can drift if commission rules ever change. Slice 8 mitigates
  this; otherwise sunset the legacy Connect per-seller path entirely.
- **R5** — `track-shipments` filtering on `status IN ('preparing',
'shipped')` will still pick up shipments with
  `label_generation_state='orphan_pending'` for tracking (correct, the
  Envia tracking side is independent of the label generation state) but
  the cron never surfaces orphan state back to Selene; only
  `shipment_label_events` does. Slice 5 closes this.
- **R6** — The hardening migration revokes the six new RPCs from
  PUBLIC, anon, and authenticated and grants them only to
  `service_role`. Any Edge Function that currently calls these via an
  authenticated client would fail. Verified: all callers in this audit
  use service_role.

## Skill Resolution

- `sdd-explore` — invoked (this artifact is the phase output).
- `supabase` — loaded and applied: SECURITY DEFINER review, search_path
  discipline, RLS posture, view `security_invoker` checks, role grant
  review on the six new RPCs.
- `stripe-best-practices` — loaded and applied: RAK preference for
  service credentials, webhook idempotency, refund-before-cancel
  sequencing, `reverse_transfer` for Connect, `application_fee_amount`
  scope. No new Stripe API surfaces added by this audit.
- `systemic-issue-triage` — applied as the analytical frame: every
  suspected defect is classified by root class, every slice is sized to
  address a single root class, and no slice is allowed to introduce a
  new state, verb, or config flag that does not already exist in the
  codebase.

## Ready for Proposal

Yes — the orchestrator may proceed to `sdd-propose`. The recommended
first proposal should target **Slices 1, 2, 5, and 6** as one cohesive
"label generation hardening + observability" change (smallest end-to-end
verifiable delivery), with **Slice 3** as a follow-up once Slice 2 is
stable, **Slice 4** as a quick win alongside Slice 3, and **Slices 7
and 8** as cleanup-only work once the post-purchase hot path is
production-confirmed.
