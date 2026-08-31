# Exploration: shipment-tracking-foundation

> **Scope.** READ-ONLY SDD exploration. No code, SQL, secrets, cron, webhook, or Dashboard changes. Artifact in English, neutral/professional. Subject to interactive single-PR default with 2000-line review budget.

---

## 1. Change context

This exploration is the upstream of the production-quality MVP++ shipment tracking module. The user is explicit on four constraints that define the target shape:

1. **Use existing labels/tracking** — Envia `tracking_number`, `envia_shipment_id`, `last_tracked_at` already exist on `shipments`. No new carrier.
2. **Internal UI = chronological normalized Selene timeline**. Raw Envia detail remains external (the buyer/seller clicks out to Envia via tracking ID / link).
3. **`shipped` only after a carrier event proves physical custody**. Label generation keeps `preparing`. `shipped` transition requires a canonical Envia carrier event (`Picked Up`, `In Transit`, `Out for Delivery`, or any status ≥ 2 in the catalog) — not a clock tick and not a webhook delivery alone.
4. **Future notifications react to normalized status changes** — out of scope for THIS change; downstream consumers MUST observe the new event log without us shipping the notifications consumer.

The 72-hour no-first-scan auto-cancel is **safety-critical**. This exploration audits the existing race surface using only on-disk evidence, not assumptions.

Artifact follows AGENTS.md hierarchy: repository facts (verified on disk) are separate from remote-deploy unknowns. Historical artifacts (notably the per-product foundation spec `post-purchase-label-generation-foundation`, its verify-report, and prior memory #1023 "Map Envia tracking foundation") are leads — not authoritative truth. The OpenSpec spec.md is authoritative for current product behavior, but parts of it are stale relative to the per-product model now in flight (see §2.1).

---

## 2. Current state (verified on disk)

### 2.1 Shipment model — per-product in flight, per-seller still live

- `shipments.spec.md` line 9 says "Each order can have N shipments (one per seller)". Line 298 says "One order → N shipments (one per purchased product/listing)". The spec is internally inconsistent.
- Per memory #855 (archived 2026-08-22, still pinned to the per-product model) and memory #862 (the per-product spec delta), the target model is **1 product = 1 shipment**. The per-product migration is in flight but **not yet deployed** (per the in-flight change folder `post-purchase-label-generation-foundation`). Pre-launch product → no deployed behavior is at risk, but the spec text on line 9 must be rewritten.
- For this exploration: the per-product model is the target. All findings below apply equally under per-seller or per-product because tracking is per-`shipment.id` either way.

### 2.2 Tracking columns — already on `shipments` (deployed hardening migration)

From `packages/types/src/database.types.ts` lines 1896-2013 (`shipments` Row shape, generated from `bun db:types` after the hardening migration was applied):

| Column | Type | Purpose |
|---|---|---|
| `tracking_number` | text nullable | Carrier tracking number, captured at label finalize |
| `label_url` | text nullable | PDF label URL |
| `carrier` | text nullable | Envia carrier name (e.g. `paquetexpress`) |
| `service` | text nullable | Envia service (e.g. `ground`) |
| `envia_shipment_id` | text nullable | Envia internal shipment id |
| `print_format` | text nullable | Envia print format |
| `print_size` | text nullable | Envia print size |
| `label_provider_cost_cents` | bigint nullable | Captured Envia cost (non-negative CHECK) |
| `label_generated_at` | timestamptz nullable | When the label was finalized |
| `shipped_at` | timestamptz nullable | Set when first carrier event is observed |
| `delivered_at` | timestamptz nullable | Set when Envia reports `delivered` |
| `last_tracked_at` | timestamptz nullable | Last polling check (independent of `updated_at`) |
| `label_generation_state` | text NOT NULL default `'unclaimed'` | Hardening state machine |
| `claim_token` | uuid nullable | Hardening claim token |
| `claim_expires_at` | timestamptz nullable | Hardening claim expiry |
| `label_quote_carrier`, `label_quote_service`, `label_quote_cost_cents`, `label_quote_input_hash`, `label_quote_rated_at`, `label_quote_reference` | mixed nullable | Hardening quote evidence |
| `shipping_cost` | numeric nullable | Per-shipment cost (per-product in the new model) |
| `shipping_evidence` | jsonb nullable | Anti-fraud packaging photos |
| `origin_address` | jsonb nullable | Snapshot, immutable after capture (BEFORE UPDATE trigger) |
| `origin_address_id` | uuid nullable | FK to `addresses` |
| `return_tracking_number`, `return_label_url` | text nullable | Return path (dispute-related) |
| `stripe_payment_intent_id`, `stripe_transfer_id`, `stripe_payout_id` | mixed nullable | Stripe settlement references |
| `status` | `order_status_enum` | `pending, paid, preparing, shipped, delivered, completed, cancelled, dispute, refunded` |

The hardening migration (`20260713210000_envia_shipping_label_hardening.sql`) and the post-purchase foundation migration (`20260824001426_post_purchase_label_generation_foundation.sql`) are on disk; per the maintainer's deploy workflow they require SQL apply → `bun db:types` → types verified. **Deployment state is unknown.** The current types DO include these columns, which means either: (a) migrations were applied and types regenerated, or (b) the types in repo reflect the intended target shape. Per AGENTS.md, the maintainer confirms apply.

### 2.3 `shipment_label_events` table — exists, append-only, RLS-locked

From `20260713210000_envia_shipping_label_hardening.sql` lines 69-81:

```sql
CREATE TABLE IF NOT EXISTS public.shipment_label_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('claimed','sent','rejected','orphaned','generated','reconciled')),
  actor_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    NOT metadata ?| ARRAY['name','phone','street','number','district','label_url','raw_provider_response','token','authorization']
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shipment_label_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shipment label events are append-only" ON public.shipment_label_events
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
```

This is the **label-generation audit log**, not a tracking history. `event_type` is constrained to label-lifecycle events. This table must NOT be repurposed for carrier tracking events (different semantics, different RLS policy needed).

### 2.4 `track-shipments` cron — polling-only, partial state coverage

`supabase/functions/track-shipments/index.ts` (186 lines):

- Fetches up to 50 shipments in `preparing` or `shipped` with non-null `tracking_number`, ordered by `last_tracked_at ASC NULLS FIRST` (lines 41-47).
- Deduplicates tracking numbers (line 70) and queries Envia `/ship/generaltrack/` with the full set (lines 73-81).
- Hardcoded local CARRIER_IN_TRANSIT_STATUSES set (lines 89-96):
  ```ts
  const CARRIER_IN_TRANSIT_STATUSES = new Set([
    'recibido en oficina', 'recolectado', 'en tránsito',
    'in-store pickup', 'in transit', 'picked up',
  ]);
  ```
  This is a partial subset of the canonical Envia 28-status catalog and is **not aligned** with the docs (`Out for Delivery`, `1/2/3 delivery attempts`, and several Spanish variants are missing). A `delivered` event flips status via `fn_mark_shipment_delivered`. An `in-transit` event flips `preparing → shipped` via direct `.update({ status: 'shipped', shipped_at: ... }).eq('id', shipment.id)` (lines 125-128) **with no status guard** — see §3.1.
- Final bulk `.update({ last_tracked_at: now }).in('id', processedIds)` (lines 159-163) — no `updated_at` bump.
- No idempotency tracking per Envia event. The cron is tolerant of duplicates by virtue of the FOR UPDATE locks in downstream RPCs (`fn_mark_shipment_delivered`, `fn_cancel_shipment`) and the `charge_already_refunded` handling on Stripe, but `last_tracked_at` advances even when nothing changed.
- No webhook receiver exists. There is no `supabase/functions/envia-webhook/` or equivalent. The Edge Function list (from `supabase/functions/` glob) contains: `auto-cancel-orders`, `auto-cancel-preparing`, `cancel-order`, `checkout-recovery-worker`, `connect-onboarding-return`, `create-connect-account`, `create-connect-payment`, `create-dispute`, `create-payment-intent`, `create-return-intent`, `delete-account`, `drain-legacy-wallets`, `generate-return-label`, `generate-shipping-label`, `get-connect-earnings`, `get-connect-payout-release-queue`, `get-seller-onboarding`, `get-shipping-quote`, `manage-payment-methods`, `reconcile-connect-payments`, `refresh-connect-account-status`, `release-connect-payout`, `release-funds`, `resolve-dispute`, `resolve-dispute-refund`, `return-delivery-timeout`, `rollback-connect-payment`, `stripe-webhooks`, `track-returns`, `track-shipments`. **No Envia webhook route.**

### 2.5 `track-returns` cron — symmetric shape for dispute returns

`supabase/functions/track-returns/index.ts` (151 lines) is the return-path counterpart: polls disputes with `return_tracking_number`, calls `fn_mark_return_delivered(p_dispute_id)` on `delivered`. Same Envia endpoint, same auth, same `ENVIA_MODE` switch. Worth mirroring its Edge Function structure for `envia-webhook` so production/sandbox parity is consistent.

### 2.6 Frontend stepper — static, 4 stages, no event history

`apps/frontend/components/features/orders/OrderStepper.tsx`:

- Hardcoded `STEPS = ['paid', 'preparing', 'shipped', 'delivered']` (line 15).
- Reads only `status` (single string) — no event log, no timestamps, no locations.
- `currentStepIndex` collapses everything outside the four states to `0` (line 26-27). Disputes, refunds, cancellations show the stepper "frozen" at `paid`.
- Animated circles + connector lines via `moti`. Visual is good; semantically the timeline is a coarse status indicator, not a tracking history.
- Used at `apps/frontend/app/profile/orders/[id].tsx` line 519-521: `<OrderStepper status={currentShipment?.status ?? order.visualStatus} />`.

### 2.7 Frontend tracking display — number + copy + external "Rastrear" link

`apps/frontend/app/profile/orders/[id].tsx` lines 529-573 (the "Slot D" tracking card):

- Shows `activeTrackingNumber` (current shipment's tracking_number, or dispute return tracking number).
- Copy button → `Clipboard.setString(tracking)` (line 555-562).
- "Rastrear" button → `Linking.openURL('${baseUrl}/rastreo?label=${tracking}&cntry_code=mx')` where `baseUrl` is hardcoded to `https://test.envia.com` in `__DEV__` and `https://api.envia.com` in production (line 242-250). **Hardcoded `https://api.envia.com`** is wrong for tracking; the right base for the public rastreo URL is `https://envia.com` (web) or `https://${enviaMode}.envia.com/rastreo?...`. **This is an existing bug** not in scope for this change but worth a side-note.

`apps/frontend/components/features/orders/OrderShipmentCard.tsx` lines 96-117 — compact card on the summary page renders `shipment.tracking_number` with a `t('actions.trackOrder')` label as text. No link, no detail. The summary card needs the same treatment as the detail card.

### 2.8 `EnrichedShipment.permissions` — no tracking-event field yet

`apps/frontend/core/hooks/useShipments.ts` lines 71-107: the permission set includes `showOriginalTracking` and `showReturnTracking` booleans but no `canShowTrackingHistory`, `latestEventAt`, or `eventCount`. Adding the event log will require either: (a) extending `useShipments` to join events server-side, or (b) adding a separate `useShipmentTrackingEvents(shipmentId)` hook. (a) keeps the existing screen lifecycle intact; (b) is more granular.

### 2.9 `EdgeFunctionRegistry` — no Envia webhook entry

`packages/types/src/index.ts` lines 140-261 contains the typed registry for `invokeEdge`. There is no `'envia-webhook'` key. Webhook endpoints are NOT invoked by `invokeEdge` — they are called by external servers (Envia) — so they typically don't appear in `EdgeFunctionRegistry`. But the type file SHOULD export a `WebhookEndpointRegistry` or similar so the cron-polling ingestion path can share types with the webhook ingestion path.

### 2.10 Status enum mismatch — `shipment_status_enum` ≠ Envia's 28-status catalog

- Selene enum (`order_status_enum`): `pending, paid, preparing, shipped, delivered, completed, cancelled, dispute, refunded`. 9 states.
- Envia v2 status IDs (per `https://docs.envia.com/reference/track-shipments.md`): `Created, Shipped, Delivered, Canceled, Information, N/A, Pending, Picked Up, Out for Delivery, Lost, Returned, Pickup at Office, Delivered at Origin, Damaged, Redirected, Out for Pickup, 1/2/3 delivery attempts, Return problem, Address error, Undeliverable, Delayed, Rejected, 1 pickup attempt, Partially Shipped, Partially Delivered, Delivery Attempt`. 28 statuses.
- The mapping is many-to-one into Selene's coarse enum. The Selene timeline MUST be the coarse enum (the user explicitly asked for "normalized Selene timeline") but the underlying tracking event log retains the Envia status verbatim plus location + timestamp + raw description.

### 2.11 Envia v2 webhook contract (per https://docs.envia.com/docs/webhooks.md and /reference/webhooks.md, verified live)

For `tracking.simple` (type_id=3, the recommended v2 replacement for type 1):

**Payload envelope**:
```json
{
  "type": "tracking.simple",
  "created_at": "2025-11-12T14:23:05.000Z",
  "data": {
    "shipment_id": 98765,
    "tracking_number": "1Z999AA10123456784",
    "carrier_name": "UPS",
    "status": "delivered",
    "status_description": "Package delivered to recipient",
    "location": "Mexico City, MX"
  }
}
```

**v2 HTTP headers (signed types only — types 3, 4, 5)**:

| Header | Description |
|---|---|
| `X-Webhook-Event` | Event type (e.g. `tracking.simple`) |
| `X-Webhook-Version` | API version date (e.g. `2025-09-01`) |
| `X-Webhook-Id` | **Unique delivery ID for deduplication** |
| `X-Webhook-Timestamp` | Unix timestamp in milliseconds |
| `X-Webhook-Signature` | HMAC-SHA256: `v1=HMAC(ts + "." + event + "." + body_json, secret)` |
| `Authorization` | Optional Bearer |

**Receiver requirements**:
- HTTPS, publicly reachable
- 2xx response within **5 seconds**
- Process async (do not block the response on DB writes or external API calls)
- Deduplicate by `X-Webhook-Id` (queued delivery with retries can repeat)
- Signature verification is REQUIRED when `X-Webhook-Signature` is present

**Production checklist (per docs)**:
- Endpoint publicly reachable via HTTPS
- Responds within 5s
- Processes payloads asynchronously
- Handles duplicate deliveries with idempotency
- Separate webhook URLs for sandbox vs production
- Logs all incoming events

**Test endpoint**: `POST /ship/webhooktest/` sends a sample payload to the registered URL **without HMAC headers** (intentional — the docs say to use a real signed event to verify signature logic).

**Important**: The `tracking.simple` payload contains only the LATEST status — no historical event array. To get the history we either (a) maintain our own append-only log of incoming webhook events, or (b) poll `/ship/generaltrack/` periodically to backfill. Option (a) is the user's chosen shape ("chronological normalized Selene timeline"). Option (b) is the safety net.

---

## 3. Causal impact map

### 3.1 72-hour no-first-scan auto-cancel — atomicity & race audit (EVIDENCE-BASED)

This is the safety-critical surface the user asked us to audit. Findings are constrained to what the code on disk actually does.

**Configuration & filter** (`auto-cancel-preparing/index.ts` lines 64-90):
- Reads `preparing_expiration_hours` from `system_settings` (default 72).
- Fetches rows with `.eq('status', 'preparing').lt('updated_at', expirationLimit).limit(50)`.
- **No generic `updated_at` trigger on `shipments`.** Verified via grep across `supabase/migrations/` — the only `BEFORE UPDATE ON public.shipments` trigger is `shipments_origin_snapshot_immutable` (`20260824020000_envia_address_origin_remediation.sql` line 22), which raises `ORIGIN_SNAPSHOT_IMMUTABLE` if origin_address changes. There is no `BEFORE UPDATE` trigger that bumps `updated_at`. Therefore the `track-shipments` cron, which updates `last_tracked_at` only (line 161), does **not** advance `updated_at`. **The 72h timer on `updated_at` is correct under current code.**

**Concurrent-run guard** (lines 44-62):
- The `auto_cancel_preparing_running` boolean lock prevents overlapping runs.
- `system_settings` is the lock store; same column used by `auto-cancel-orders`. The lock is released in finally blocks (lines 97-100, 374-377, 391-394).

**Per-row transaction** (lines 108-366):
- The Edge Function reads each shipment, fetches order_items + order + Stripe charge + refundable remainder, computes refund, calls `stripe.refunds.create` with idempotency key `auto_cancel_preparing_${shipment.id}`, then calls `fn_cancel_shipment(p_shipment_id, 'system', reason, p_cancellation_loss_cents)` via RPC.
- `stripe_already_refunded` is caught and logged (lines 300-313) — Stripe idempotency at the gateway layer.
- `fn_cancel_shipment` acquires `FOR UPDATE` on `shipments`, `orders`, and `wallets` (`fn_cancel_shipment.sql` lines 36, 69, 87). Strong serialized atomicity.
- `fn_cancel_shipment` only cancels if `v_status IN ('paid', 'preparing')` (line 48). If status already advanced to `shipped`/`delivered`/`completed`/`cancelled` between fetch and RPC, the RPC returns `CANNOT_CANCEL_IN_THIS_STATUS` — **idempotent refusal**.
- `fn_cancel_shipment` writes a `wallet_transactions` adjustment, releases products back to `VERIFIED`, fires `notifications`, and on `cancelled` the trigger `fn_shipments_status_trigger` re-derives `orders.status`.

**Stripe refund-before-DB mutation invariant** (Stripe `AGENTS.md` invariant: "Stripe refunds must succeed before the corresponding database cancellation is committed"): verified. `stripe.refunds.create` runs BEFORE `fn_cancel_shipment` RPC. If Stripe fails (non-`charge_already_refunded`), the row is skipped and DB stays untouched. If `fn_cancel_shipment` fails after Stripe succeeds, the code logs `CRITICAL Stripe refund OK pero DB cancel falló` (lines 339-347) and the row is preserved. This is the documented safety gate — the refund happened, the DB didn't get to cancel, and an admin must reconcile. **Acceptable** per AGENTS.md invariants.

**Cross-cron race** between `auto-cancel-preparing` and `track-shipments`:

| T | `auto-cancel-preparing` | `track-shipments` |
|---|---|---|
| T0 | Fetch `status='preparing', updated_at < cutoff` → row X | (idle) |
| T1 | Read `order_items`, `order` for row X | (idle) |
| T2 | Stripe refund for row X (idempotent) | Fetch `status IN ('preparing','shipped')` → row X |
| T3 | (idle) | Envia returns `delivered` for row X |
| T4 | `fn_cancel_shipment` FOR UPDATE on row X → lock acquired | (idle, awaits lock) |
| T5 | RPC: row X is `preparing` → cancel. `status='cancelled'`. Commit. | (idle, awaits lock release) |
| T6 | (returns to loop) | Acquires lock. `fn_mark_shipment_delivered` reads `status='cancelled'`. Branch `IF v_current_status NOT IN ('shipped','preparing')` → returns `INVALID_SHIPMENT_STATUS: cancelled`. Track log records ERROR. |

The symmetric case (track-wins-first) is also safe: track marks `delivered`, releases lock; auto-cancel-preparing later tries to cancel — `fn_cancel_shipment` sees `status='delivered'`, refuses with `CANNOT_CANCEL_IN_THIS_STATUS`.

**BUT** there is a third, more subtle race window that the current code does NOT handle:

| T | `auto-cancel-preparing` | `track-shipments` |
|---|---|---|
| T0 | Fetch row X (preparing, 72h cutoff reached) | (idle) |
| T1 | Read order, compute refund | Fetch row X |
| T2 | (about to call Stripe) | Envia returns `in transit` |
| T3 | (Stripe call) | Direct `.update({status:'shipped', shipped_at:now}).eq('id', X)` — **NO status guard** |
| T4 | Stripe refund succeeds | (loop continues) |
| T5 | `fn_cancel_shipment` FOR UPDATE on row X | (loop continues) |
| T6 | Lock acquired. Row X is now `shipped`. `IF v_status NOT IN ('paid','preparing')` → refuse. `CANNOT_CANCEL_IN_THIS_STATUS`. | (idle) |

This is **safe but suboptimal**: buyer loses the right to a free cancellation despite the carrier scan arriving only seconds after the 72h expiry. The cause is timing. Mitigations: (a) tighten the 72h cutoff by 5-15 minutes, (b) require `track-shipments` to use a conditional update `.update({...}).eq('id', X).eq('status','preparing')` so a `shipped` row is not overwritten (the bug fix), (c) add an Envia status-based override in `fn_cancel_shipment` that skips cancel if a `shipped` event is in the last N minutes. Option (b) is the minimum.

**The real bug to surface** (out of scope for this change but worth filing): `track-shipments` lines 125-128 lack a status guard. Under normal flow the FOR UPDATE serializes everything correctly so this is harmless, but a partial failure mode exists where a concurrent auto-cancel-preparing sets `status='cancelled'`, track-shipments then overwrites it back to `shipped`. The fix is `.update({...}).eq('id', X).eq('status','preparing')`. Recommend filing as a tracked micro-bug in this same change's PR description so the maintainer can decide whether to bundle or follow up.

**Tracking event delivery to `auto-cancel-preparing` cancellation window**: today the auto-cancel-preparing filter is `updated_at < 72h ago`. After this change introduces tracking events, the canonical source for "has a carrier scan happened yet?" is the new event ledger. We can either (a) keep the `updated_at` filter as-is and just rely on the bug fix, or (b) change the filter to `WHERE NOT EXISTS (SELECT 1 FROM shipment_tracking_events WHERE shipment_id = s.id AND event_type IN ('picked_up','in_transit','out_for_delivery')) AND updated_at < 72h`. (b) is more precise but introduces coupling between the cron and the event ledger. **Recommendation**: (a) for this change. (b) is a clean follow-up once the ledger has been in production long enough to trust the data.

### 3.2 What `shipped` should mean under the new contract

The user is explicit: `shipped` only after a carrier event proves physical custody. Mapping the 28-status Envia catalog to Selene's `shipped` transition:

| Envia status | Selene transition | Reason |
|---|---|---|
| `Picked Up` (8), `In Transit` (2 in catalog), `Out for Delivery` (9), `Out for Pickup` (16) | `preparing → shipped` | Physical custody confirmed |
| `Created` (1), `Pending` (7), `Information` (5), `N/A` (6) | no transition | Pre-handoff or carrier-side metadata |
| `Delivered` (3) | `→ delivered` | Terminal |
| `Lost` (10), `Damaged` (14), `Undeliverable` (22), `Address error` (21), `Rejected` (24), `Return problem` (20), `Delayed` (23), `1/2/3 delivery attempts` (17/18/19), `Delivery Attempt` (28) | no transition until dispute | Operational alert only (notifications are out of scope for this change) |
| `Returned` (11), `Delivered at Origin` (13), `Canceled` (4), `Redirected` (15), `Pickup at Office` (12), `1 pickup attempt` (25), `Partially Shipped` (26), `Partially Delivered` (27) | carrier-side disposition | out of scope; `shipments.status` stays `shipped` until buyer/seller action or 48h dispute window |

**Implementation**: a pure normalizer function in `_shared/envia-tracking.ts` that maps the 28-status catalog to `{ seleneTransition: 'preparing→shipped' | '→delivered' | null, canonicalEventType, rawDescription, location }`. Pure function, easily unit-testable, no DB or HTTP. This is the heart of the "normalized Selene timeline" the user asked for.

### 3.3 Webhook receiver — what we need vs what we have

What we have:
- `stripe-webhooks` Edge Function with a similar shape: signature verification (Stripe uses `stripe-signature`), idempotency table `checkout_recovery_shells` exists but is for Stripe only, service-role operations.
- `supabase/functions/stripe-webhooks/single-modal-settlement.ts` shows the existing pattern for resilient Edge Function ingestion.

What we need for `envia-webhook`:
- HMAC-SHA256 signature verification with `X-Webhook-Signature: v1=...` against the secret stored in Supabase secrets (e.g. `ENVIA_WEBHOOK_SECRET`).
- 5-second response SLA → respond 2xx first, then enqueue async processing.
- Deduplication table: `webhook_deliveries(provider, delivery_id UNIQUE, received_at, processed_at, response_code, error_message)`. Provider here = `envia`, delivery_id = `X-Webhook-Id`.
- Append-only tracking event log: `shipment_tracking_events(shipment_id, event_type, event_at, location, status_description, carrier_name, raw_status, webhook_id FK, polling_run_id nullable, received_at, created_at)`. `event_type` is the canonical Selene enum (e.g. `picked_up`, `in_transit`, `out_for_delivery`, `delivered`, `exception`, `returned_to_origin`).
- New RPC `fn_record_tracking_event(...)` that:
  - Validates the shipment exists and is in a trackable status (`preparing`, `shipped`).
  - Performs the canonical transition atomically (`preparing → shipped` only if the new event is a `picked_up`/`in_transit`/`out_for_delivery`; `→ delivered` only if `delivered`).
  - Appends to `shipment_tracking_events`.
  - Returns the new status.

**Critical**: the RPC must be **idempotent under the same Envia event_id** AND **monotonic** (never go backward). Both are SQL constraints: `UNIQUE(shipment_id, raw_status, event_at, location)` for dedup, plus the conditional updates with `WHERE status = 'preparing'`.

### 3.4 Frontend impact map

**Mobile (`apps/frontend`)**:
- `apps/frontend/components/features/orders/OrderStepper.tsx` — replaced/superseded by `ShipmentTrackingTimeline` for the chronological view. Keep `OrderStepper` for the coarse 4-stage indicator on `summary/[id]` if useful; new component on `[id]` Slot C.
- `apps/frontend/app/profile/orders/[id].tsx` Slot C (line 514-522) — swap `OrderStepper` for `ShipmentTrackingTimeline` reading from new `useShipmentTrackingEvents` hook.
- `apps/frontend/app/profile/orders/[id].tsx` Slot D (line 529-573) — keep the tracking number + copy + "Ver en Envia" button. The button's URL must come from `ENVIA_MODE` (currently hardcoded `__DEV__` test URL).
- `apps/frontend/app/profile/orders/summary/[id].tsx` line 96-117 (`OrderShipmentCard.tsx` line 96-117) — add the same tracking display row.
- `apps/frontend/core/hooks/useShipments.ts` line 22-118 (the `enrichShipment` function and the `RawShipment` type) — extend `EnrichedShipment` with `latestTrackingEvent?: ShipmentTrackingEvent` and `trackingEventCount: number`. Add `useShipmentTrackingEvents(shipmentId)` hook for the timeline component.
- `packages/types/src/index.ts` line 308-340 (`EnrichedShipment`) and the export of `ShipmentTrackingEvent` type.

**Admin (`apps/admin-web`)** — out of scope for this change. Admin can query `shipment_tracking_events` via SQL when needed; a dedicated admin UI is a follow-up.

### 3.5 OpenSpec impact map

- `openspec/specs/shipments/spec.md` — major rewrite. Lines 9 (per-seller claim) and 387-392 (track-shipments cron) need updates; add the webhook receiver, the event log table, the new RPC, the status normalizer, and the new "Shipment Tracking Lifecycle" requirement.
- `openspec/specs/notifications-list/spec.md` (if it exists in the new model) and related — out of scope; the change explicitly defers notification consumers to a follow-up that observes the event log.

### 3.6 What the previous audit (#1023) found

From memory #1023 (read-only discovery mapped Envia tracking docs and Selene's current polling-only tracking implementation):

- Envia v2 `tracking.simple` supports signed queued webhooks with retries and dedup.
- Selene lacks a webhook receiver and local delivery idempotency.
- Polling should remain as reconciliation.
- Remote deployment / configuration status is unknown.

This exploration reaffirms those findings and operationalizes them into the proposal approach below.

---

## 4. Preserve / Adapt / Replace / Unknown classification

| Surface | Classification | Evidence | Rationale |
|---|---|---|---|
| `shipments` tracking columns (`tracking_number`, `last_tracked_at`, `shipped_at`, `delivered_at`, `carrier`, `service`, `envia_shipment_id`) | **Preserve** | `database.types.ts` 1896-2013 | Already in the deployed schema. Reuse as authoritative state. |
| `shipments.status` enum | **Preserve** | `database.types.ts` 1929 | Canonical coarse enum. New normalizer maps Envia's 28 statuses into it. |
| `shipment_label_events` table | **Preserve** | `20260713210000_envia_shipping_label_hardening.sql` 69-81 | Label-generation audit log, separate concern. Do NOT repurpose. |
| `fn_mark_shipment_delivered` RPC | **Preserve** | `supabase/queries/shipments/fn_mark_shipment_delivered.sql` | Has `FOR UPDATE` and accepts `preparing` or `shipped`. Webhook receiver can call this for `delivered` events. |
| `fn_shipments_status_trigger` | **Preserve** | `supabase/queries/triggers/shipments/fn_shipments_status_trigger.sql` | Re-derives order status reactively. |
| `fn_cancel_shipment` RPC | **Preserve** | `supabase/queries/orders/fn_cancel_shipment.sql` | Strong FOR UPDATE locks. The 72h safety gate stays here. |
| `track-shipments` cron | **Adapt** | `supabase/functions/track-shipments/index.ts` | Keep as polling reconciliation. Tighten the `→ shipped` update with a status guard (bug fix). Align `CARRIER_IN_TRANSIT_STATUSES` with the canonical 28-status set via the new normalizer. Optionally ingest historical events from `/ship/generaltrack/` for backfill. |
| `track-returns` cron | **Preserve** | `supabase/functions/track-returns/index.ts` | Symmetric shape; mirror its Edge Function structure for `envia-webhook`. |
| `auto-cancel-preparing` cron | **Adapt (deferred)** | `supabase/functions/auto-cancel-preparing/index.ts` | The 72h filter stays. Option (b) — read `shipment_tracking_events` to know whether a scan happened — is a clean follow-up once the ledger is trusted. **Do NOT couple this change to the new ledger** — that's an over-reach for an MVP++ tracking foundation. |
| `auto-cancel-orders` cron | **Preserve** | `supabase/functions/auto-cancel-orders/index.ts` | Different timer (48h no-label) — orthogonal to tracking. |
| `OrderStepper` component | **Replace (per-screen)** | `apps/frontend/components/features/orders/OrderStepper.tsx` 15-150 | Slot C of `[id].tsx` is replaced by `ShipmentTrackingTimeline`. `OrderStepper` stays for the `summary/[id]` overview where a coarse 4-stage indicator is fine. |
| Tracking card on `[id].tsx` Slot D | **Adapt** | `[id].tsx` 529-573 | Keep shape. Fix the hardcoded `https://api.envia.com/rastreo?label=...` URL to be `ENVIA_MODE`-aware (sandbox: `https://test.envia.com/rastreo?label=...&cntry_code=mx`, production: `https://envia.com/rastreo?label=...&cntry_code=mx`). The raw Envia URL is acceptable here because the user's brief is explicit: "raw Envia detail remains external via tracking ID/link". |
| `OrderShipmentCard.tsx` tracking line | **Adapt** | `OrderShipmentCard.tsx` 96-117 | Wire the same tracking number + copy + Envia link as the detail screen. |
| `EnrichedShipment` (mobile type) | **Adapt** | `packages/types/src/index.ts` 308-340 | Add `latestTrackingEvent` + `trackingEventCount`. |
| `useShipments` hook | **Adapt** | `apps/frontend/core/hooks/useShipments.ts` 22-159 | Add `useShipmentTrackingEvents(shipmentId)` companion hook; keep existing `useShipmentsByOrder` shape. |
| `EdgeFunctionRegistry` | **Preserve (no entry needed)** | `packages/types/src/index.ts` 140-261 | Webhook endpoints are NOT invoked by `invokeEdge`. They are called by Envia. No client-side registry entry. |
| `system_settings.envia_*` columns + carrier/service/print config | **Preserve** | `20260713210000_envia_shipping_label_hardening.sql` 3-32 | Already restricts to Paquetexpress ground. Tracking is carrier-agnostic at the table level. |
| `get-shipping-quote` Edge Function | **Out of scope** | `supabase/functions/get-shipping-quote/index.ts` | Hardcoded origin/destination; not used by tracking. |
| `generate-return-label` | **Out of scope** | `supabase/functions/generate-return-label/index.ts` | Return path; `track-returns` already covers its tracking. |
| Envia sandbox vs production base URL | **Adapt** | `track-shipments/index.ts` 58-66 + `track-returns/index.ts` 58-66 + `[id].tsx` 242-250 | Three different paths hardcode Envia URLs. The new Edge Function + the frontend fix should centralize this in `_shared/envia-base-url.ts` or similar pure helper. (Lightweight, not over-engineering.) |
| Remote deployment state of the hardening migration | **Unknown** | uncommitted, AGENTS.md requires maintainer Dashboard evidence | Maintainer must apply SQL, set `system_settings.envia_*`, set 5 `ENVIA_*` secrets, deploy 3 Edge Functions. |
| `ENVIA_WEBHOOK_SECRET` (new) | **Unknown** | not yet a Supabase secret | Maintainer provisions at the same time as Envia webhook registration. |
| Envia webhook URL registration | **Unknown** | Dashboard-only via Envia Queries API (`POST https://queries.envia.com/webhooks`) | One-time setup. Sandbox and production require separate URLs and separate secrets. |
| Pre-launch test data | **Recommendation (not execution)** | per user decision | Maintainer authority. No reset needed for this change. |
| Notification consumers of the new event log | **Out of scope (deferred)** | per user brief | Future notification change subscribes to `shipment_tracking_events` and reacts to `event_type='delivered'` etc. |

---

## 5. Approaches compared

### Approach A — Polling-only with event history

Add `shipment_tracking_events` table. Update `track-shipments` cron to fetch history from `/ship/generaltrack/` and persist each event. Replace `OrderStepper` with `ShipmentTrackingTimeline`. No webhook receiver.

| Pros | Cons | Effort |
|---|---|---|
| Simplest. No HMAC, no Dashboard registration, no async pipeline. | Latency = poll interval (typically 5-15 minutes). `shipped` transition lags a real scan by up to one poll cycle. Misses intermediate events between polls. Higher Envia API usage (one call per cron cycle for every active shipment batch). | **Low** |

### Approach B — Webhook-first, no polling

Add `envia-webhook` Edge Function with HMAC verification and idempotency ledger. Add `shipment_tracking_events` table fed exclusively by the webhook. Frontend reads events from the table. Stop the `track-shipments` cron.

| Pros | Cons | Effort |
|---|---|---|
| Lowest latency (sub-second). Lowest Envia API usage. Clean separation. | Drops the reconciliation safety net. If a webhook is missed (Envia queue outage, our 5xx, network blip) we never recover that event. The user explicitly noted "no webhook receiver and local delivery idempotency" as a gap; removing polling removes the fallback. | **Medium** |

### Approach C — Webhook-first with polling reconciliation (RECOMMENDED)

Build the webhook receiver. Add the event ledger. Keep `track-shipments` cron as a periodic reconciliation pass that:
- Fetches the latest status + history from `/ship/generaltrack/` for shipments that are `preparing`/`shipped` AND whose `last_tracked_at` is older than N minutes (configurable; default 30 min).
- Persists any events not already in the ledger (deduped by Envia event_id / `(shipment_id, raw_status, event_at)` tuple).
- Tightens the `→ shipped` update with a status guard.
- Aligns the in-transit status set with the new normalizer.

Webhook receiver handles `preparing → shipped` and `→ delivered` transitions on arrival (low latency). Polling handles missed events and full history backfill.

| Pros | Cons | Effort |
|---|---|---|
| Low latency for the two Selene transitions that matter. Reconciliation guarantees history completeness regardless of webhook reliability. Two ingestion paths share the same append-only ledger with dedup, so the data model is clean. Envia's own docs recommend webhooks over polling — this matches their guidance. | Two ingestion paths to maintain. Slightly more code than A or B alone. The polling cron needs to be careful not to double-process events the webhook already wrote. | **Medium-High** |

**Effort rating rationale**:
- A: 1 SQL migration + 1 cron update + 1 new frontend component + 1 hook + type updates + spec rewrite.
- B: 1 SQL migration + 1 new Edge Function + 1 cron deletion + 1 new frontend component + 1 hook + type updates + spec rewrite + Envia Dashboard registration.
- C: same surface as B + keep polling cron with dedup + bug fix on status guard + spec rewrite.

### Recommendation: **Approach C**

Reasons:
1. The user is explicit that `shipped` must follow a real carrier scan event with low latency. Polling-only (A) introduces minutes of latency between scan and Selene state transition. Webhook (B or C) brings it to seconds.
2. The user is also explicit that the timeline should be **chronological and normalized**. Webhook payloads in v2 carry only the LATEST status, not the history array — so the polling cron is needed to backfill intermediate events that arrived between webhook deliveries. C gets both.
3. C aligns with Envia's published guidance ("For automated status updates, consider using webhooks instead of polling this endpoint" — https://docs.envia.com/reference/track-shipments.md).
4. C is the smallest module that meets the brief without over-engineering: one append-only ledger, two ingestion paths writing into it with dedup, one RPC for atomic transition, one frontend component, one Edge Function for the webhook, no queues, no external scheduler.
5. B's failure mode (a single missed webhook = permanent lost event) is unacceptable for a marketplace surface. The Envia docs themselves flag deduplication as required for v2 webhooks because the queue retries — but they don't promise that EVERY transition arrives via webhook. Polling is the safety net.

---

## 6. Open product decisions (require user input before proposal)

1. **Webhook receiver hosting location**: Supabase Edge Function (`supabase/functions/envia-webhook/index.ts`) is the obvious fit (matches Stripe webhooks). Confirm. **Recommendation: yes, Supabase Edge Function.** The function will be marked `verify_jwt = false` in `config.toml` because Envia does not send a Supabase JWT — signature verification replaces JWT.

2. **Idempotency ledger table name**: `webhook_deliveries(provider, delivery_id, ...)` — provider-agnostic so future webhook sources (other carriers, Stripe Connect, etc.) reuse it. Or `envia_webhook_deliveries` — narrower scope. **Recommendation: `webhook_deliveries` with a `provider` discriminator**. Low cost, future-proof.

3. **Tracking event table name**: `shipment_tracking_events` — symmetric with `shipment_label_events`. **Recommendation: yes**.

4. **Status normalizer location**: `_shared/envia-tracking.ts` with a pure `mapEnviaStatusToCanonical(enStatus: string): { eventType, transition }` function. **Recommendation: yes**. Pure, unit-testable, reusable by both webhook and polling paths.

5. **Polling cadence**: `track-shipments` currently has no enforced cadence in repo (cron schedule is in Supabase Dashboard pg_cron). For the reconciliation pass, the new cadence should be aligned with the user's "shipped only after carrier event" contract. Recommend: poll every 5 minutes for `preparing` rows, every 15 minutes for `shipped` rows. Webhook handles the immediate transition; polling backfills intermediate events. **Decision**: maintainer-controlled via Dashboard; document the recommendation in the spec.

6. **`shipped_at` semantics**: today it captures the timestamp of the first carrier scan, regardless of clock skew. Webhook `created_at` is the Envia-recorded event time; polling `created_at` from Envia is the same. Should we always store the Envia-reported `event_at` as `shipped_at`, or use `received_at` (our clock) for safety? **Recommendation: store `event_at` as `shipped_at`/`delivered_at` because that's the carrier-authoritative time**; display `received_at` separately as "Last webhook received". This matters for the 48h dispute window which counts from `delivered_at`.

7. **Tracking events for returns**: returns are tracked by `track-returns` polling `disputes.return_tracking_number`. Should the new ledger ALSO accept return tracking events from the same webhook? **Recommendation: yes, the same webhook receiver handles both**, distinguished by `tracking_number` lookup against either `shipments.tracking_number` or `disputes.return_tracking_number`. Single ingestion path, single ledger, single RPC contract. `shipment_tracking_events` gets a nullable `dispute_id` column to attribute return events. This is a clean design but slightly larger scope; if the user prefers to keep returns on the existing `track-returns` cron only, we drop the dispute column.

8. **`supabase/config.toml` change**: add `[functions.envia-webhook]\nverify_jwt = false` next to the existing `connect-onboarding-return` block. **Recommendation: yes, in the same change**.

9. **Frontend raw Envia URL**: `https://api.envia.com/rastreo?label=...&cntry_code=mx` (currently used in production per `[id].tsx` line 244-245) is wrong — `api.envia.com` is the API host, not the public rastreo page. The correct URL is `https://envia.com/rastreo?label=...&cntry_code=mx` for production and `https://test.envia.com/rastreo?label=...&cntry_code=mx` for sandbox (matching what the file already does in `__DEV__`). Should this URL fix be bundled with the tracking change or filed separately? **Recommendation: bundle**. It's a 2-line fix in the same `[id].tsx` slot we're touching for the timeline.

10. **Shipment status enum vs Envia exception events**: Envia can fire `Lost`/`Damaged`/`Address error` etc. The user's brief defers notifications to a follow-up. Today's `shipments.status` enum does NOT have a separate `exception` state. Should the new event log include exception events without changing `shipments.status`, or should we add a column `has_carrier_exception` for the admin/notification follow-up to observe? **Recommendation: include exception events in the ledger with `event_type='exception'`, do NOT change `shipments.status`**. The future notification consumer reads from the ledger. Cleanest separation.

---

## 7. Scope boundary (proposed for the proposal phase)

### In scope
- SQL migration adding:
  - `webhook_deliveries(provider, delivery_id, received_at, processed_at, response_code, error_message)` with `UNIQUE(provider, delivery_id)`, RLS-locked.
  - `shipment_tracking_events(id, shipment_id FK, event_type, event_at, location, status_description, carrier_name, raw_status, dispute_id nullable FK, webhook_id nullable FK webhook_deliveries.id, polling_run_id nullable, received_at, created_at)` with RLS for buyer/seller/admin reads (mirror existing `shipments` RLS pattern), append-only policy.
  - New enum `shipment_tracking_event_type` with the canonical Selene event types.
  - `fn_record_tracking_event(p_shipment_id, p_event_type, p_event_at, p_location, p_raw_status, p_carrier_name, p_status_description, p_dispute_id, p_webhook_id, p_polling_run_id)` RPC with `FOR UPDATE` on the shipment, conditional status transition, append to event log, return new status.
  - Optional `fn_record_return_tracking_event(p_dispute_id, ...)` RPC for return events (if user picks option 7 with dispute column).
  - Required indexes on `(shipment_id, event_at DESC)` and `(dispute_id, event_at DESC)` for chronological reads.
- New Edge Function `envia-webhook`:
  - HMAC-SHA256 verification using `ENVIA_WEBHOOK_SECRET` against `X-Webhook-Signature` header, computed over `${timestamp}.${event}.${rawBody}`.
  - 5-second response SLA: respond 2xx immediately after dedup ledger write, then `EdgeRuntime.waitUntil(...)` to enqueue DB writes (or accept that the dedup ledger write is fast enough — typical Deno fetch+text+insert is <300ms).
  - `verify_jwt = false` in `supabase/config.toml`.
  - Idempotency via `webhook_deliveries` UNIQUE constraint; duplicate `X-Webhook-Id` returns 200 with `{deduplicated: true}`.
  - Maps Envia v2 `tracking.simple` payload → `fn_record_tracking_event`.
- Polling cron update (`track-shipments`):
  - Replace `CARRIER_IN_TRANSIT_STATUSES` set with the canonical 28-status catalog (via the shared normalizer).
  - Tighten `→ shipped` update with `.eq('status', 'preparing')` guard (the bug fix).
  - Persist each event from `/ship/generaltrack/` into `shipment_tracking_events` (with `polling_run_id` = nanoid or current ISO timestamp per run) for full history backfill.
  - Increase `BATCH_SIZE` if needed; document the cadence recommendation.
- Polling cron update (`track-returns`): same shape, writing to `shipment_tracking_events` with `dispute_id` set.
- `_shared/envia-tracking.ts`: pure normalizer `mapEnviaStatusToCanonical(enStatus, description?)` returning `{ eventType, transition: 'shipped' | 'delivered' | null, isException }`. Plus the Envia base URL helper `resolveEnviaRastreoBaseUrl(mode: 'sandbox'|'production')`.
- `_shared/envia-webhook-verify.ts`: pure HMAC verification helper, unit-testable.
- Frontend:
  - New `apps/frontend/components/features/orders/ShipmentTrackingTimeline.tsx` — chronological list of events with timestamp, location, status description, mapped to Selene canonical types.
  - New `apps/frontend/core/hooks/useShipmentTrackingEvents.ts` — TanStack Query hook.
  - `[id].tsx` Slot C swap to timeline. Slot D URL fix (`ENVIA_MODE`-aware).
  - `OrderShipmentCard.tsx` tracking line wired to the same display + link.
  - `EnrichedShipment` extension (`latestTrackingEvent`, `trackingEventCount`).
  - i18n keys for new event labels (`tracking.events.picked_up`, `tracking.events.in_transit`, etc.).
- `EdgeFunctionRegistry`: NO new entry (webhooks are not invoked by clients). Add a typed `WebhookEventType` export for the cron path.
- Tests (TDD per repo convention):
  - `_shared/envia-tracking.test.ts` — full 28-status catalog mapping.
  - `_shared/envia-webhook-verify.test.ts` — HMAC sign/verify round-trip with known fixtures.
  - `envia-webhook/index.test.ts` — payload parsing, dedup, signature failure, sandbox/production base URL, 5s response timing.
  - `fn_record_tracking_event` SQL tests — monotonic transition guards, dedup, invalid status.
  - Polling cron test: dedup behavior (webhook wrote event X, polling sees event X again, no duplicate row).
- OpenSpec:
  - Rewrite `shipments/spec.md` to drop the per-seller claim on line 9, add a "Shipment Tracking Lifecycle" requirement with the new contract.
  - Add a new spec `shipment-tracking/spec.md` for the event log + webhook contract (or include in the shipments spec).

### Out of scope (separate proposals)
- Notification consumers of `shipment_tracking_events`. The user explicitly deferred this.
- Bundle / parcel grouping seam (documented in prior per-product spec).
- `label_provider_cost_cents` → payout view wiring.
- `get-shipping-quote` hardcoded Envia config.
- `generate-return-label` hardcoded Envia config.
- Future physical bundle design.
- The 72h race (option b: `NOT EXISTS tracking_event ...` filter for auto-cancel-preparing) — defer until the ledger has production data.

---

## 8. Risks

### 8.1 Safety-critical (72h auto-cancel)

- **No code change to the 72h timer is needed in this PR** because the existing `updated_at` filter is correct under the current code (verified — no generic `updated_at` trigger on `shipments`; polling bumps `last_tracked_at` only).
- **Bundled bug fix**: `track-shipments` lines 125-128 need `.eq('status','preparing')` guard. Without it, a cancelled shipment could be re-marked `shipped` by a race. Recommend filing in the PR description as either bundle-with-this-change or follow-up micro-PR.
- **Webhook receiver lock semantics**: `fn_record_tracking_event` MUST take `FOR UPDATE` on the shipment row to serialize against `fn_cancel_shipment`. Same pattern as `fn_mark_shipment_delivered`. The proposal MUST include this lock.
- **Stripe refund-before-DB invariant**: this change does NOT introduce any Stripe mutation on the tracking path. Tracking state changes are DB-only. Safe.

### 8.2 Webhook receiver safety

- **HMAC secret leak**: `ENVIA_WEBHOOK_SECRET` is a Supabase secret, server-only. The receiver MUST log only the signature outcome (`valid`/`invalid`/`missing`) and the `X-Webhook-Id`, never the secret or the raw payload bytes.
- **5-second SLA**: must respond 2xx immediately. The dedup ledger insert (`webhook_deliveries`) is the only synchronous DB write; the `fn_record_tracking_event` call can run synchronously because it is also fast (~10-20ms), but verify with load testing in the proposal.
- **Replay attacks**: HMAC includes the timestamp; receiver MUST reject events with `X-Webhook-Timestamp` older than 5 minutes (replay window).
- **Sandbox vs production confusion**: a single receiver MUST distinguish via the registered webhook URL (Envia gives different URLs for sandbox vs production). The receiver reads `ENVIA_MODE` to decide the dedup ledger provider key suffix, or simply keys dedup by `(provider, delivery_id)` and treats sandbox as a separate provider. **Recommendation: provider = `envia_sandbox` or `envia_production`, set at deploy time.**
- **Envia Dashboard registration requires maintainer action**: this is a real operational risk — if the webhook URL is not registered, the change silently does nothing. Proposal MUST include a maintainer deployment checklist.

### 8.3 Data integrity

- **Event log monotonicity**: `shipments.status` MUST NOT regress. `preparing → shipped → delivered` only. `fn_record_tracking_event` MUST refuse any event that would regress. The conditional updates with status guards plus `FOR UPDATE` achieve this.
- **Dedup**: `webhook_deliveries` UNIQUE on `(provider, delivery_id)`. Polling run dedup via `(shipment_id, raw_status, event_at)` UNIQUE.
- **Time skew**: `event_at` is the Envia-reported time. UI displays `received_at` (our clock) as a separate "Last webhook received" indicator for transparency.

### 8.4 Frontend UX

- **Reverse chronological vs chronological**: user said "chronological normalized Selene timeline" — that means oldest → newest, top → bottom. Standard. Confirm in the spec.
- **Mobile timeline performance**: `FlashList` (per `vercel-react-native-skills/list-performance-virtualize`) for the event list. Reanimated `entering`/`exiting` animations for new events.
- **Empty state**: a shipment in `paid` or `preparing` without any tracking events yet shows a placeholder ("Esperando primer escaneo del carrier") rather than an empty list.

### 8.5 Deployment risks

- **Migration order**: if `shipment_tracking_events` is created BEFORE `fn_record_tracking_event`, the RPC will not compile. Standard SQL migration ordering handles this.
- **`bun db:types`**: maintainer must regenerate types after the migration is applied. AGENTS.md invariant.
- **Edge Function deploy order**: `envia-webhook` MUST deploy before Envia Dashboard webhook registration, otherwise the registration will fail with a connection error. Proposal must spell out this order.
- **Test webhook endpoint**: `POST /ship/webhooktest/` does NOT include HMAC headers. The receiver MUST handle a request without `X-Webhook-Signature` gracefully (reject as `SIGNATURE_REQUIRED`).

---

## 9. Verdict

**Ready for proposal: Yes**, contingent on the user answering the 10 open product decisions in §6 and the maintainer confirming the items in §8.5.

The user constraint set is internally consistent: chronological normalized timeline + raw Envia external + low-latency `shipped` + multi-seller boundaries + 72h safety. Approach C (webhook-first with polling reconciliation) is the only design that meets all of those without overengineering.

**OpenSpec spec.md rewrite is mandatory** — the existing line 9 is stale ("one per seller") relative to the per-product model now in flight. The new tracking contract MUST be reflected there.

The 72h race audit found **no actual safety bug under current code**, but did surface one latent bug in `track-shipments` (unguarded status update) that should be fixed in the same change or as an immediate follow-up micro-PR. The change itself does NOT need to alter the auto-cancel-preparing timer — the existing `updated_at` filter is correct under verified on-disk behavior.

---

## 10. Source of truth references

- Memory #1023 (Map Envia tracking foundation) — confirmed baseline.
- Memory #855 (post-purchase-label-generation-foundation/explore REPLACES prior) — per-product model context.
- Memory #862 (post-purchase-label-generation-foundation/spec) — per-product model delta.
- `openspec/specs/shipments/spec.md` — current contract (stale on line 9; authoritative elsewhere).
- `supabase/migrations/20260713210000_envia_shipping_label_hardening.sql` — label hardening migration.
- `supabase/migrations/20260824020000_envia_address_origin_remediation.sql` — origin snapshot trigger (only `BEFORE UPDATE` trigger on `shipments`).
- `supabase/functions/track-shipments/index.ts` — current polling cron.
- `supabase/functions/track-returns/index.ts` — symmetric return cron (template for `envia-webhook` structure).
- `supabase/functions/auto-cancel-preparing/index.ts` — 72h safety gate.
- `supabase/queries/orders/fn_cancel_shipment.sql` — cancel RPC with FOR UPDATE locks.
- `supabase/queries/shipments/fn_mark_shipment_delivered.sql` — delivered RPC with FOR UPDATE.
- `supabase/queries/triggers/shipments/fn_shipments_status_trigger.sql` — order status re-derivation.
- `packages/types/src/database.types.ts` lines 1896-2013 — `shipments` table shape (post-hardening).
- `apps/frontend/components/features/orders/OrderStepper.tsx` — current static stepper.
- `apps/frontend/app/profile/orders/[id].tsx` lines 514-573 — Slot C + D (timeline + tracking number card).
- `apps/frontend/core/hooks/useShipments.ts` lines 22-118 — `enrichShipment` permissions.
- `packages/types/src/index.ts` lines 140-261 + 308-340 — `EdgeFunctionRegistry` + `EnrichedShipment`.

## 11. Envia docs consulted (verified live 2026-08-27)

- https://docs.envia.com/llms.txt — index
- https://docs.envia.com/docs/webhooks.md — Webhooks Guide
- https://docs.envia.com/reference/webhooks.md — Webhooks API reference (type_id table, comparison matrix)
- https://docs.envia.com/reference/track-shipments.md — `/ship/generaltrack/` endpoint + 28-status catalog
- https://docs.envia.com/reference/all-webhooks.md — webhook listing endpoint
