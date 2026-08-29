# Proposal: Shipment Tracking Foundation

## Intent
Provide trustworthy, shipment-scoped carrier tracking: a normalized in-app timeline backed by an auditable event ledger, while retaining Envia's raw external detail. A shipment becomes `shipped` only after carrier custody is reported.

## Scope
### In Scope
- Signed Envia `tracking.simple` webhook ingestion, delivery deduplication, and polling reconciliation.
- Append-only tracking events, atomic monotonic shipment transitions, and return-event attribution.
- Chronological mobile timeline, tracking-link correction, and shared status normalization.
### Out of Scope
- Notification consumers, payments, labels, payouts, checkout, admin UI, and bundle design.
- Changing the 72-hour cancellation policy to query the new ledger.

## Capabilities
### New Capabilities
- `shipment-tracking`: Event-ledger, webhook, reconciliation, and buyer/seller timeline contract.
### Modified Capabilities
- `shipments`: Tracking lifecycle, RLS visibility, carrier-time semantics, and guarded status transitions.

## Approach
Use webhook-first ingestion with reconciliation. `envia-webhook` runs with `verify_jwt=false`, validates Envia HMAC and replay timestamps, records provider-generic `webhook_deliveries`, then writes `shipment_tracking_events`. A pure `_shared/envia-tracking.ts` normalizes Envia statuses for both webhook and polling paths. An atomic RPC locks the shipment and permits only monotonic transitions; it prevents a cancelled shipment from becoming shipped. Exceptions remain ledger-only. Events use carrier `event_at` for lifecycle timestamps and `received_at` for audit. Returns use the same ledger with nullable `dispute_id`. Dashboard-owned polling is 5 minutes for `preparing` and 15 minutes for `shipped`.

## Deployment Handoff
Maintainer: apply the migration, deploy `envia-webhook`, `track-shipments`, and `track-returns`; set `ENVIA_WEBHOOK_SECRET`; register separate HTTPS sandbox/production `tracking.simple` webhooks; configure Dashboard polling; then run `bun db:types` and verify generated types and signed delivery ingestion.

## Rollback Plan
Deactivate the Envia webhook, restore the prior polling functions and frontend release, and leave append-only records intact. Disable new cron behavior before reverting function versions; do not delete audit data.
