# Exploration: confirm-shipment

> Read-only first-principles audit for the buyer-side shipment confirmation
> module of Selene (Mexican used-PC marketplace). Reconstructs the live
> call/data path from generated types and SQL, classifies each surface, and
> proposes a narrow MVP++ redesign/hardening boundary.

## Scope

In scope:

- Buyer-initiated shipment confirmation: trigger, RPC, transition, audit,
  idempotency, multi-shipment isolation, payout-eligibility interaction,
  carrier-tracking interaction, dispute interaction.
- Frontend `canConfirmDelivery` gate, `useOrderActions.confirmDelivery`
  mutation, the `ConfirmDialog` flow in `apps/frontend/app/profile/orders/[id].tsx`,
  the `OrderShipmentCard` / `OrderActionCard` usage of `canConfirmDelivery`.
- Affected contract surfaces: `packages/types/src/index.ts`,
  `packages/types/src/database.types.ts`, `openspec/specs/shipments/spec.md`,
  `openspec/specs/connect-payout-release/spec.md`.

Out of scope (this change will NOT touch):

- Quote economics / MXN 30 buffer / shipping cost recalculation.
- Cancellation, dispute creation/resolve/refund.
- Stripe Connect transfer/payout mechanics (preserved as-is; only the gate
  logic that depends on `stripe_payment_intent_id` / `stripe_transfer_id` is
  read).
- Label generation, return label generation, Envia tracking crons.
- Remote deployment (SQL apply, Edge Function deploy, `bun db:types`).
- Configuration changes (ESLint/TS/bun/test/CI/Husky).
- The locally dirty `plan.md` and any unrelated modifications.

## Current State

### One-call buyer confirm path (live)

1. **UI gate** — `apps/frontend/core/hooks/useShipments.ts`
   `enrichShipment` (line 85) sets `permissions.canConfirmDelivery` to:
   ```ts
   isBuyer && ['shipped', 'delivered'].includes(shipment.status) && !isDispute;
   ```
   No `delivered_at` grace check, no admin override, no seller path.
   The legacy `apps/frontend/core/hooks/useOrders.ts` `enrichOrder`
   (line 143) carries the same gate at order level for backward compat
   screens that still use `useOrderById`.

2. **UI binding** — `apps/frontend/app/profile/orders/[id].tsx`
   (line 726) renders the `ConfirmDialog` button when
   `currentShipment?.permissions.canConfirmDelivery` is true. The
   dialog (`orders.json` `dialogs.deliveryTitle` / `deliveryMsg`,
   es + en) confirms that the buyer has the package in hand.
   On confirm (line 822) it calls `actions.confirmDelivery.execute({ shipmentId: currentShipment?.id })`.
   `OrderActionCard` and `OrderShipmentCard` consume the same
   `permissions.canConfirmDelivery` flag for the per-shipment card and
   the action card; no other call sites exist.

3. **Client mutation** — `apps/frontend/core/hooks/useOrderActions.ts`
   `confirmDelivery` (lines 42–69) is a `useMutation` that calls
   `supabase.rpc('fn_confirm_shipment_delivery', { p_shipment_id })`
   directly via the postgrest client when a `shipmentId` is provided.
   The fallback `supabase.rpc('fn_confirm_delivery', { p_order_id })` only
   runs when `shipmentId` is missing (legacy order-level path).
   On success, query invalidates `['order', orderId]`,
   `['my-purchases']`, `['shipments', orderId]`.
   Errors are surfaced by `throw error` / `throw new Error(data[0]?.error_message)`
   and the screen does not currently render any toast; the dialog stays
   open with a generic message.

4. **Server RPC** — `supabase/queries/orders/fn_confirm_shipment_delivery.sql`
   is the deployed source-of-truth. It is `SECURITY DEFINER`,
   `SET search_path = public, pg_temp`, and accepts `p_shipment_id UUID`.
   Behaviour:
   - `SELECT ... FOR UPDATE` on `shipments` (race-safe).
   - Rejects `auth.uid() != order.buyer_id` with `UNAUTHORIZED`.
   - Rejects unless `status IN ('shipped', 'delivered')` with
     `SHIPMENT_NOT_IN_CONFIRMABLE_STATE`.
   - Rejects when a non-resolved/non-rejected dispute exists for
     `shipment_id` with `SHIPMENT_HAS_ACTIVE_DISPUTE`.
   - Looks up the seller's wallet (must exist; `SELLER_WALLET_NOT_FOUND`).
   - Sums `order_items.net_payout` for the shipment.
   - **Mutates `wallets`**: `pending_balance = GREATEST(0, pending_balance - v_net_payout)`,
     `available_balance = available_balance + v_net_payout`.
   - Inserts a `wallet_transactions` row with `type = 'release'`.
   - `UPDATE shipments SET status = 'completed', completed_at = now()`.
   - Returns `(true, NULL)` or `(false, <code>)`.
   - `EXCEPTION WHEN OTHERS` logs to `system_logs` and returns the SQLERRM.

5. **Order-level trigger** — `supabase/queries/triggers/shipments/fn_shipments_status_trigger.sql`
   re-derives `orders.status` via `fn_derive_order_status` after every
   shipment `INSERT/UPDATE OF status`. The derive function treats
   `completed` as the highest progress state, so once every shipment is
   `completed`, the order also becomes `completed`.

6. **Payout eligibility side-effect** — Once `shipments.status = 'completed'`,
   the shipment becomes visible to
   `admin_connect_payout_release_view` (`s.completed_at IS NOT NULL`
   filter) and shows up in the admin release queue
   (`get-connect-payout-release-queue`). Admin then runs
   `release-connect-payout`, which creates a Stripe Transfer + Payout to
   the seller via the `stripe_transfer_group` allocation record. The
   admin path is shipment-scoped and idempotent and is verified by
   `packages/types/src/connectPayoutContracts.test.ts`.

### The defects (first-principles)

**Defect A — buyer confirm skips the `delivered` gate.** The current gate
allows confirmation from `shipped` (no `delivered_at`, no carrier scan
recorded via `fn_mark_shipment_delivered` or `fn_record_tracking_event`).
This means a buyer can press "Confirm" before the package physically
arrives, which:

- Marks the shipment `completed` with no `delivered_at` timestamp.
- Bypasses the 48h grace window used by `fn_cron_release_shipment_funds`
  (which requires `delivered_at < now() - interval '48 hours'`).
- For Stripe Connect shipments: makes the shipment immediately eligible
  for admin payout release because the admin view filters on
  `has_completed_at` (`s.completed_at IS NOT NULL`), not on
  `delivered_at`.

**Defect B — buyer confirm mutates the deprecated `wallets` table for
Connect shipments.** `fn_confirm_shipment_delivery` has **no Connect
guard**. By contrast, `fn_release_shipment_funds`,
`fn_complete_shipment_refund`, and `fn_log_return_payment` all early-return
when `stripe_payment_intent_id IS NOT NULL` (the
`CONNECT_SHIPMENT_SKIPPED_WALLET_*` markers). The
`wallets`, `wallet_transactions`, and `payout_requests` tables are
explicitly marked `DEPRECATED by Stripe Connect migration. Keep
read-only for audit.` (`supabase/migrations/20260603000001_connect_lifecycle_cleanup.sql`
lines 60–65). For a Connect shipment the current `fn_confirm_shipment_delivery`:

- Decrements the unused `wallets.pending_balance` (harmless but corrupts
  audit signal).
- Increments `wallets.available_balance` (same).
- Inserts a `wallet_transactions` row of `type='release'` that has no
  corresponding Stripe event.
- Marks the shipment `completed`, so `admin_connect_payout_release_view`
  exposes it for Connect transfer via the manual admin queue.

**Defect C — direct buyer RPC contradicts the financial invariant.** AGENTS.md
states: *"Privileged financial mutations belong in Edge Functions using
server credentials and narrowly granted database RPCs."* `cancel-order`
follows this pattern (Edge Function → service-role → `fn_cancel_shipment`).
`fn_confirm_shipment_delivery` is invoked directly by the authenticated
buyer via `supabase.rpc`, with `SECURITY DEFINER` masking the wallet write.
The same caller trust posture that motivates `cancel-order` to use an Edge
Function applies here: idempotency keys, audit log, recipient-role metadata,
Stripe-fee gross-up math, post-mutation notifications, and 503 maintenance
gating are all missing.

**Defect D — no idempotency / concurrency story beyond row lock.** The
`FOR UPDATE` row lock prevents the same buyer double-tapping in the same
millisecond, but:

- A buyer-confirm that fails after the wallet mutation but before the
  shipment update leaves the wallet decremented and the shipment stuck.
  There is no rollback/compensation.
- Two clients (e.g. mobile + web) hitting the RPC concurrently both
  wait on the row lock; the second sees `status = 'completed'` after
  the first commits and gets `SHIPMENT_NOT_IN_CONFIRMABLE_STATE`. No
  client-side detection treats this as success.
- The RPC does not check whether `auth.uid()` is the buyer of `orders`
  *before* taking the wallet `FOR UPDATE` lock (it takes the shipment
  lock first, then reads `orders.buyer_id`). This means a malicious
  caller can briefly block any other buyer-of-this-order confirm by
  holding the shipment lock; minor but worth flagging.

**Defect E — no audit event tied to buyer confirmation.** There is no
`shipment_confirmation_events` (or similar) row, no
`system_logs` `INFO` line, no `notifications` insert for the seller.
Compare to `cancel-order` (logs reason) and `fn_complete_shipment_refund`
(notifies buyer + seller).

**Defect F — UI copy promises "esto liberará el pago al vendedor" but
the actual payout path is two-step admin release.** The dialog copy
(`orders.json` `dialogs.deliveryMsg`) is misleading: for Connect shipments
the money is not actually released by `confirmDelivery`; it is queued for
admin release. This is a UX defect tied to defect B and needs copy +
behaviour alignment.

**Defect G — `fn_confirm_delivery` order-level fallback is still
exposed.** The order-level `fn_confirm_delivery` (legacy, multi-seller
batch) is referenced from the `useOrderActions.confirmDelivery` fallback
branch and is still callable by authenticated buyers. It also mutates
`wallets`, also has no Connect guard, and is undocumented in the current
spec. Plan + design should explicitly retire it.

### What is verified as currently working (Preserve candidates)

- `shipments.delivered_at`, `shipped_at`, `completed_at` columns exist
  and are populated by `fn_mark_shipment_delivered`,
  `fn_record_tracking_event`, and `fn_confirm_shipment_delivery`
  respectively (verified in `packages/types/src/database.types.ts`
  rows 1987–2010, 2000–2022).
- `order_status_enum` includes `pending | paid | preparing | shipped |
  delivered | completed | cancelled | dispute | refunded` and the
  trigger derives correctly.
- `fn_shipments_status_trigger` is wired
  (`supabase/queries/triggers/shipments/fn_shipments_status_trigger.sql`)
  and `fn_derive_order_status` is `STABLE SECURITY DEFINER` with the
  priority matrix (dispute > refunded > cancelled > refunded_cancelled,
  then progress paid < preparing < shipped < delivered, then completed).
- `admin_connect_payout_release_view` correctly excludes shipments
  without `completed_at`, without `stripe_payment_intent_id`, or with
  active dispute/refund — so once we fix defect B and have
  `completed_at` only set after `delivered_at` + grace, the payout
  path becomes correct.
- The dispute check inside `fn_confirm_shipment_delivery` (rejects when
  `disputes.shipment_id = p_shipment_id AND status NOT IN ('resolved',
  'rejected')`) is correct and matches the current
  `cancel-order` posture.
- The frontend `EnrichedShipment.permissions.canConfirmDelivery` and the
  per-shipment card / action card wiring is consistent across
  `useShipments.ts`, `useOrders.ts`, `OrderActionCard.tsx`,
  `OrderShipmentCard.tsx`, and `[id].tsx`.

### Interaction map (verified)

- **Tracking terminal states** — `delivered` is set by
  `fn_mark_shipment_delivered` (called by `track-shipments` cron and by
  `fn_record_tracking_event` from the Envia tracking webhook) and from
  `fn_confirm_shipment_delivery`'s own transition to `completed`. If
  the proposal tightens confirm to require `delivered`, the cron
  becomes the canonical `delivered` source; the buyer confirm is then
  a separate `delivered → completed` transition. This is the same
  separation that already exists between `cancel-order` (manual) and
  the auto-cancel crons.
- **Disputes** — `create-dispute` requires `order.status IN ('shipped',
  'delivered')` and the 48h delivered window. `fn_confirm_shipment_delivery`
  rejects when an active dispute exists for `shipment_id`. The
  proposed change keeps the rejection and adds the symmetric invariant:
  no confirm while a dispute is open (already covered). Confirmed.
- **Cancellations** — `cancel-order` requires `status = 'paid'`; once
  the shipment is `shipped` or beyond, the manual cancel path is
  closed and disputes are the only route. The proposal stays out of
  cancellation scope (explicitly excluded).
- **Returns** — `fn_seller_confirm_return_shipment` calls
  `fn_complete_shipment_refund` which has the Connect guard. Not
  affected.
- **Order aggregate status** — Driven by `fn_derive_order_status` via
  trigger. Once a single shipment is `completed`, the order stays in
  the lowest-progress state until all are `completed`. The proposal
  preserves this and only adds stricter `completed_at` semantics.
- **Admin flows** — `get-connect-payout-release-queue` and
  `release-connect-payout` consume `completed_at` and the allocation
  record. The proposal does not modify the admin path; it ensures the
  admin path receives `completed_at` only after `delivered_at` + the
  expected grace so the queue cannot expose premature-release rows.
- **Safety crons** — `fn_cron_release_shipment_funds` is unscheduled
  in `connect_lifecycle_cleanup.sql` and is `DEPRECATED`. The proposal
  does not reschedule it.

## Affected Areas

Production code (read-only verified):

- `supabase/queries/orders/fn_confirm_shipment_delivery.sql` — must be
  replaced with a Connect-aware version that requires `delivered` (or
  `shipped + tracking-delivered` per a future variant) and skips
  `wallets` for Connect shipments. **Replace.**
- `supabase/queries/orders/fn_confirm_delivery.sql` — legacy
  order-level function. Should be retired (drop from registry) or
  marked deprecated. **Replace** with no-op stub or remove.
- `supabase/queries/shipments/fn_release_shipment_funds.sql` —
  reference pattern for the Connect guard. **Preserve.**
- `supabase/queries/shipments/fn_complete_shipment_refund.sql` —
  reference pattern for the Connect guard + Connect skip marker.
  **Preserve.**
- `supabase/queries/triggers/shipments/fn_shipments_status_trigger.sql`
  — unchanged. **Preserve.**
- `apps/frontend/core/hooks/useOrderActions.ts` — `confirmDelivery`
  mutation calls `supabase.rpc('fn_confirm_shipment_delivery', ...)`.
  The post-change caller will route through a new Edge Function
  (`confirm-shipment-delivery`) with `idempotencyKey` and
  `callerRole: 'buyer'`. **Replace.**
- `apps/frontend/core/hooks/useShipments.ts` —
  `enrichShipment` sets `permissions.canConfirmDelivery` from
  `['shipped', 'delivered']`. The post-change gate is `delivered` only
  (or `delivered` + a documented same-day grace for `shipped`; product
  decision). **Adapt.**
- `apps/frontend/core/hooks/useOrders.ts` — `enrichOrder.canConfirmDelivery`
  has the same gate; the order-level screen consumes the same flag.
  **Adapt.**
- `apps/frontend/app/profile/orders/[id].tsx` — `ConfirmDialog` wiring
  for `confirmDelivery`. The dialog copy must be aligned with the new
  semantics (only after delivery). **Adapt.**
- `apps/frontend/components/features/orders/OrderActionCard.tsx` —
  consumes `permissions.canConfirmDelivery`. **Preserve** signature,
  adapt meaning.
- `apps/frontend/components/features/orders/OrderShipmentCard.tsx` —
  same. **Preserve** signature, adapt meaning.
- `packages/types/src/index.ts` — `EnrichedShipment.permissions` is the
  flag the UI reads. No new fields required unless the proposal adds
  `buyer_confirmed_at`. **Adapt** (optional new field) or **Preserve**
  (just tighten the meaning documented in JSDoc).
- `packages/types/src/database.types.ts` — currently lists
  `fn_confirm_delivery` and `fn_confirm_shipment_delivery` in
  `Functions`. After the change: `fn_confirm_shipment_delivery` keeps
  its signature for backward compat (any orphan client), but the new
  Edge Function is the supported path. The signature stays; semantics
  change. **Adapt.**
- `openspec/specs/shipments/spec.md` — current spec already says
  `canConfirmDelivery: buyer + status in ('shipped','delivered')` and
  nothing about payout release. New delta required. **Adapt.**
- `openspec/specs/connect-payout-release/spec.md` — admin-side gate;
  no change to the view or the release RPC. **Preserve.**
- `apps/frontend/core/i18n/locales/{en,es}/orders.json` —
  `dialogs.deliveryTitle`, `dialogs.deliveryMsg`, `actions.confirmDelivery`
  must be reworded to reflect post-delivery-only confirmation.
  **Adapt.**

Migrations (deployable artefacts the maintainer will run):

- A new `supabase/migrations/<timestamp>_confirm_shipment_hardening.sql`
  that:
  1. Replaces `public.fn_confirm_shipment_delivery` body with the
     Connect-aware + `delivered`-only version, keeping the same
     signature and EXCEPTION block.
  2. Optionally adds `shipments.buyer_confirmed_at TIMESTAMPTZ` (read
     product decision; see "Unresolved product decisions" below).
  3. Optionally adds `shipments.buyer_confirmation_ip inet` or
     similar for audit (or, more cheaply, just an `INFO` line in
     `system_logs`).

Edge Function (new, deployable):

- `supabase/functions/confirm-shipment-delivery/index.ts` (mirrors
  `cancel-order` structure): service-role client, idempotency key,
  maintenance check, buyer auth check, RPC call, notification on
  success, toast-mapped error surface.

Tests:

- `tests/shipment-cancel-safety.test.ts` — pattern to mirror. New
  `tests/confirm-shipment-delivery.test.ts` will exercise a pure
  helper `resolveConfirmShipmentPlan` (built alongside the Edge
  Function) and verify gate behaviour.

Contracts:

- `packages/types/src/EdgeFunctionRegistry` adds
  `'confirm-shipment-delivery': { payload: { orderId, shipmentId }, response: { success, error? } }`.
- `packages/types/src/__tests__` should add a contract test mirroring
  `connectPayoutContracts.test.ts`.

## Approaches

1. **Minimal patch — keep direct RPC, only add Connect guard + tighten
   state.**
   - Drop the `wallets`/`wallet_transactions` writes for
     `stripe_payment_intent_id IS NOT NULL`. Mirror
     `fn_complete_shipment_refund`.
   - Tighten the allowed-state to `delivered` only.
   - Pros: small diff; no new Edge Function; aligns with
     cancel-order-style guard.
   - Cons: still violates the AGENTS.md "Edge Function for financial
     mutations" invariant; still no idempotency key; still no audit;
     still no maintenance gate; still no notification; still direct
     buyer RPC.
   - Effort: Low.

2. **Replace with an Edge Function mirroring `cancel-order`.**
   - New `supabase/functions/confirm-shipment-delivery/index.ts` +
     `confirm-shipment-delivery.ts` (helper, pure) modeled on
     `cancel-order.ts`.
   - Edge Function: auth, maintenance, caller-id check, idempotency
     key (`confirm_shipment_{shipmentId}` or client-supplied), RPC
     call, audit log, seller notification, buyer-success notification.
   - New (or rewritten) `fn_confirm_shipment_delivery`: requires
     `delivered`, Connect guard, sets `completed_at = now()`, emits
     `INFO` `system_logs` row, fires notifications.
   - `useOrderActions.confirmDelivery.execute` switches from
     `supabase.rpc(...)` to `invokeEdge('confirm-shipment-delivery', ...)`
     with `idempotencyKey`.
   - `EnrichedShipment.permissions.canConfirmDelivery` tightened to
     `status === 'delivered' && isBuyer && !isDispute` (or with a
     documented grace).
   - `EdgeFunctionRegistry` adds the new entry; contract test added.
   - The order-level `fn_confirm_delivery` is dropped from the type
     registry (kept on disk as a deprecated stub or removed in the
     same migration).
   - Pros: satisfies AGENTS.md invariant; consistent with the rest
     of post-purchase; idempotent and auditable; future-proofs the
     payout queue because `completed_at` only appears after the
     delivered grace.
   - Cons: larger diff; new Edge Function deploy; one new migration.
   - Effort: Medium.

3. **Replace + auto-completion grace (Connect-only path).**
   - Same as (2), plus: after `delivered_at + 48h` the system can
     auto-`completed`-promote the shipment via a new cron
     `fn_cron_finalize_delivered_shipments`. This makes the manual
     button optional for buyers who never confirm. The cron reuses
     `fn_release_shipment_funds`'s Connect-guard shape.
   - Pros: removes the manual confirmation as a hard requirement for
     payout; safer for trust flow.
   - Cons: out of MVP++ scope; introduces a new cron and a new
     admin/buyer expectation; the maintainer's stated MVP++ direction
     is "buyer confirms". Defer until after this change.
   - Effort: High.

## Recommendation

Go with **Approach 2**. Reasons:

- It is the smallest diff that closes all seven defects (A–G) at
  once and aligns with `cancel-order`'s structure, which is already
  shipped and tested.
- It satisfies the AGENTS.md invariant directly.
- It does not require any new column by default. The
  `buyer_confirmed_at` column is **optional** and only justified by
  a product decision (see "Unresolved product decisions" below); the
  proposal should add it only if the maintainer wants it.
- It does not change the Envia tracking crons, the cancellation
  flow, the dispute flow, the admin payout view, the
  `release-connect-payout` Edge Function, or any column on
  `shipments` other than possibly `buyer_confirmed_at`.
- It explicitly leaves quote/buffer economics untouched.
- It explicitly retires `fn_confirm_delivery` (the order-level
  fallback) so the legacy path stops drifting.
- The test surface is small: a pure helper test for the gate, a
  contract test for the new Edge Function registry entry, and a
  source-guard test ensuring the SQL still has the Connect guard.

A deferred slice for **Approach 3** (auto-completion cron) is
recorded as a future change; this change does not implement it.

## Risks

- **R1 — Migration order.** The new RPC body must ship alongside the
  Edge Function deploy. If the Edge Function calls a renamed RPC
  (e.g. `fn_confirm_shipment_delivery_v2`), the migration must
  precede the Edge Function. Plan: keep the same name with a `CREATE
  OR REPLACE FUNCTION` body swap to avoid name changes.
- **R2 — Behavior change for the live tenant.** Today a buyer can
  confirm at `shipped` and immediately make the shipment
  Connect-payout-eligible. After the change, the same buyer press
  returns `SHIPMENT_NOT_IN_DELIVERABLE_STATE` until the carrier scan
  records `delivered`. This is a strict tightening; no buyer-visible
  data loss but a UX change. Mitigation: keep the `canConfirmDelivery`
  flag false at `shipped` so the button is hidden, and tighten the
  dialog copy to say "after delivery".
- **R3 — Tracking `delivered_at` may be missing for tracking-disabled
  shipments.** If `track-shipments` cron is failing or Envia never
  reports delivery, `shipments.status` will stay `shipped` and the
  buyer cannot confirm. This is a pre-existing risk and is **not** in
  scope to fix here. The proposal documents the dependency and
  suggests a future cron fallback (Approach 3).
- **R4 — Deprecated `wallets` write suppression must be auditable.**
  The new RPC must log an `INFO` `system_logs` row when it skips the
  wallet mutation, mirroring the `CONNECT_SHIPMENT_SKIPPED_WALLET_*`
  return markers. This keeps the audit story consistent with the
  rest of the post-purchase layer.
- **R5 — Disputes with `shipment_id IS NULL` (legacy pre-migration).**
  `fn_confirm_shipment_delivery` filters disputes by `shipment_id`.
  Legacy disputes are tied to `order_id` only; this proposal does not
  revisit that, matching the `cancel-order` posture.
- **R6 — Existing `fn_confirm_delivery` fallback in the client.** If
  the proposal does not also retire the order-level function, the
  frontend fallback branch (when `shipmentId` is undefined) keeps the
  bug open. Mitigate by retiring the function in the same migration
  and removing the client fallback branch.
- **R7 — No remote deploy in this change.** The maintainer applies the
  SQL migration, deploys the Edge Function, populates any new
  `system_settings` rows (none anticipated), and runs `bun db:types`
  manually. The proposal includes a deployment-handoff listing the
  exact steps.

## Transition / Invariant Matrix (new behaviour)

| Aspect | Current behaviour | New behaviour |
|---|---|---|
| Allowed state for buyer confirm | `shipped`, `delivered` | `delivered` only |
| Buyer self-RPC | `supabase.rpc('fn_confirm_shipment_delivery', ...)` | `invokeEdge('confirm-shipment-delivery', { orderId, shipmentId, idempotencyKey })` |
| `wallets` write for Connect | Yes (incorrect) | No (Connect guard + `INFO` log) |
| Idempotency key | None | `confirm_shipment_{shipmentId}` (Edge Function default) |
| Audit row | None (only `system_logs` `ERROR` on failure) | `system_logs` `INFO` on success; new `shipment_confirmation_events` row (optional) |
| Seller notification | None | Yes, on success |
| `completed_at` source | Buyer confirm | Buyer confirm (only after `delivered`) |
| Payout eligibility gate | Buyer-confirm bypasses 48h grace | Buyer confirm at `delivered`; admin queue waits for the standard release path |
| Maintenance mode gating | None | 503 `MAINTENANCE_MODE` (mirrors `cancel-order`) |
| Order-level fallback `fn_confirm_delivery` | Still callable | Retired (function dropped in same migration; client fallback branch removed) |

## Unresolved product decisions (NOT technical defects)

These are NOT auto-resolved by this exploration; orchestrator must surface them to the user:

1. **Manual confirm only vs. confirm + auto-grace cron (Approach 3).**
   The maintainer's `plan.md` expresses MVP++ confidence in manual
   buyer confirmation as the primary fund-release signal. The
   proposal assumes that and stops here. If the user wants the
   48h-after-delivered auto-complete cron (Approach 3), the proposal
   becomes larger and lands as a separate change.
2. **`shipped` grace window.** Some marketplaces allow a buyer to
   confirm same-day as `shipped` even before carrier delivery, to
   support cases where tracking is broken. The proposal tightens to
   `delivered` only; if the user wants a 24–72h grace after `shipped`,
   the proposal must define the rule.
3. **`buyer_confirmed_at` audit column.** Whether to add the column
   for analytics + dispute inspection, or to rely on `completed_at`
   + `system_logs` + (optional) `shipment_confirmation_events`.
4. **Re-confirmation after dispute resolution.** After a
   `waiting_return → resolved (seller)` flow, the buyer must be able
   to re-confirm if the package re-arrives. Out of scope; flagged.
5. **Quote/buffer coupling.** Per the prompt, the MXN 30 buffer is a
   later module. The proposal explicitly does NOT recalculate
   shipping cost, but a future coupling is likely.

## Skill Resolution

- `sdd-explore` — invoked (this artifact is the phase output).
- `supabase` — applied: SECURITY DEFINER review, `search_path`
  discipline, RLS posture, Connect guard pattern verification,
  `service_role` boundary for the new Edge Function.
- `supabase-postgres-best-practices` — applied as the read frame for
  `FOR UPDATE` semantics, partial unique indexes, and audit/event
  tables; no new query is introduced in this change.
- `stripe-best-practices` — applied: RAK preference, Connect
  reverse_transfer semantics preserved, no new Stripe API surface.
- `envia-integration` — applied to confirm the deliverable
  precondition (shipment must be `delivered`) but no new Envia call
  is introduced; existing `track-shipments` is the `delivered`
  source.
- CodeGraph — used for the first call/data path reconstruction. No
  external network calls were made.

## Ready for Proposal

**Yes — proceed to `sdd-propose`.** The orchestrator should:

1. Surface the four unresolved product decisions above to the
   maintainer **before** writing the proposal so the proposal does not
   silently adopt defaults.
2. Confirm the change name `confirm-shipment` and the change folder
   (`openspec/changes/confirm-shipment/`) are the correct anchors.
3. Note: this exploration does NOT propose a milestone
   (`proposal.md`, `specs/`, `design.md`, `tasks.md`). Those are
   produced by the next SDD phase.

## Research lanes (offered, NOT run)

External doc lanes that may materially sharpen the proposal before
the `sdd-propose` phase, in priority order:

1. **Stripe Connect transfer + payout lifecycle for already-delivered
   shipments that the buyer never confirmed.** Confirm whether a
   shipment marked `completed` by buyer-confirm vs by an automatic
   cron produces any audit or reporting difference in
   Stripe Connect's reconciliation export. Helps decide whether to
   use `description` metadata to disambiguate.
   Sources: `docs.stripe.com/connect` `transfers`, `payouts`,
   `reconciliation` pages; `docs.stripe.com/api/transfer_group`.
2. **Envia `generaltrack` delivery event semantics for `delivered_at`.**
   Confirm whether Envia sends a single `delivered` event or multiple
   ones, and what the canonical `event_at` is for audit. Helps decide
   whether the buyer-confirm `delivered_at` should reuse the carrier
   timestamp or always use `now()`.
   Sources: `docs.envia.com` `generaltrack`, webhook signature
   pages; the local `supabase/functions/_shared/envia-tracking.ts`
   is the current adapter.

Both lanes are read-only and do not require API calls.
