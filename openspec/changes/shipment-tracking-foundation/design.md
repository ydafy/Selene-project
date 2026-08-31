# Design: Shipment Tracking Foundation

## Technical Approach

Keep webhook-first ingestion with polling reconciliation, then add a Phase 5 operational control layer to `track-shipments`. Two authenticated Dashboard schedules invoke explicit `preparing` and `shipped` lanes. Each lane selects only due rows, processes at most 50 tracking numbers, writes through the existing idempotent event RPC, rejects overlapping lane runs, and stops before a 90-second deadline. Envia batch tracking remains `/ship/generaltrack/` as documented at `https://docs.envia.com/reference/track-shipments.md`.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| One mixed schedule / two lanes | Two jobs add configuration but preserve distinct service levels | Use `preparing` every 5 minutes and `shipped` every 15 minutes |
| Concurrent runs / lane lease | A lease may skip a tick but prevents duplicate pressure | Acquire a per-lane database advisory lock; a busy lane returns a successful skip |
| Gateway JWT / dedicated cron secret | Custom auth requires explicit verification but avoids putting a service-role JWT in scheduler configuration | Set `verify_jwt=false` for `track-shipments`; retrieve `TRACK_SHIPMENTS_CRON_SECRET` from Vault for the request and compare its Bearer value in constant time before side effects |
| Immediate rollback / tested kill switch | A default-off switch adds one branch but makes rollback observable | Require `TRACK_SHIPMENTS_POLLING_ENABLED=true`; false returns a fixed skip response without DB or Envia calls |

## Data Flow

```text
Dashboard Cron (Vault Bearer + lane) → auth → enabled check → lane lock
  → due shipments (limit 50) → Envia batch → idempotent RPC → timestamp update
  → release lock / stop before 90s
```

`preparing` is due after 5 minutes; `shipped` is due after 15 minutes. Stable ordering is `last_tracked_at NULLS FIRST, id`; empty Envia histories still advance `last_tracked_at` after a successful fetch. Webhook and polling collisions remain safe through the ledger uniqueness contract.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/functions/track-shipments/index.ts` | Modify | Parse lane, authenticate cron, enforce switch/deadline/lock, and dispatch bounded polling |
| `supabase/functions/track-shipments/handler.ts` | Create | Dependency-injected lane orchestration and rollback-safe skip behavior |
| `supabase/functions/track-shipments/index.test.ts`, `handler.test.ts` | Create | RED-first auth, cadence selection, lock, deadline, idempotency, and rollback evidence |
| `supabase/config.toml` | Modify | Disable gateway JWT for `envia-webhook` and custom-authenticated `track-shipments` only |
| `openspec/changes/shipment-tracking-foundation/tasks.md` | Modify | Add Phase 5 implementation and verification work |
| `openspec/changes/shipment-tracking-foundation/deployment-handoff.md` | Modify | Record approved cadence, secure invocation, rollback evidence, and manual-only deployment |

## Interfaces / Contracts

`POST /functions/v1/track-shipments` accepts `{ "lane": "preparing" | "shipped" }` and exact `Authorization: Bearer <TRACK_SHIPMENTS_CRON_SECRET>`. Missing configuration or mismatched credentials returns 401 before side effects. Disabled or busy lanes return `200 { "processed": 0, "skipped": true, "reason": "disabled" | "busy" }`. Successful responses identify the lane and counts; secrets and request authorization are never logged.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Exact auth, lane validation, 5/15-minute due filters, 50-item bound, 90-second stop | Dependency-injected Bun tests with a fake clock |
| Integration | Same-lane exclusion, webhook/poll collision, no-event timestamp, idempotent retry | Local Supabase plus Envia stub |
| Rollback | Disabled mode performs zero DB/Envia calls and preserves ledger/timestamps | RED-first rollback test plus recorded before/after assertions |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Cron-to-function process integration | Applicable | Invalid secret/lane fails before side effects; overlap skips; deadline exits cleanly | Auth, lane, lock, and deadline tests above |
| Envia process integration | Applicable | Provider failure records no false success or timestamp | Envia failure and retry tests |
| Routing, shell, VCS/PR, executable classification | N/A — unchanged | None | None |

## Migration / Rollout

No data migration is added. This corrective rerun performs no remote action. A maintainer later deploys the verified function/config, creates the Vault and Edge secret values, and adds offset schedules: `preparing` at `*/5 * * * *`; `shipped` at `2,17,32,47 * * * *`.

Rollback acceptance is mandatory before enablement: with polling disabled, both lane tests must prove zero DB/Envia calls and unchanged ledger/timestamps; then the local drill must remove both schedules, restore the prior function fixture, and retain all audit rows. Production rollback follows the same order: disable switch, remove schedules, restore prior function; never drop ledger data.

## Open Questions

None — split cadence and invocation convention are approved.
