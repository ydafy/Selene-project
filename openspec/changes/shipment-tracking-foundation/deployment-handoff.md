# Deployment Handoff: Shipment Tracking Foundation

## Status

The split cadence is approved: `preparing` every 5 minutes and `shipped` every 15 minutes. It is not an open design blocker. Phase 5 implementation and verification remain pending, so this document is a maintainer handoff, not evidence of deployment or production readiness.

No remote SQL, Edge Function deployment, secret change, webhook registration, cron configuration, staging, commit, or push is performed by this corrective rerun.

## Required Order

1. Complete and verify every Phase 5 task locally, including rollback acceptance.
2. Confirm the existing tracking migration is present remotely; do not reapply it blindly.
3. Deploy verified `envia-webhook`, `track-shipments`, and `track-returns` versions, plus the reviewed `supabase/config.toml` flags.
4. Set `ENVIA_WEBHOOK_SECRET`, existing Envia API secrets, and `TRACK_SHIPMENTS_CRON_SECRET` as Edge Function secrets.
5. Store the same cron secret in Supabase Vault. Do not store or send a service-role JWT in scheduler configuration.
6. Register separate Envia sandbox/production `tracking.simple` webhooks.
7. Create the two schedules below while `TRACK_SHIPMENTS_POLLING_ENABLED` remains false.
8. Run rollback and canary checks, then explicitly enable polling.

## Secure Scheduler Invocation

`track-shipments` uses application-level cron authentication, not a user JWT. Its gateway configuration is `verify_jwt=false`; the handler MUST compare the exact `Authorization: Bearer <TRACK_SHIPMENTS_CRON_SECRET>` value in constant time before database or Envia access. Missing/blank configuration and malformed or mismatched Bearers return 401. Secrets, authorization headers, hashes, and prefixes MUST NOT be logged.

The scheduler reads the secret from Vault. The function uses its server-only service-role environment internally; that credential is never placed in Vault request headers or cron SQL.

## Schedules

| Lane | Cron | Body | Bound |
|---|---|---|---|
| `preparing` | `*/5 * * * *` | `{ "lane": "preparing" }` | 50 tracking numbers, 90 seconds |
| `shipped` | `2,17,32,47 * * * *` | `{ "lane": "shipped" }` | 50 tracking numbers, 90 seconds |

The offset avoids simultaneous starts. A per-lane lock prevents overlap; `busy` is an expected successful skip. Idempotent ledger uniqueness protects webhook/poll and retry collisions.

## Acceptance Evidence

Before enablement, retain:

- passing focused auth, lane, lock, deadline, idempotency, and rollback test output;
- a disabled-mode assertion showing zero database/Envia calls and unchanged event counts and tracking timestamps;
- schedule names/IDs and Vault/Edge secret parity confirmed by name only;
- one sandbox canary per lane showing the expected cadence and no duplicate ledger event;
- fixed-code logs proving secrets and authorization values are absent.

## Tested Rollback

Rollback is accepted only after the local drill passes: set `TRACK_SHIPMENTS_POLLING_ENABLED=false`, invoke both lanes, prove fixed `disabled` responses with zero side effects, remove both schedule fixtures, restore the prior function fixture, and confirm all append-only audit rows remain.

Production rollback uses the same order: disable polling first, remove both schedules, restore the prior function version, and retain `webhook_deliveries` and `shipment_tracking_events`. Acceptance evidence is no new scheduled invocations for at least 16 minutes, unchanged ledger/timestamps after disabled probes, and successful invocation of the restored prior path. Do not drop tracking tables or audit data.

## Post-Deployment Verification

Verify signed webhook ingestion and duplicate replay, one due and one not-due item per lane, no-event timestamp advancement, same-lane exclusion, Envia failure behavior, RLS visibility, and chronological mobile display. Deployment remains a manual maintainer action.
