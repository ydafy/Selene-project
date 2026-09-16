# Exploration: shipping-quote-financial-contract

> Read-only investigation for `shipping-quote-financial-contract`. Goal: durable,
> correct contract for shipping cost and selected carrier/service across the
> listing → checkout → label → refund chain. Sandbox-only environment;
> payout release, UI rollout, remote deployment, and real provider calls
> remain explicitly out of scope.

## Current State

Three distinct shipping-cost surfaces exist in the codebase. They are NOT
connected end-to-end, and each one carries its own provider or pricing
semantics that the current OpenSpec contract fails to distinguish.

### 1. Listing-time estimate — `get-shipping-quote` Edge Function

- Code-proven behavior: `supabase/functions/get-shipping-quote/index.ts`
  (188 LOC, sandbox-only) accepts
  `{ originZip, packageId, price, destinationZip? }`, calls Envia
  `POST https://api.envia.com/ship/rate/` with one package built from
  `system_settings.package_presets[packageId]` (or a `cpu_1` fallback), and
  returns `{ rates: ShippingOption[] }`. The payload hardcodes
  `shipment: { type: 1, carrier: 'paquetexpress', service: 'ground' }` for
  the rate request but the **response** is the full multi-carrier array —
  any carrier (DHL, Estafeta, Paquetexpress, FedEx) and any service in MXN
  may appear in `rates[]`. Destination defaults to `06500` (CDMX pivot)
  when the buyer has not yet been resolved.
- Frontend consumers (`codegraph_explore` + grep): only
  `apps/frontend/core/hooks/useShippingQuote.ts` is reachable, and its only
  caller is `useSellDetailsForm` (`apps/frontend/core/hooks/useSellDetailsForm.ts:54`).
  `useSellDetailsForm` extracts `rates[0].price` and writes it into
  `useSellStore.draft.shipping_cost` (no carrier/service persistence at
  the product row). `useSellerShippingQuote.ts` references an edge
  function `get-shipping-quote-seller` that does not exist
  (`grep` returned no deployable function) — dead code.
- Documented intent (per `openspec/specs/shipments/spec.md` lines 351–369):
  the spec describes an **archived, never-shipped** multi-seller shape —
  `items: [{ originZip, packageId, price, sellerId }]` in, `Record<string,
ShippingOption[] | null>` (keyed by `sellerId`) out, with a hard rule
  that only a single Paquetexpress ground MXN option is accepted.
  `openspec/changes/archive/2026-05-29-complete-shipment-migration/` keeps
  the design + tasks for that rewrite, but Task 2.1 ("modify
  `functions/get-shipping-quote/index.ts` — accept items[] array, group
  by (originZip+sellerId), per-group Envia call, return
  `{rates:{[sellerId]:...}}` with per-origin error isolation") was never
  landed. The on-disk function and the spec disagree.
- Envia provider docs (fetched `https://docs.envia.com/llms.txt`,
  consulted `reference/shipping-rates.md` only at the index level for this
  discovery; no authenticated provider calls): the `/ship/rate/` endpoint
  returns one entry per available carrier/service and accepts optional
  carrier filtering through `shipment.carrier`. Selene's rate request
  filters by Paquetexpress ground at request time but does not validate
  the response to that filter — Envia may return a different set when
  origin/destination/preset combinations are unusual.

### 2. Checkout-time financial flow — single-modal multi-seller

- Code-proven behavior: `create-connect-payment` runs
  `calculateCheckoutAllocation` (`supabase/functions/create-connect-payment/fee-calculator.ts:215`)
  with `subtotalCents` (product price) and `shippingCents` (per-seller
  deduction) per `SellerAllocationInput`. Per
  `calculateConnectMoneyFlow` (lines 118–145) and `calculateCheckoutAllocation`
  (line 211 doc-comment), **buyer total = sum(subtotal + seguro) per
  seller**; `shippingCents` is a seller-paid deduction that never enters
  the buyer charge. The Stripe PaymentIntent is created for
  `buyerTotalCents` only; seller economics live in `metadata.allocation`.
- `fn_create_shipments_from_single_payment` (the active settlement RPC
  after `fn_create_shipment_from_payment` was retired, per
  `20260824001426_post_purchase_label_generation_foundation.sql` lines
  82–95, which raises `LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED`)
  persists per-shipment `shipping_cost` (= the seller's allocation
  `shippingCents` in cents) and per-item `commission_amount`,
  `shipping_amount`, `shipping_payer='seller'`, `net_payout`. The
  invariant enforced by the SQL is `gross = commission + shipping + net`
  per row (see `assertValidCheckoutAllocation`,
  `fee-calculator.ts:351-356`).
- `calculateEstimatedSellerShippingDeductionCents`
  (`fee-calculator.ts:94-116`) is what bridges the listing estimate and the
  checkout flow: `quotedShippingCents` (from `get-shipping-quote`) +
  `shippingBufferCents` (default 3 000 ¢ = $30 MXN) + Envia insurance
  (`priceCents * 0.012`). This is the number that lands on
  `shipments.shipping_cost` and `order_items.shipping_amount`.
- Documented intent: `specs/shipments/spec.md` lines 430–440 still describe
  the legacy "buyer pays all shipping" model: "Query `products` for each
  `product_id` → get `seller_id` and `shipping_cost`. Group reserved
  items by `seller_id`. Sum shipping costs per seller (buyer-pays
  only)... Total amount unchanged (buyer pays all shipping)." That text
  is **stale relative to the deployed code**; the migration
  `20260702000000_single_modal_checkout_settlement.sql` removed buyer-paid
  shipping and replaced it with seller-paid.

### 3. Label-time financial flow — atomic claim orchestration

- Code-proven behavior: `supabase/functions/generate-shipping-label/index.ts`
  is a 6-step orchestration around the `runLabelClaimOrchestration` helper
  in `supabase/functions/_shared/envia-shipping.ts:309`. The contract is:
  1. `fn_claim_shipment_label` (RPC, service-role) → lock
     `shipments.status='paid'`, mint `claim_token` (UUID), 15-min TTL,
     transition `label_generation_state → 'claimed'`. Authorized by
     `auth.role() = 'service_role'`; refuses when `seller_id` mismatch.
  2. Re-rate via Envia `/ship/rate/` with the buyer's stored
     `orders.shipping_address`, seller's selected `addresses` row, the
     computed package dimensions, and the SHA-256 hash of the payload
     (`rateInputHash`). **Or** reuse the persisted `label_quote_*`
     evidence if `label_quote_input_hash === rateInputHash` AND
     `label_quote_carrier`/`service` normalize to `paquetexpress`/`ground`
     AND `label_quote_cost_cents >= 0`.
  3. `selectPaquetexpressGroundRate` (`envia-shipping.ts:218-251`)
     enforces EXACTLY ONE accepted rate: carrier normalized to
     `paquetexpress`, service normalized to `ground`, currency to `mxn`,
     with a finite, non-negative `totalPrice`. Anything else returns
     `null` and the orchestration lands on `rate_evidence_rejected` or
     `retryable_rejected` (never a partial carrier fallback).
  4. `fn_persist_shipment_label_quote` (RPC) — server-side validates
     Paquetexpress ground again (`20260824001426` lines 100–129) and
     writes `label_quote_carrier`, `label_quote_service`,
     `label_quote_cost_cents`, `label_quote_reference`, `label_quote_rated_at`,
     `label_quote_input_hash`. Only succeeds when
     `label_generation_state='claimed' AND claim_token=<token>`.
  5. `fn_mark_shipment_label_sent` — extends claim TTL, transitions to
     `generation_sent`. Will refuse if the persisted quote is missing or
     not Paquetexpress ground.
  6. Call Envia `POST /ship/generate/`. `extractEnviaLabelCostCents`
     (`generate-shipping-label/diagnostics.ts:262`) walks the response and
     picks the best cost signal across `shippingCost / cost / totalPrice
/ rate / amount` (with cents-aware variants), capturing the source
     path for audit. On accepted result, `fn_finalize_shipment_label`
     writes `envia_shipment_id`, `tracking_number`, `label_url`,
     `carrier`, `service`, `print_format`, `print_size`,
     `label_provider_cost_cents` (the cents actually charged by the
     provider), transitions `status='preparing'`,
     `label_generation_state='generated'`.
- Failure outcomes (still labeled, not labels generated):
  - `retryable_rejected` (deterministic 4xx with provider error code in
    `VALIDATION_ERROR / INVALID_ADDRESS / INVALID_DESTINATION /
INVALID_ORIGIN`) → seller can re-claim later.
  - `orphan_pending` (transport failure, ambiguous provider response, or
    finalization RPC failure) → requires `fn_reconcile_shipment_label`
    (admin-only) to recover. A 15-min stale claim also becomes an orphan.
- All financial evidence is persisted before the provider call and again
  after acceptance. The `shipment_label_events` audit table
  (`20260713210000_envia_shipping_label_hardening.sql` lines 69–81) is
  append-only with RLS that denies all reads; it captures `claimed`, `sent`,
  `rejected`, `orphaned`, `generated`, `reconciled` events.

### 4. Refund and cancellation-loss contract

- `computeShipmentRefundAmountCents`
  (`supabase/functions/_shared/refund-basis.ts:29-73`) takes
  `orderChargeCents` (the actual Stripe charge amount) and computes
  `buyerFeeCents = orderChargeCents - orderSubtotalCents`. Because the
  buyer total does **not** include shipping, the refund amount is
  `shipmentSubtotal + proportionalBuyerFee` — seller-paid shipping is
  structurally excluded. A `REFUND_AMOUNT_EXCEEDS_CAP` (422) is raised if
  `refundCents > remainingRefundableCents` (`charge.amount -
charge.amount_refunded`) before Stripe is called.
- `allocateCancellationLossCents` (`refund-basis.ts:75-153`) divides
  `orders.actual_stripe_fee_cents` proportionally to refund amounts
  across all shipments in the cancelled order (largest-remainder-first).
  Returns `null` when `actual_stripe_fee_cents IS NULL` (un-reconciled
  fee); in that case the buyer refund still issues in full but no loss
  is persisted.
- Documented intent (`specs/shipments/spec.md` lines 117, 191–197, 254):
  explicit "Refund excludes seller-paid shipping; refund capped at
  remaining refundable amount" + "partial refund amount equals the
  shipment subtotal plus its proportional share of the grossed-up
  buyer-paid fee" — **these match the code**. The cap rule maps to
  `remainingRefundableCents`; the metadata rule maps to the Stripe
  refund metadata `{ shipment_id, order_id, caller_role, reason,
seguro_share_cents }` emitted by `cancel-order.ts:171-176`.

### 5. Durable data flow (compact)

```
PRODUCT LISTING (sandbox quote; provider is non-authoritative)
  useSellDetailsForm ──▶ get-shipping-quote (single origin, hardcoded
                          destination, hardcoded carrier/service REQUEST
                          but unfiltered RESPONSE)
                       └─▶ rates[0].price
                            └─▶ products.shipping_cost  (peso string, no cents)
                            └─▶ useSellStore.draft.shipping_cost

CHECKOUT (single-modal multi-seller; seller-pays shipping)
  create-connect-payment
    ├─ calculateCheckoutAllocation
    │    └─ calculateConnectMoneyFlow  (buyer total = gross + seguro)
    ├─ calculateEstimatedSellerShippingDeductionCents
    │    = quote + buffer(3 000¢) + Envia insurance (1.2% of price)
    │    └─ Stripe metadata.allocation.rows[].shippingCents (seller-paid)
    └─ Stripe PaymentIntent(amount = buyerTotalCents only)

PAYMENT_INTENT.SUCCEEDED  ──▶  stripe-webhooks
  └─ fn_create_shipments_from_single_payment (single transaction)
        ├─ orders: shipping_address = buyer's addresses row snapshot
        ├─ shipments: shipping_cost = shippingCents (seller-paid)
        └─ order_items: commission_amount, shipping_amount,
                        shipping_payer='seller', net_payout
        invariant: gross = commission + shipping + net per row

LABEL GENERATION (sandbox label; deterministic only Paquetexpress ground)
  prepare/[id].tsx ──▶ generate-shipping-label (6-step RPC orchestration)
    1. fn_claim_shipment_label  ──  state='claimed', token (15 min TTL)
    2. re-rate Envia /ship/rate/ with REAL origin/destination/package
       OR reuse persisted label_quote_* if input_hash matches
    3. selectPaquetexpressGroundRate  (exactly one Paquetexpress/ground/mxn)
    4. fn_persist_shipment_label_quote  (server-side revalidates Paquetexpress/ground)
       ├─ shipments.label_quote_carrier
       ├─ shipments.label_quote_service
       ├─ shipments.label_quote_cost_cents   ← RATE evidence, in cents
       ├─ shipments.label_quote_reference
       ├─ shipments.label_quote_rated_at
       └─ shipments.label_quote_input_hash
    5. fn_mark_shipment_label_sent  ──  state='generation_sent'
    6. Envia /ship/generate/
       extractEnviaLabelCostCents  (multi-path robust extraction)
       fn_finalize_shipment_label
         ├─ shipments.envia_shipment_id
         ├─ shipments.tracking_number
         ├─ shipments.label_url
         ├─ shipments.carrier               ← final provider carrier
         ├─ shipments.service               ← final provider service
         ├─ shipments.print_format
         ├─ shipments.print_size
         ├─ shipments.label_provider_cost_cents  ← ACTUAL provider cost
         └─ shipments.status='preparing'

CANCEL / REFUND  (seller-paid shipping excluded by construction)
  cancel-order | auto-cancel-orders | auto-cancel-preparing
    └─ computeShipmentRefundAmountCents(buyer total does NOT include
                                        shipping, so shipping is naturally
                                        excluded from refund basis)
         ├─ remainingRefundableCents cap → REFUND_AMOUNT_EXCEEDS_CAP (422)
         └─ Stripe refund with metadata {shipment_id, order_id,
                                          caller_role, reason,
                                          seguro_share_cents}
       fn_cancel_shipment / fn_complete_shipment_refund
         └─ allocateCancellationLossCents distributes
            orders.actual_stripe_fee_cents by refund weight (NULL until
            Stripe fee is reconciled)
```

### 6. Tests that exist vs. tests that are missing

- Existing tests touching this surface:
  - `supabase/functions/_shared/__tests__/envia-shipping.test.ts` —
    exercises `classifyEnviaGenerateOutcome`.
  - `supabase/functions/generate-shipping-label/diagnostics.test.ts` —
    exercises `extractEnviaLabelCostCents` and
    `buildSanitizedEnviaResponseMetadata`.
  - `supabase/functions/cancel-order/cancel-order.test.ts` — exercises
    `computeShipmentRefundAmountCents`.
  - `supabase/functions/_shared/__tests__/envia-shipping.test.ts` covers
    a subset of the orchestration helpers but **NOT**
    `runLabelClaimOrchestration` end-to-end.
- No tests exist for:
  - `get-shipping-quote` (no schema, no rate response handling, no
    error-path coverage).
  - `selectPaquetexpressGroundRate` directly (the function is critical
    and rejects ambiguous rate responses; no test pins the "exactly one
    match" rule).
  - `calculateEstimatedSellerShippingDeductionCents` (the listing→checkout
    bridge that adds buffer + insurance).
  - `calculateCheckoutAllocation` / `assertValidCheckoutAllocation`
    (financial invariants: row breakdown, buyer total, net total).
  - `allocateCancellationLossCents` (proportional fee distribution).
  - `fn_persist_shipment_label_quote` Paquetexpress/ground guard.
- Per Envia skill: the documentation lookup so far used only
  `https://docs.envia.com/llms.txt` (index only). No focused `.md` page
  was fetched in this exploration; focused rate and label pages should
  be consulted before any spec/design write that touches provider
  semantics.

## Affected Areas

- `supabase/functions/get-shipping-quote/index.ts` — single-origin Edge
  Function. The deployed contract (single package, single origin,
  multi-carrier response) is **inconsistent with** the current OpenSpec
  `shipments/spec.md` description of a multi-seller array + Paquetexpress
  ground-only response.
- `supabase/functions/_shared/envia-shipping.ts` — shared helpers
  (`selectPaquetexpressGroundRate`, `runLabelClaimOrchestration`,
  `resolveEnviaRuntimeConfiguration`, `buildEnviaShipmentConfiguration`).
  These are the authoritative Paquetexpress ground enforcement point.
- `supabase/functions/generate-shipping-label/index.ts` and
  `diagnostics.ts` — label Edge Function + response-shape diagnostics.
  `extractEnviaLabelCostCents` is the durable label-cost audit signal.
- `supabase/functions/create-connect-payment/fee-calculator.ts` —
  checkout-time financial bridge.
- `supabase/functions/cancel-order/cancel-order.ts`,
  `supabase/functions/auto-cancel-orders/index.ts`,
  `supabase/functions/auto-cancel-preparing/index.ts`,
  `supabase/functions/_shared/refund-basis.ts` — refund / cancellation-loss
  pipeline.
- `supabase/functions/__tests__/envia-shipping.test.ts`,
  `supabase/functions/cancel-order/cancel-order.test.ts`,
  `supabase/functions/generate-shipping-label/diagnostics.test.ts`,
  `supabase/functions/__tests__/shipmentCancelSafetySourceGuards.test.ts`
  — existing tests.
- `apps/frontend/core/hooks/useShippingQuote.ts`,
  `useSellDetailsForm.ts`, `useSellerShippingQuote.ts` — listing-time
  consumer. `useSellerShippingQuote.ts` calls a non-existent
  `get-shipping-quote-seller` Edge Function.
- `apps/frontend/core/hooks/useOrderActions.ts` — label-generation client
  contract (`generateLabel({ shipmentId, originAddressId, shippingEvidence })`).
- `apps/frontend/app/profile/orders/prepare/[id].tsx` — label-generation
  UI entry point. No client-side shipping-cost display; UI relies on
  Edge Function results.
- `apps/frontend/components/features/checkout/ShippingMethodSelector.tsx`
  — UI artifact: hardcodes an `[dhl, estafeta, paquetexpress]` carrier
  list. **No shipping method is actually selectable at checkout in the
  current flow** — checkout never calls `get-shipping-quote`; this UI
  exists from the abandoned multi-carrier listing form experiment and
  has no live caller.
- `supabase/migrations/20260713210000_envia_shipping_label_hardening.sql`
  - `20260824001426_post_purchase_label_generation_foundation.sql` +
    `20260824020000_envia_address_origin_remediation.sql` — schema source
    of truth for `shipments.label_*` and `system_settings.envia_*`
    columns. **Per `openspec/changes/post-purchase-reliability-audit/exploration.md`
    gaps G1 + G7**, the migration is on disk but not yet applied remotely
    and `packages/types/src/database.types.ts` does not reflect the new
    columns — generated types currently do NOT match the latest on-disk
    SQL.
- `packages/types/src/database.types.ts` — current `shipments` row
  contains the new columns (`service`, `print_format`, `print_size`,
  `label_provider_cost_cents`, `label_generation_state`, `claim_token`,
  `claim_expires_at`, `label_quote_carrier`, `label_quote_service`,
  `label_quote_cost_cents`, `label_quote_input_hash`,
  `label_quote_rated_at`, `label_quote_reference`,
  `label_generated_at`, `origin_address_id`, `shipping_evidence`,
  `buyer_confirmed_at`, `stripe_payout_id`, `completed_at`); the
  audit gap G7 mentioned in `post-purchase-reliability-audit` may have
  been resolved locally, but the maintainer must confirm the regenerated
  types are authoritative for remote.
- `packages/types/src/index.ts` — exports `ShippingCarrier` as a 4-value
  union (`'dhl' | 'estafeta' | 'paquetexpress' | 'fedex'`) and
  `ShippingOption { carrier, service, price, estimated_days? }`.
- `openspec/specs/shipments/spec.md` — the authoritative shipment
  contract. **Stale in at least four places** (see Risks).

## Approaches

1. **Codify the deployed contract as authoritative and update the spec.**
   - Re-shape the `get-shipping-quote` section to describe the actual
     single-origin listing-time Edge Function, the `06500` CDMX-pivot
     default destination, the unfiltered multi-carrier response, and the
     lack of buyer-side quotation. Add a NEW section for the label-time
     re-rating that establishes `selectPaquetexpressGroundRate` as the
     single carrier/service enforcement point. Replace the stale
     "buyer pays all shipping" requirement with the seller-pays model
     from `calculateCheckoutAllocation`.
   - Pros: aligns contract with reality; minimal code risk; unblocks the
     payout session because the financial flows are now self-consistent.
   - Cons: requires acknowledging the spec drift explicitly; does NOT
     surface the dead `useSellerShippingQuote` and
     `ShippingMethodSelector` artifacts.
   - Effort: Low–Medium (spec + types only; no remote migration).
2. **Codify the multi-seller redesign from the archive (Fase 5.1) as the
   target contract and write a migration plan that back-fills the gap.**
   - Restore the `items[]` / `Record<sellerId, ShippingOption[] | null>`
     Edge Function contract from `archive/2026-05-29-complete-shipment-migration/specs.md`
     § 5.1, accept the listing-time and checkout-time carrier selection,
     and decide where the selection is persisted (product row vs. order
     row vs. shipment row).
   - Pros: fixes the documented-vs-actual divergence at the source;
     aligns with the design artifacts already drafted.
   - Cons: blocks the payout session on a much larger change; requires
     product decisions on whether checkout-time carrier selection is
     actually wanted (see "Product decisions still needed" below); touches
     a buyer-facing surface.
   - Effort: High (Edge Function rewrite + product row schema + UX).
3. **Hybrid — codify current behavior for the durability contract and
   file a follow-up for the multi-seller redesign.**
   - Land the spec delta for what exists today (Approach 1) so the
     payout session can reference a stable, correct contract. Add an
     explicit follow-up change in the OpenSpec backlog for the
     multi-seller redesign (Approach 2), gated on the product decisions
     captured here.
   - Pros: unblocks the payout session today; preserves the
     multi-seller redesign for the maintainer to green-light; minimal
     risk in the durable contract change.
   - Cons: two changes to coordinate; the multi-seller redesign will
     still touch the durable contract later.
   - Effort: Low–Medium for the durable change; the follow-up is out of
     scope here.

## Recommendation

Use **Approach 3 (hybrid)**. The maintainer's stated intent is to
establish a durable, correct contract for the existing `get-shipping-quote`
logic BEFORE a later payout session. That intent is satisfied by:

1. Reconciling the four stale spec lines against the on-disk Edge
   Functions and SQL migrations.
2. Recording the durable data flow above (already in this file) as the
   authoritative contract reference.
3. Adding tests for the missing helpers (`selectPaquetexpressGroundRate`,
   `calculateEstimatedSellerShippingDeductionCents`,
   `assertValidCheckoutAllocation`, `allocateCancellationLossCents`,
   `fn_persist_shipment_label_quote` guard) under strict TDD so the
   payout session can rely on them.
4. Documenting `get-shipping-quote-seller`, `useSellerShippingQuote`,
   and `ShippingMethodSelector` as **dead code** with explicit
   disposition (delete / repurpose / keep for future multi-carrier UX).
5. Filing the multi-seller redesign as a follow-up change so the
   product decision is captured without blocking the payout session.

The durable contract itself is sound: the four pieces
(listing-estimate → checkout-allocation → label-rate evidence →
refund exclusion) compose correctly. The work is to make the contract
**explicit, testable, and acknowledged** in the OpenSpec spec.

## Risks

- **Spec drift.** `specs/shipments/spec.md` is wrong in at least four
  places against the deployed code: (a) `get-shipping-quote` shape and
  Paquetexpress-only rule, (b) `generate-shipping-label` payload shape
  (`originAddress: AddressObject` vs actual `originAddressId: UUID`),
  (c) "buyer pays all shipping" vs deployed seller-pays model,
  (d) "atomic update" vs deployed 6-step claim orchestration. Any new
  payout work that references the spec will inherit the drift.
- **Rate at listing vs. rate at label.** The listing-time quote uses a
  CDMX pivot destination (`06500`); the label-time rate uses the
  buyer's actual `orders.shipping_address`. These can diverge by
  non-trivial amounts when the buyer is outside CDMX. The current
  buffer (`DEFAULT_SHIPPING_BUFFER_CENTS = 3_000`) is meant to absorb
  drift, but it is not calibrated and is silent on the drift source.
- **`get-shipping-quote-seller` is non-existent.** `useSellerShippingQuote`
  imports and calls `invokeEdge('get-shipping-quote-seller', ...)`. No
  such Edge Function exists under `supabase/functions/`. This is dead
  code or a half-finished rename.
- **`ShippingMethodSelector` is unreachable.** It renders DHL/Estafeta/
  Paquetexpress options in a checkout that never calls
  `get-shipping-quote`. Either a checkout-time quote flow exists
  elsewhere and was not found, or this component is also dead.
- **Listing-time carrier/service is non-deterministic.** The current
  Edge Function returns whatever Envia returns; selecting
  `rates[0]` to populate `products.shipping_cost` is arbitrary. Any
  contract that asserts "the listing quote is for Paquetexpress ground"
  would be false unless `rates[0]` happens to be Paquetexpress ground,
  which is not guaranteed.
- **Type vs. deployed schema drift.** `packages/types/src/database.types.ts`
  already lists the new `shipments` columns, but the audit
  (`post-purchase-reliability-audit/exploration.md` gap G7) reported the
  types lagged the on-disk migration. Until the maintainer confirms
  `bun db:types` was run against the live remote DB, the types are
  best-effort and any spec/design that depends on them must explicitly
  re-verify against the deployed schema.
- **Envia doc lookup was index-only.** No focused `.md` page from
  `docs.envia.com` was consulted for this exploration. Any contract
  claim about Envia provider semantics (rate availability, currency,
  service-level filter behavior) should be re-validated against the
  focused rate / label pages before being written into OpenSpec.

## Product decisions still needed (do NOT propose fixes without these)

The following decisions are NOT confirmable from the code or spec and
must be answered by the maintainer before the contract can be considered
durable. They are deliberately left out of the proposal until the
maintainer answers them explicitly.

1. **Listing-time destination.** Should the listing-time
   `get-shipping-quote` continue using the CDMX pivot (`06500`) as the
   default destination when no real buyer is known, or should it be
   removed entirely and shipping cost be set manually by the seller?
2. **`get-shipping-quote-seller` and `useSellerShippingQuote`.** Are
   these dead artifacts (delete) or a half-finished rename (finish the
   rename to the public `get-shipping-quote`)? The on-disk function is
   named `get-shipping-quote`, not `get-shipping-quote-seller`.
3. **`ShippingMethodSelector` at checkout.** Should a carrier/service
   selector ever appear at checkout, or is checkout-time shipping fixed
   to whatever the seller set at listing time? The current code says
   fixed (checkout never quotes), but the component exists.
4. **Listing-time rate selection determinism.** Should
   `get-shipping-quote` filter the rate request (and/or the response) to
   Paquetexpress ground only at listing time, matching the label-time
   enforcement? Or is the current "accept whatever Envia returns"
   intentional because the listing estimate is only a soft hint?
5. **Buffer calibration.** `DEFAULT_SHIPPING_BUFFER_CENTS = 3_000`
   ($30 MXN) is hardcoded. Is that buffer intended to absorb the
   listing-to-label drift between CDMX pivot and real buyer
   destination, or is it reserved for something else? Should the buffer
   be configurable in `system_settings` like `envia_carrier` already is?
6. **`label_quote_input_hash` reuse window.** The label Edge Function
   reuses `label_quote_*` evidence only when `rateInputHash` matches the
   prior hash exactly (every origin/destination/dimension/insurance byte).
   Is this strict-match policy intentional, or should a short freshness
   window (e.g. "valid if rated within the last 60 minutes even if
   input_hash differs") be added to reduce Envia calls? The current
   orchestration always re-rates unless the inputs are byte-identical.
7. **Buyer disclosure of shipping cost.** The deployed checkout total
   does NOT include seller-paid shipping in the buyer charge. Should
   the buyer see the seller's shipping cost at any point (listing,
   cart, checkout) for transparency, or is "the seller absorbs
   shipping" a deliberate product positioning that the buyer should not
   see?
8. **Spec authority.** The current `specs/shipments/spec.md` predates
   `2026-07-02_single_modal_checkout_settlement`, `2026-07-13_envia_shipping_label_hardening`,
   and `2026-08-24_post_purchase_label_generation_foundation`. Should
   the maintainer sign off on the spec delta proposed in Approach 1
   before the payout session starts, or should the payout session
   proceed with an inline contract note and the spec update happen
   afterwards?
9. **Maintainer confirmation of generated types.** Has `bun db:types`
   been run against the remote DB after `2026-07-13_envia_shipping_label_hardening`
   and `2026-08-24_post_purchase_label_generation_foundation` were
   applied? The on-disk `database.types.ts` lists the new columns, but
   the remote-confirmed status is not in this exploration's scope.

## Ready for Proposal

**Partial — pending the maintainer's answers to the product decisions
above.** The proposal can be drafted for the durable-contract delta
(Approach 3, step 1) and the missing-helper test additions
(Approach 3, step 3) without resolving the product decisions. The
multi-seller redesign (Approach 2) and the dead-code disposition
(Approach 3, step 4) MUST wait for maintainer sign-off on the
corresponding product decisions before any fix is proposed.

## Scope discipline reminder

This change MUST NOT broaden into:

- Payout release (separate, later session).
- UI rollout (no checkout-time shipping selector changes).
- Remote deployment of migrations or Edge Functions (maintainer-only).
- Real Envia API calls (sandbox-only; no `ENVIA_API_KEY_PROD`).
- Auth or RLS hardening (separate concern).
