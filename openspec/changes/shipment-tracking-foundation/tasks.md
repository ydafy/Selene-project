# Tasks: Shipment Tracking Foundation

## Review Workload Forecast
| Field | Value |
|---|---|
| Estimated changed lines | 1,500–1,800 |
| Effective budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | Backend ledger + shared code → Webhook/polling reconciliation → Mobile timeline |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

## Phase 1: Foundation
- [x] 1.1 RED: Write failing tests for `supabase/migrations/20260828030000_shipment_tracking_foundation.sql` schema and `fn_record_tracking_event` behavior.
- [x] 1.2 GREEN: Create the migration (enum, `webhook_deliveries`, `shipment_tracking_events`, indexes, RLS, `fn_record_tracking_event`).
- [x] 1.3 RED: Add failing tests covering all 28 Envia status mappings and base URL resolution.
- [x] 1.4 GREEN: Create `supabase/functions/_shared/envia-tracking.ts` with `normalizeEnviaTrackingStatus` and `resolveEnviaTrackingUrl`.
- [x] 1.5 RED: Add failing tests for constant-time HMAC, malformed/missing headers, and 10/13-digit replay windows.
- [x] 1.6 GREEN: Create `supabase/functions/_shared/envia-webhook-verify.ts` with `verifyEnviaWebhook`.
- [x] 1.7 REFACTOR: Export `ShipmentTrackingEvent` alias from `packages/types/src/index.ts`; extract shared constants.

## Phase 2: Server Ingestion
- [ ] Webhook receiver, polling reconciliation, shared normalization, RPC writes, and `verify_jwt = false` only for `envia-webhook`.
## Phase 3: Frontend Timeline
- [ ] RLS query, timeline UI, translated labels, mode-aware Envia link, and order integration.
## Phase 4: Verification & Deployment Handoff
- [ ] Integration tests and focused suites.
- [x] Generated types verified after maintainer-confirmed remote SQL application.
- [ ] Deploy `envia-webhook`, `track-shipments`, and `track-returns`; configure secret, webhooks, and schedules.
