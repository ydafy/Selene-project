# Design: Shipment Tracking Foundation

## Technical Approach
Implement webhook-first ingestion with polling reconciliation. Envia `tracking.simple` is authenticated and claimed before acknowledgement; both paths share pure normalization and transactional persistence. Postgres owns deduplication, monotonic status, return attribution, and RLS; mobile reads oldest-first through TanStack Query.

## Architecture Decisions
| Option | Decision |
|---|---|
| Webhook only / polling only / both | Webhook-first plus 5-minute `preparing` and 15-minute `shipped` Dashboard reconciliation |
| Direct updates / transactional RPC | Service-role-only `fn_record_tracking_event`; lock shipment `FOR UPDATE`, append idempotently, allow only `preparing→shipped→delivered`; cancelled events remain ledger-only |
| Raw payload / normalized ledger | Provider-generic delivery ledger plus append-only normalized events; no raw payload or secret logging |
| JWT role / database role | RLS projects buyer/seller ownership and admin role from `profiles_private.role` |

## Data Flow
```text
Envia POST → raw-body HMAC + ±5m replay check → claim (provider, delivery_id)
  new → 200 {received:true,deduplicated:false} → waitUntil(normalize → atomic RPC)
  duplicate → 200 {received:true,deduplicated:true} → stop without processing
Envia API → track-shipments / track-returns → persistPollingResult(events, polledAt)
Mobile → RLS SELECT → event_at, received_at, id ASC → timeline
```

`webhook_deliveries` is unique on `(provider, delivery_id)`. `shipment_tracking_events` is unique-null-safe on `(shipment_id, dispute_id, raw_status, event_at, location)`. Tables expose no client mutation. The RPC is `SECURITY DEFINER`, fixed `search_path`, revoked from `PUBLIC/anon/authenticated`, and granted only to `service_role`.

## Migration / Rollout
Maintainer applies the SQL file first, then runs `bun db:types` and verifies generated rows. Deploy `envia-webhook`, `track-shipments`, and `track-returns`; set `ENVIA_WEBHOOK_SECRET` and existing Envia URL/key secrets; register separate sandbox/production type-3 webhooks; configure 5/15-minute schedules; verify signed ingestion, duplicate replay, RLS, and reconciliation.
