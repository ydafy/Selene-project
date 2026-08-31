# Tasks: Shipment Tracking Foundation

## Review Workload Forecast

| Field                   | Value                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | 1,500–1,800                                                                                                       |
| Effective budget risk   | High                                                                                                              |
| Chained PRs recommended | Yes                                                                                                               |
| Suggested split         | Backend ledger + shared code → Webhook/polling reconciliation → Mobile timeline → Split-cadence controls/rollback |
| Delivery strategy       | auto-chain                                                                                                        |
| Chain strategy          | stacked-to-main                                                                                                   |

Decision needed before apply: No (resolved: stacked-to-main PR 1 targets main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

> Orchestrator budget = 1,200 lines. The forecast exceeds that budget, so the existing stacked-to-main delivery remains required.

### Suggested Work Units

| Unit | Goal                                                    | Likely PR | Focused test command                                                                 | Runtime harness                    | Rollback boundary                                                      |
| ---- | ------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------- |
| 1    | DB ledger, atomic RPC, normalizer, HMAC/replay verifier | PR 1      | `bun test supabase/functions/_shared/envia-tracking.test.ts`                         | Local `supabase start` + SQL apply | Migration + `supabase/functions/_shared/*`                             |
| 2    | Webhook receiver + polling reconciliation               | PR 2      | `bun test supabase/functions/envia-webhook/index.test.ts`                            | Local Edge Function invoke         | `envia-webhook/`, `track-shipments/index.ts`, `track-returns/index.ts` |
| 3    | Mobile timeline + mode-aware Envia link                 | PR 3      | `bun test apps/frontend/components/features/orders/ShipmentTrackingTimeline.test.ts` | Expo Go order detail screen        | Frontend hook/component/utils only                                     |
| 4    | Split-cadence polling controls and tested rollback      | PR 4      | `bun test supabase/functions/track-shipments/`                                       | Local Supabase + Envia stub        | `track-shipments/` and its `config.toml` entry                         |

## Phase 1: Foundation

- [x] 1.1 RED: Write failing tests for `supabase/migrations/20260828030000_shipment_tracking_foundation.sql` schema and `fn_record_tracking_event` behavior.
- [x] 1.2 GREEN: Create the migration (enum, `webhook_deliveries`, `shipment_tracking_events`, indexes, RLS, `fn_record_tracking_event`).
- [x] 1.3 RED: Add failing tests covering all 28 Envia status mappings and base URL resolution.
- [x] 1.4 GREEN: Create `supabase/functions/_shared/envia-tracking.ts` with `normalizeEnviaTrackingStatus` and `resolveEnviaTrackingUrl`.
- [x] 1.5 RED: Add failing tests for constant-time HMAC, malformed/missing headers, and 10/13-digit replay windows.
- [x] 1.6 GREEN: Create `supabase/functions/_shared/envia-webhook-verify.ts` with `verifyEnviaWebhook`.
- [x] 1.7 REFACTOR: Export `ShipmentTrackingEvent` alias from `packages/types/src/index.ts`; extract shared constants.

## Phase 2: Server Ingestion

- [ ] 2.1 RED: Write failing webhook handler tests for valid, invalid, duplicate, replay, and ambiguous-subject deliveries.
- [ ] 2.2 GREEN: Create `supabase/functions/envia-webhook/index.ts` and `handler.ts`, claim deliveries, and schedule `waitUntil` processing.
- [ ] 2.3 RED: Add failing reconciliation tests for `persistPollingResult` (backfill, no-op, return attribution).
- [ ] 2.4 GREEN: Modify `supabase/functions/track-shipments/index.ts` to use shared normalizer and call `fn_record_tracking_event`.
- [ ] 2.5 GREEN: Modify `supabase/functions/track-returns/index.ts` to attribute return events to `disputes` without mutating shipment status.
- [ ] 2.6 REFACTOR: Update `supabase/config.toml` to set `verify_jwt = false` for `envia-webhook`; Phase 5 extends custom authentication to `track-shipments`.

## Phase 3: Frontend Timeline

- [ ] 3.1 RED: Write failing tests for `useShipmentTrackingEvents` RLS query and ordering.
- [ ] 3.2 GREEN: Create `apps/frontend/core/hooks/useShipmentTrackingEvents.ts` keyed by `shipment_id`/`dispute_id`.
- [ ] 3.3 RED: Add failing tests for `ShipmentTrackingTimeline` loading, error, empty, and chronological rows.
- [ ] 3.4 GREEN: Create `apps/frontend/components/features/orders/ShipmentTrackingTimeline.tsx`.
- [ ] 3.5 GREEN: Create `apps/frontend/core/utils/envia-tracking.ts` and add translation keys to `core/i18n/locales/{en,es}/orders.json`.
- [ ] 3.6 GREEN: Wire timeline and mode-aware tracking link into `app/profile/orders/[id].tsx` and `OrderShipmentCard.tsx`.

## Phase 4: Verification & Deployment Handoff

- [ ] 4.1 RED→GREEN: Add integration tests for duplicate replay, concurrent claims, cancelled/custody race, monotonicity, and RLS.
- [ ] 4.2 Run focused suites, then `bun test`, `bun run lint`, and `tsc --noEmit` for affected workspaces.
- [x] 4.3 After maintainer confirms remote SQL applied, run `bun db:types` and verify generated types include new tables/RPC.
- [ ] 4.4 MAINTAINER HANDOFF: After Phase 5 passes, provide the migration and verified functions/config; document required secrets, separate sandbox/production `tracking.simple` webhooks, split Dashboard schedules, and signed-ingestion checks. Do not perform remote operations during apply.

## Phase 5: Split-Cadence Polling & Rollback

- [ ] 5.1 RED: Add failing tests for exact cron-secret authorization, invalid/missing lanes, `preparing` due at 5 minutes, `shipped` due at 15 minutes, stable ordering, and the 50-item lane bound.
- [ ] 5.2 RED: Add failing tests proving same-lane overlap returns `busy`, work stops before 90 seconds, retries remain idempotent, and provider failure does not advance `last_tracked_at`.
- [ ] 5.3 RED: Add rollback acceptance tests proving `TRACK_SHIPMENTS_POLLING_ENABLED=false` performs zero database/Envia calls and preserves ledger rows and tracking timestamps.
- [ ] 5.4 GREEN: Extract the dependency-injected lane handler and update `track-shipments/index.ts` with constant-time Bearer verification, fail-closed configuration, lane lock, deadline, and bounded dispatch.
- [ ] 5.5 GREEN: Update `supabase/config.toml` so `verify_jwt=false` applies to `envia-webhook` and custom-authenticated `track-shipments` only; never place a service-role JWT in cron configuration.
- [ ] 5.6 VERIFY: Run `bun test supabase/functions/track-shipments/`, the relevant tracking integration suites, `bun test`, `bun run lint`, and affected TypeScript checks; record rollback-test evidence.
- [ ] 5.7 HANDOFF ONLY: Document Vault/Edge secret parity, offset schedules (`*/5` and `2,17,32,47`), enablement, observability, and rollback order. Do not deploy, configure secrets/schedules, or perform remote verification during apply.
