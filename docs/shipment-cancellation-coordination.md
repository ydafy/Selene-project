# Shipment cancellation coordination — B1.1/B1.2/B1.3

## B1.3 status and Edge deployment inventory

B1.3 is complete as a locally verified repository change. Label and transfer arbitration SQL is maintainer-applied and generated types are synchronized. No Edge Function from B1.2 or B1.3 has been deployed. B1 is not complete: B1.4 integrated verification remains.

Local checkpoints: label SQL `bb759c2`, transfer SQL `23bacdd` (native review approved), transfer adapter `cb96844`. Independent verification passed for each unit. The final suite passed 1795 tests (0 failures). Unproven: offline endpoint Deno type checks (uncached remote imports), HTTP gateway/JWT, live cron, actual Stripe/Envia and deployed behavior.

Edge Functions changed on this branch and pending deployment:

| Function | Change | Shared imports |
|---|---|---|
| `cancel-order` | B1.2 manual cancellation reservation | `_shared/shipment-cancellation.ts` |
| `auto-cancel-orders` | B1.2 paid-timeout reservation | `_shared/shipment-cancellation.ts` |
| `auto-cancel-preparing` | B1.2 preparing-timeout reservation | `_shared/shipment-cancellation.ts` |
| `release-connect-payout` | B1.3 transfer begin/complete arbitration | `release-connect-payout.ts`, `atomic-resume-adapter.ts` |

`generate-shipping-label` is unchanged; label exclusion lives entirely in the applied SQL. No SQL replay, new secrets, cron schedules or webhooks are required. Deploy the four functions together in a quiet window: pause or let finish all cancellation crons and release invocations first, deploy, then resume. Mixed old/new callers are not covered by these guarantees.

## B1.3-T Edge adapter (repository sources only; not deployed)

`release-connect-payout` now calls the maintainer-applied begin RPC after creating/resuming the existing mapping and immediately before each new Transfer. Both RPC argument types come from the regenerated `Database` contract. The original new-run stage version, or the version returned by atomic resume, is passed unchanged to begin and completion. Begin does not increment that epoch.

The helper validates the returned envelope against its trusted run/shipment/seller/order context, positive safe-integer allocation, MXN currency, destination, charge, group and existing idempotency key. It sends only the exact validated server-returned values to the existing Stripe port. It then requires a nonblank Transfer ID and an exactly-true conditional completion before balance checks or payout progression. The old direct shipment Transfer-ID update is removed. Errors, malformed/lost responses and provider uncertainty never trigger retries, marker cleanup or an unfenced fallback. Stored Transfer IDs and the legacy destination-charge branch bypass both new RPCs.

New fail-closed errors use the existing `{success: false, error}` response and endpoint error-log pattern:

- HTTP 500 `SHIPMENT_TRANSFER_BEGIN_FAILED`: begin RPC returned an error (including arbitration refusal); no provider call is authorized.
- HTTP 409 `SHIPMENT_TRANSFER_BEGIN_INVALID`: malformed or mismatched committed begin envelope; the possible-effect marker may already exist.
- HTTP 409 `SHIPMENT_TRANSFER_RESULT_INVALID`: no confirmed nonblank provider identity; no completion.
- HTTP 409 `SHIPMENT_TRANSFER_COMPLETION_CONFLICT`: completion did not confirm exactly `true`; no balance/payout progression.
- HTTP 500 `SHIPMENT_TRANSFER_UPDATE_FAILED`: completion RPC error, retaining the prior identity-persistence error contract. Provider and transport exceptions retain existing endpoint handling; none authorizes a retry.

Unchanged allocation, admin authorization, completed-only eligibility, actionability, payout fencing, resume ownership and response/log behavior remain separately guarded. The old test expecting an automatic second Transfer after identity-write ambiguity is intentionally replaced by a durable-fence refusal test. Deterministic tests execute the production helper and typed RPC adapters with fake provider/RPC ports; they do not prove live SQL contention, HTTP gateway/JWT or actual Stripe outcomes. Parent-owned integrated and independent verification remain separate gates. This covers B13-S1/S3/S4's transfer adapter scope and preserves B13-S2's deployment boundary, not all of B1.3/B1.

### Local adapter evidence and limits

Focused Bun tests passed 112/0 with 706 assertions, including adjacent existing tests. A genuine behavioral RED first showed missing begin/completion ordering and forbidden provider progression (76 pass/36 fail); two earlier RED attempts timed out due to the pending-provider test setup, which was corrected before implementation. Scoped ESLint passed. An in-memory comparison with baseline `23bacdd` passed 12 unchanged helper scenarios, comparing exact results/errors and ordered provider/business effects while excluding the intentionally added arbitration RPCs; no committed test reads Git history and no filesystem scratch was created.

The required offline endpoint Deno check failed on uncached `https://deno.land/std@0.168.0/http/server.ts` with `--no-remote`; no fetch or retry was attempted. Required Prettier checking reports the helper, endpoint and test file; each also fails on the baseline revision. New blocks received scoped formatting without a whole-file cosmetic rewrite. These checks are not passes. The parent full Bun suite passed 1795 tests with 6614 assertions across 194 files (zero failures); parent focused spot-check also passed 112/0/706. Independent adapter verification later passed with no blockers: 112/0 candidate tests, 45 additional probes and three caught mutants; after line-ending normalization only two new line-width formatting lines remained, which commit hooks rewrite. Endpoint type proof and deployed/provider proof remain outstanding; the SQL checkpoint's native approval does not cover this adapter.

### Deployment sources and caller drain — maintainer action only

No new SQL or type generation is required: `20261017233608_shipment_transfer_coordination.sql` and its prerequisite migrations are already maintainer-confirmed applied. Do not replay them. Future deployment source for this unit is `supabase/functions/release-connect-payout/index.ts`, importing `release-connect-payout.ts` and the unchanged `atomic-resume-adapter.ts`. Existing cancellation sources `cancel-order`, `auto-cancel-orders` and `auto-cancel-preparing` must be deployed in the same window with their shared dependencies. `generate-shipping-label` is unchanged and needs no deployment. No deployment has been performed here.

Before rollout, separately pause/drain all old release and cancellation invocations, including jobs and any old in-flight provider attempts. Old release writers lack the start marker and old cancellation callers may bypass claims. Inspect unresolved historical runs before resumption: absence of the marker is not evidence of no old provider effect. Drain old callers before enabling the coordinated callers; do not claim mixed-version safety. No new secrets, cron schedules or webhooks are required. After separately authorized deployment, verify service-role begin/complete permissions, old-caller drain, loser/no-provider behavior and normal/stored-ID/legacy releases with disposable controlled fixtures. Remote inspection, provider operations, deployment and resumption require maintainer authorization and are not performed by these local tests.

## B1.3-T0 transfer SQL checkpoint (historical SQL-only scope)

The maintainer confirmed the transfer migration applied without errors and regenerated types. Local readback adds exactly the two nullable mapping columns and the begin/complete RPC signatures (+24 generated lines). This is human application evidence plus local generated-type evidence, not independent remote inspection. The deployment order below is historical/reference; do not replay the migration. Edge repository integration is described above; deployment remains pending.

### Verified local checkpoint

Writer and independent verifier passed 13 transfer SQL groups, 20 existing cancellation/label SQL groups and six offline transfer tests (20 assertions). Parent full Bun suite: 1759 pass, 0 fail, 6304 assertions across 194 files. Independent scoped ESLint/Prettier and public-RPC baseline differential passed; independent probes also confirmed actual role/privilege boundaries, write-free replay (including tuple identity), decimal allocation and preservation of transfer markers through existing resume/terminal projections. No product blocker or correction was reported. The transfer verifier's authorized temporary copy was cleaned successfully.

Native assessment was initially unavailable for the untracked SQL candidate. The subsequent isolated SQL checkpoint `23bacdd` received native approval and its acknowledgement was completed; that approval does not extend to this Edge adapter or deployment. These functional checks are local synthetic PostgreSQL and test results, not gateway/JWT, actual Stripe, deployed-schema or separate TypeScript-build proof. Maintainer application and generated-type synchronization were subsequently confirmed as recorded above; Edge integration still requires its own implementation and verification. Do not deploy functions or replay earlier migrations based on this checkpoint.

This unit prepares the transfer half of B13-S1/S3/S4; B13-S2's SQL/type/deployment boundary remains intact. It does not complete B1.3 or establish a deployed incident. Release is still completed-only, whereas cancellation is paid/preparing-only. Normal business eligibility is disjoint; explicit legacy-corruption fixtures test defensive overlap without allowing paid transfers.

### Minimal boundary and APIs

The existing `connect_payout_run_shipments` mapping gains nullable `transfer_started_at TIMESTAMPTZ` and `transfer_token UUID`, with a paired-null constraint and a shipment-scoped partial index. No new table, lease, workflow engine, job state or network-held transaction is added. Existing active mappings alone are not evidence that a Transfer may have started: they precede provider work, and payout reconciliation can change their status. The new timestamp is never cleared by those existing operations, and excludes cancellation regardless of mapping/run status or elapsed lease.

Both new service-only definer RPCs pin an empty search path and check the service role. They use the existing run → mapping → shipment lock order, compatible with resume/terminal projection. Cancellation locks shipment → operation and reads mappings without taking their locks. Locks end with the RPC transaction, before any provider call. Siblings in different operations remain independent; shipments in one payout run still share that existing run's ownership lock.

- `fn_begin_shipment_transfer(p_run_id UUID, p_shipment_id UUID, p_expected_stage_version INTEGER) → JSONB`: checks the captured run epoch, supported pre-payout stage, pending run/mapping, no executor claim (even lapsed), no newer payout/terminal/child authority, then locks the shipment. Live pre-start cancellation or any started cancellation raises `SHIPMENT_CANCELLATION_OPERATION_ACTIVE`. Expired pre-start context is preserved, not deleted or rotated. Stored Transfer/Payout references raise `SHIPMENT_FUNDS_ALREADY_RELEASED`; any prior transfer-start marker raises `SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED`. Completed status and timestamp remain mandatory (`SHIPMENT_NOT_COMPLETED`).
- The begin RPC reuses `admin_connect_payout_release_view` for checkout-fixed integer-cent allocation, verifies mapping amount and aggregate run amount, seller/readiness and scoped eligibility, and calls the existing `fn_get_connect_account_actionability`. Only this run's own `already_released` mapping is tolerated. Other errors are `SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT`, `SHIPMENT_TRANSFER_INELIGIBLE`, `CONNECT_ACCOUNT_NOT_ACTIONABLE`, `MISSING_SETTLEMENT_CONTEXT`, `SHIPMENT_NOT_FOUND`, or `UNAUTHORIZED` as applicable. There is no client amount argument and no new financial formula.
- A successful begin writes only the mapping's opaque token and possible-effect timestamp, without changing run version/stage. It returns exactly `{transfer_token, amount, currency: 'mxn', destination, source_transaction, transfer_group, idempotency_key, metadata}`. Stripe parameters are reconstructed from stored server data; metadata remains `{app_name: 'selene', run_id, shipment_id, seller_id, order_id}`. The key remains `${run.idempotency_key}:${run.id}:${shipment.id}`.
- `fn_complete_shipment_transfer(p_run_id UUID, p_shipment_id UUID, p_expected_stage_version INTEGER, p_transfer_token UUID, p_stripe_transfer_id TEXT) → BOOLEAN`: requires the same run epoch/authority and started mapping token. It writes `shipments.stripe_transfer_id` only when absent. Same-token/same-ID replay is a write-free `true`; a different existing ID or stale/missing ownership returns `false` without effects. Null/blank ID raises `MISSING_STRIPE_TRANSFER_ID`. It never clears the start marker or modifies payout stages, mappings' payout status or reconciliation history.
- Forward replacements of `fn_claim_shipment_cancellation` and private `fn_start_shipment_cancellation` add only `SHIPMENT_TRANSFER_OPERATION_ACTIVE` for any mapping with a possible Transfer effect. Original error ordering, owner/lease/context and label rules remain unchanged. B1.2's frozen-request wrapper still invokes private start; direct bare-start execution remains revoked from service/client roles. Applied migrations and their old canonical copies are untouched.

A confirmed committed begin response is the ONLY authority for one Transfer call. Use its exact returned parameters/key, removing `transfer_token` and `idempotency_key` from the Stripe params. On failed, malformed, timed-out or lost begin response, do not call Stripe. A provider error/unknown result or identity-persistence failure leaves the marker intact and requires investigation; no automatic retry, expiry release, second create or recovery protocol is introduced. A false/uncertain completion must stop the adapter before balance/payout progression; never fall back to direct shipment updates. The marker records possibility, not success. Legacy rows with stored Transfer IDs continue to reuse them without calling begin. The legacy destination-charge/no-Transfer branch must not call either new RPC.

### Maintainer SQL/type gate — confirmed complete, not deployment approval

1. Prerequisites: already applied current payout release/read-model, actionability, stage/executor and `20261008090000_atomic_payout_resume_mapping.sql`; B1.1/B1.2 cancellation SQL and the separately confirmed label coordination migration. Do not replay those migrations or canonical body copies.
2. After independent verification and separate maintainer acceptance, apply **only** `supabase/migrations/20261017233608_shipment_transfer_coordination.sql`. Its full canonical reference `supabase/queries/payments/shipment_transfer_coordination.sql` is identical, not a second script to execute. No backfill guesses old provider outcomes.
3. Confirm remote SQL application before `bun db:types`. Expected generated shape: the two nullable mapping columns in Row/Insert/Update, begin Args `{p_run_id, p_shipment_id, p_expected_stage_version}` returning `Json`, complete Args adding `{p_transfer_token, p_stripe_transfer_id}` returning `boolean`. UUIDs are strings, version is number. Existing cancellation signatures do not change. No generated types are edited or regenerated in T0.
4. Verify deployed grants/search paths, paired columns/index and unchanged cancellation RLS/private-start denial. Remote runtime checks require separate authorization and disposable fixtures. T0 neither applies SQL remotely nor proves the remote schema.
5. Only after this gate may B1.3-T change `supabase/functions/release-connect-payout/release-connect-payout.ts`, `index.ts`, and focused adjacent tests/adapters as separately scoped. Required adapter tests: real SQL/fake-provider race and loser effects; response/malformed-envelope refusal; stopped progression on false/uncertain completion; transfer error/DB ambiguity without retries; current-run snapshot ownership; exact Stripe params/key/allocation; stored-reference reuse, failed-child transfer reuse, legacy no-transfer branch; unchanged request/status/log contracts and account-actionability gates.
6. No Edge source is changed or deployed here. Future affected deployable function is `release-connect-payout`, alongside already-undeployed `cancel-order`, `auto-cancel-orders`, `auto-cancel-preparing` and label participation. Coordinate a quiet rollout and drain **all old release/cancellation invocations** before enabling the coordinated callers: old transfer writers do not mark starts, and old cancellation callers may bypass claims. Inspect unresolved old runs/provider attempts before any resumption; absence of the new marker is not proof of no historical effect. Pausing jobs, remote inspection/configuration and deployment require separate maintainer action. No new secrets, webhook or cron configuration is introduced by T0. SQL alone does not establish symmetric deployed safety.

### Local verification and limitations

```sh
bun scripts/test-shipment-transfer-coordination.ts --help
bun scripts/test-shipment-transfer-coordination.ts
bun test scripts/test-shipment-transfer-coordination.test.ts
bun scripts/test-shipment-cancellation-coordination.ts
```

The existing local PostgreSQL environment must already be healthy (`127.0.0.1:55432`, or the validated `SELENE_TEST_PG_PORT`). The harness pins local synthetic credentials, creates `b13t_<uuid>` and only missing non-login role stubs, serializes stub ownership with the cancellation harness's existing advisory lock, and cleans its own database/roles. No filesystem scratch or application environment URLs are consumed. Ten fixture-table snapshots prove rejected public calls change no data/counters. Migration-defined previous/current cancellation/refund and unchanged resume/payout-fence outputs are compared; an explicit corrupt overlap also proves the intended new rejection. The harness does not read Git history.

Behavioral RED was observed before SQL existed: `function public.fn_begin_shipment_transfer(uuid, uuid, integer) does not exist`, after baseline differential checks and successful owned cleanup. GREEN covers exact server payload/key, conditional immutable identity, state/allocation/account/run ownership, live/expired/started cancellation, transfer uncertainty before an ID is stored, both genuine contention orders, rollback, siblings, stored references, legacy payout preservation, service-only authorization and fake-provider ambiguity counters. The fixture's corrupt overlaps are explicitly labeled; no test enables paid transfers. The fake-provider counters are a local boundary model, not execution of the future Edge adapter. Offline tests pin help/errors and migration equality without requiring Docker. This is not a full Supabase replay, HTTP/gateway/JWT, actual Stripe, remote runtime, independent assessment or deployment proof. Parent-owned independent verification and integrated/full seam checks remain pending.

## B1.3-A label SQL checkpoint (maintainer-applied; Edge Functions not deployed)

The label half now joins cancellation's shipment-row lock. Transfer arbitration remains B1.3-T; this is not B1 or B1.3 completion. No Edge handlers, payout code, provider policy, secrets, schedules or webhooks change in this unit.

- `fn_claim_shipment_label(shipment UUID, seller UUID, origin address UUID)` preserves the current three-argument signature, seller authorization and immutable-origin selection. A live cancellation lease or any `external_started_at` raises `SHIPMENT_CANCELLATION_OPERATION_ACTIVE` before origin/state/event writes. Started uncertainty remains blocking after TTL.
- An expired **pre-start** cancellation does not block label ownership. Its entire operation row (original source/actor/reason/key/token) remains unchanged. Cancellation claim/start still reject label ownership; expiry does not grant a second external call. No token rotation, cancellation deletion or fence release is added.
- `fn_mark_shipment_label_sent(shipment UUID, token UUID)` locks the same shipment first, then rechecks cancellation and live label ownership. Cancellation, stale/null token or expired/null label lease returns `false` without a sent event. Lease checks use `clock_timestamp()` after lock acquisition, not transaction-start `now()`; claim expiry detection/lease creation uses the same live clock.
- Existing `claimed`, `generation_sent` and `orphan_pending` behavior remains reconciliation-only on uncertainty. There is no new workflow/state machine or database transaction held across provider calls.

The existing `generate-shipping-label` adapter maps claim RPC errors to `ineligible` and calls Envia generation only after `markSent` returns exactly `true`. Thus these SQL rejections need no Edge edit to prevent label purchase. Its existing pre-claim shipping-evidence update and mark-sent-failure rejection callback remain unchanged; SQL rejection-isolation evidence does not claim the entire HTTP request makes zero writes.

The maintainer confirmed application of the B1.3 label migration and type regeneration without errors. Local generated types have no diff, consistent with the unchanged signatures; this is human application evidence plus local readback, not independent remote verification. No Edge Function deployment is confirmed. The order below is retained as execution history/reference, not an instruction to replay SQL.

### Maintainer deployment gate (confirmed complete)

1. Already confirmed B1.1/B1.2 SQL must be present, along with the latest address-origin and label-rate migrations. Do not replay historical migrations.
2. After separate approval, manually apply **only** `supabase/migrations/20261017063755_shipment_cancellation_label_coordination.sql`. The two files in `supabase/queries/shipments/` are BODY-ONLY reference copies, not standalone deployment scripts; do not apply them again.
3. Report SQL application before any `bun db:types`. No table, column, argument or return signature changes, so no new generated API shape is expected. Preserve the repository's post-application type synchronization gate; no types were regenerated here.
4. Check the three-argument claim signature, both service-only grants (no PUBLIC/anon/authenticated execution), search paths and cancellation RLS/direct-write denial. Use separately authorized disposable fixtures for remote runtime checks.
5. This SQL unit requires no Edge deployment, new secrets, cron or webhook configuration. Existing undeployed B1.2 cancellation function sources and future transfer coordination remain separate rollout gates; do not advertise symmetric deployed safety with old cancellation callers still active.

### Focused evidence and limits

The local synthetic public-RPC harness first executes all existing B1.1/B1.2 regression groups. It loads the latest previous three-argument label claim and rate-guarded mark-sent definitions from their defining migrations, runs preservation probes, applies the new migration, and runs the same probes again. It compares return/error contracts and rejection snapshots, normalizing only inherently random tokens/timestamps by checking shape/ownership rather than equality. No git history or filesystem scratch is used. This is migration-sourced SQL differential evidence, not a scratch-copy comparison of the entire baseline application.

New probes cover cancellation-first rejection (observed behavioral RED before implementation), both actual row-lock race orders, expired pre-start context preservation, cancellation start after TTL, legacy overlap revalidation at mark-sent, transaction-start versus live-clock expiry, sent/orphan uncertainty, and independent siblings. Rejected calls compare every fixture table including label events; the harness has no label-provider port and cannot buy labels. Existing label auth/origin/rate/token/state behaviors run before and after the change. The existing adapter/helper tests are a separate offline check, not provider or gateway proof.

GREEN: the live harness passed 20 groups including cleanup. An attempted production label-helper import in the standalone runner could not resolve `npm:zod@4.1.12`; that optional import was removed rather than changing dependencies/configuration. Standalone helper verification initially failed for the same import-resolution reason. The label test now follows the existing quote test pattern: register the existing Bun-only Zod shim before dynamically importing the shared helper. Production imports, dependency versions and configuration remain unchanged. The combined coordination/helper suite passes 20 tests with 72 assertions; the full suite passes 1753 tests with 6284 assertions across 193 files. Independent label SQL verification passed the same 20 live groups and 20 focused tests, plus actual lock-wait expiry, privilege/RLS and zero losing-provider-call probes. Its ESLint/Prettier checks were unavailable after dependency copying timed out (missing isolated runners); writer scoped tooling checks passed separately. Native assessment was unavailable due to undeclared untracked scope, with no review authority or approval. These limits are not passing checks or deployment certification. Official Envia documentation previously consulted by the parent: [create shipping label](https://docs.envia.com/reference/create-shipping-label.md), [cancel shipment](https://docs.envia.com/reference/cancel-shipment.md), via `https://docs.envia.com/llms.txt`. No rollback guarantee was established. No live documentation fetch, provider API, sandbox purchase/cancellation, remote SQL, full Supabase migration replay or deployment is proven by this unit. Transfer arbitration, B2 refund recovery, B3 job locks and B4 carrier policy remain pending.

## Current deployment checkpoint

The maintainer confirmed both B1.1 and B1.2 SQL application and regenerated types. Local type readback includes the table, frozen request/loss columns and new start RPC. This is human deployment evidence plus local type evidence, not an independent remote inspection. Handler integration is implemented in the repository; no Edge Function deployment has occurred. The maintainer explicitly accepted LOCAL repository completion with the verification limitations below. This does not approve deployment, native review or production readiness.

### SQL/type gate (maintainer confirmed complete)

1. B1.1 `20261016011954_shipment_cancellation_coordination.sql` must already be applied; do not replay it.
2. B1.2 `supabase/migrations/20261016051001_shipment_cancellation_refund_request.sql` was subsequently applied. Do not replay it or its identical canonical reference copy `supabase/queries/orders/shipment_cancellation_refund_request.sql`.
3. Confirm application before regenerating types with `bun db:types`. Check `refund_request`, `cancellation_loss_cents`, and `fn_start_shipment_cancellation_refund` (shipment UUID, token UUID, request JSONB, optional loss BIGINT; result JSON).
4. Verify RLS/direct-table denial remains intact, the new RPC grants execution only to `service_role`, and `service_role` no longer has direct execution of bare `fn_start_shipment_cancellation`. Remote runtime probes require separately authorized disposable fixtures.
5. No Edge Functions, secrets, cron jobs or webhooks were deployed/changed in this SQL step. After the satisfied SQL/type gate, B1.2 integrates `cancel-order`, `auto-cancel-orders` and `auto-cancel-preparing` in the repository. Their deployment remains a separate maintainer action.

## B1.2 frozen-request start

`fn_start_shipment_cancellation_refund` is the only service-callable start after B1.2 SQL. It reuses B1.1 start's ownership, lease, state and persisted label/transfer guards, then saves the request and proportional actual fee loss in that **same transaction**. An invalid request rolls back the start too. This avoids another preparation RPC or a second state machine.

The server caller must reconstruct the refund from trusted shipment/order/Stripe data first; SQL validates its shape and context, **not the financial entitlement calculation**. Never forward a client-provided amount. The stored request is exactly:

```json
{
  "payment_intent": "pi_server_resolved",
  "amount": 11000,
  "reason": "requested_by_customer",
  "metadata": {
    "shipment_id": "shipment-uuid",
    "order_id": "order-uuid",
    "caller_role": "buyer",
    "reason": "original winning reason",
    "seguro_share_cents": 1000
  }
}
```

Only those keys are accepted. Amount is positive integer cents within JavaScript's safe-integer range; buyer-fee share is an integer between zero and amount. PaymentIntent must match the shipment reference, falling back to the order reference only when the shipment reference is null. Metadata must match the operation's original reason, shipment/order and role (`buyer`/`seller`, or `system` for either cron). `cancellation_loss_cents` is a nonnegative safe integer or null when unavailable; null is not silently converted to zero.

The RPC returns `{operation_key, refund_request, cancellation_loss_cents}`. The caller must wait for a confirmed successful response/commit and use the returned request/key, not reconstruct another payload. An error, timeout or uncertain response forbids a Stripe call. The fence survives lease expiry; neither replay nor another caller can change the request or start again. Existing B1.1 started operations without snapshots remain fenced; there is no backfill/reopen/retry.

New validation errors: `INVALID_CANCELLATION_REFUND_REQUEST`, `INVALID_CANCELLATION_LOSS`. B1.1 guard errors still apply. Direct bare-start execution is now denied to `service_role`; the new definer RPC invokes it internally. Table access is still denied to client/service roles.

This is not durable refund status/identity/recovery (B2), label/transfer writer exclusion (B1.3), preparing carrier safety (B4), or evidence that deployed handlers use the new path.

## Repository verification checkpoint

- Final parent `bun test`: **1752 pass, 0 fail, 6278 assertions, 193 files**. Scoped ESLint/Prettier and diff checks passed.
- Independent deterministic adapter probes passed arbitration, preflight rejection, losing-attempt isolation, winning context and refund fencing. Two differential output regressions were corrected in one batch; targeted independent recheck confirmed the original manual provider-error HTTP500/body/logging and both cron reason/success-log contracts are restored. New preservation regressions: 9 pass, 0 fail, 43 assertions.
- The production-helper/live-SQL seam passed 14 groups in the parent's local synthetic database. The later independent live SQL run **failed to connect**; it is not an independent pass and was not retried.
- Endpoint `deno check --no-remote` remained unavailable because remote imports were uncached. Pure-helper typechecking passed; that does not prove the three endpoints typecheck.
- Native assessment was unavailable for undeclared untracked scope; no native review authority or approval exists for B1.2. No HTTP/Supabase gateway, actual Stripe, real cron or remote deployment proof is claimed.

The maintainer selected "Aceptar cierre local con esas limitaciones": B1.2 is closed as LOCAL repository implementation with these explicit proof limits, not as a deployed or fully certified module. No unavailable check is counted as a pass. No additional checks, provider attempts, commits or deployment follow automatically from acceptance.

## Handler orchestration and failure boundary

The shared `supabase/functions/_shared/shipment-cancellation.ts` orchestrates claim → trusted financial reconstruction → atomic frozen-request start → Stripe → existing business cancellation. Manual preflight must still reject maintenance, unauthenticated/nonowner/non-paid requests before claiming; cron selection still uses the existing settings/timeouts and authorization. Per-shipment reconstruction and fee persistence occur only for a successful claim owner, not a competing loser.

- `busy`: manual responds with a conflict; cron skips/logs the shipment. No refund or business cancellation.
- `recovery_required`: no provider call or automatic DB retry. A previous external outcome may exist; inspect through a separately authorized recovery process (B2 remains pending).
- Invalid/failed/uncertain claim or start: no Stripe call. The helper rejects malformed responses with `CANCELLATION_RESERVATION_INVALID` or `CANCELLATION_START_INVALID` rather than invent ownership.
- Original winning source/actor/reason survive a pre-start lease takeover. All callers use `cancel_shipment_{shipmentId}`, exact five-field metadata and persisted loss, including null versus zero.
- Provider errors, including `charge_already_refunded`, never authorize business cancellation. A resolved provider result must explicitly have `status: succeeded`; otherwise `CANCELLATION_REFUND_UNCONFIRMED` stops completion with the durable fence intact. This minimal refund-before-cancellation guard does not persist refund IDs/status, reconcile asynchronous changes, poll or implement B2 recovery.
- Stripe success followed by business DB failure remains fenced; no automatic second refund or completion retry is added. Existing operational logging remains the escalation surface.

The helper's deterministic tests cover callback order/effects and response validation. The live local SQL harness also calls this production helper against actual claim/start RPCs, with **fake** provider and business ports, to check competing manual/cron attempts, repeated claims and sibling independence. This seam is not HTTP/gateway, actual Stripe, inventory, notification or remote-cron end-to-end proof.

### Future Edge deployment handoff (not authorized here)

After repository verification and maintainer acceptance, affected deployment sources are `cancel-order`, `auto-cancel-orders`, and `auto-cancel-preparing` plus their imported `_shared/shipment-cancellation.ts` and existing shared dependencies. No new migration beyond the two already confirmed, new secrets, cron schedules or webhooks are required by the adapter integration.

Coordinate a quiet deployment window and let old cancellation invocations finish before enabling all updated paths: old cron versions used different idempotency keys and did not participate in this reservation. Do not mix old/new active callers and call that safe. Pausing jobs/configuration or deploying functions requires separate maintainer action/authorization; the agent does neither automatically. Label SQL now joins this lock in repository preparation only (B1.3-A above); transfer writers still do not, durable refund recovery remains B2, and preparing carrier policy remains B4. This is not full-module or production safety certification.

## Scope and current state

B1.1 was a dormant foundation; B1.2 adds cancellation caller integration separately. No deployed handler integration is claimed. Label SQL participation is prepared in B1.3-A above, not deployed; Connect release participation remains pending. B1.3 makes those writers participate in the same shipment lock; B1.4 verifies the integrated behavior. Stored label/transfer checks alone do not exclude another writer's in-flight provider call.

No refund is created or recorded here. No shipment/order status, inventory, notification, allocation or loss is changed. Preparing-timeout acquisition does not prove carrier cancellation is safe (B4). B2 extends this same operation with refund identity/status and recovery; do not create a second refund subsystem.

## B1.1 foundation contract (before the B1.2 extension)

`shipment_cancellation_operations` contains one row per shipment, protected by RLS and without direct grants to client or service roles. Two `SECURITY DEFINER` functions have an empty search path, check `auth.role()`, and grant execution only to `service_role`:

| RPC                              | Inputs                                                                 | Result                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_claim_shipment_cancellation` | Shipment UUID, order UUID, actor UUID or null, source, nonblank reason | JSON `status`, stable `operation_key`, original `source`, `actor_id`, `reason`; only `claimed` includes owner `claim_token` and `claim_expires_at`. |
| `fn_start_shipment_cancellation` | Shipment UUID, owner token UUID                                        | `true` only on the first permitted write-ahead start; all other attempts raise an error.                                                            |

Sources `buyer`/`seller` require the corresponding owner and a `paid` shipment. `paid_timeout` requires a null actor and `paid`; `preparing_timeout` requires a null actor and `preparing`. The future trusted cron caller still owns settings-driven timeout validation. The future manual handler still owns authenticated-user resolution and the maintenance gate. These RPCs are not user-callable endpoints.

Both functions lock the shipment first, reject persisted transfer/payout references, and reject label states `claimed`, `generation_sent`, `orphan_pending` (also inconsistent `paid` + `generated`). Start rechecks state/blockers after claim. A generated label in `preparing` is deliberately not treated as a generation in flight; B4 owns the required carrier evidence and outcome before any refund in that path.

### Ownership and uncertainty

1. The first claim creates `cancel_shipment_{shipmentId}`, original source/actor/reason, an opaque owner token and a fixed 15-minute lease.
2. A second live claim returns `busy`, without an owner token or any mutation.
3. An expired **pre-start** lease may rotate its owner token. It preserves the first source/actor/reason/key. The old worker can no longer start.
4. Before an external call, the owner must persist `external_started_at` through start. Expired or mismatched ownership is rejected. Lease checks use the live database clock, not a transaction-start timestamp.
5. Once marked, repeated start raises an error and further claims return `recovery_required`, even after the lease expires. No TTL or automatic release authorizes another call.

The write-ahead mark proves only that a call **might** start, not Stripe success. A crash before sending still needs recovery, rather than blindly reopening the attempt. The caller must not call Stripe after a failed or uncertain start response. Start must commit before the provider call; do not hold a database transaction open over the network. Never log tokens.

B1.2's extension above adds request persistence (including amount and payment identity) atomically with start, without enabling handlers. A shared Stripe key with changing parameters is not sufficient. There is still no release, completion or refund-status RPC; B2 recovery remains unimplemented.

### Errors

Claim/start reject with `UNAUTHORIZED`, `SHIPMENT_NOT_FOUND`, `SHIPMENT_ORDER_MISMATCH`, `SHIPMENT_NOT_CANCELABLE`, `SHIPMENT_FUNDS_ALREADY_RELEASED` or `SHIPMENT_LABEL_OPERATION_ACTIVE` as applicable. Claim additionally rejects `INVALID_CANCELLATION_CONTEXT`, `ORDER_BUYER_MISMATCH` and `SHIPMENT_SELLER_MISMATCH`. Start additionally rejects `STALE_CANCELLATION_CLAIM`, `CANCELLATION_CLAIM_EXPIRED` and `CANCELLATION_EXTERNAL_ALREADY_STARTED`. Privilege denial can occur before the function body. Errors do not commit partial mutations.

## Local verification

Prerequisite: the existing [local PostgreSQL environment](postgres-test-harness.md), running on a local Docker engine. No new infrastructure or JavaScript dependency is needed.

```sh
bun run db:test:up
bun scripts/test-shipment-cancellation-coordination.ts --help
bun scripts/test-shipment-cancellation-coordination.ts
bun test scripts/test-shipment-cancellation-coordination.test.ts
```

The executable harness only accepts a port override (`SELENE_TEST_PG_PORT`, default 55432), pins host/database credentials to the local test environment, and ignores application connection variables. It creates a uniquely named `b11_<uuid>` database, a minimal shipment/order schema and an `auth.role()` stub. It first applies the exact B1.1 migration/canonical SQL and proves its original contract, then applies B1.2 SQL and proves atomic request/start, changed-request/replay rejection, validation rollback, privilege revocation, seller/cron contexts and real start contention. It is not a TypeScript reimplementation. It creates non-login `anon`, `authenticated`, `service_role` stubs only when absent; a local advisory lock serializes ownership across runs. It removes only its generated database and roles it created. Never point a proxy at this loopback port to a remote database.

The tests exercise public RPC ownership, frozen context, expired pre-call takeover, stale tokens, post-start uncertainty, state/role guards, service-role execution, denied direct writes and sibling isolation. For real contention A calls claim inside a transaction and keeps its shipment lock; B must receive SQLSTATE `55P03` under a bounded lock timeout. After A commits, B returns `busy` without a second owner. The lease-expiry tests use explicit synthetic timestamp fixtures, not a 15-minute sleep. No provider calls are made.

Plain `bun test` runs only offline CLI/mirror checks and does not require Docker. The standalone live harness fails with nonzero exit on unavailable PostgreSQL, assertion failure or cleanup failure; it never turns unavailable execution into a passing skip. Its minimal schema/auth stub is not proof of the full deployed schema, Supabase JWT/gateway behavior, real cron, Envia or Stripe behavior. Integrated and deployed checks remain separate.

## Historical B1.1 deployment handoff — maintainer only

Repository verification does not establish remote deployment. No remote operation is authorized by this document.

1. When separately approved, apply **only** `supabase/migrations/20261016011954_shipment_cancellation_coordination.sql`. `supabase/queries/orders/shipment_cancellation_coordination.sql` is an identical canonical copy, **not a second script to run**. This additive migration is intended to run once; use normal migration bookkeeping rather than replaying its table creation.
2. No Edge Functions, new secrets, cron jobs or webhooks need deployment for B1.1. Do not switch any existing handler to these RPCs yet.
3. After the maintainer confirms SQL was applied, run `bun db:types`. Verify the new table and both RPC signatures are generated. Do not hand-edit types or claim the current generated types include these undeployed objects.
4. Inspect the deployed table's RLS, function grants/search paths and signatures. Any remote runtime checks require separately authorized disposable fixtures. Preserve the old handler behavior until the next scoped integration.

There is no backfill of existing shipments or cancellation attempts. These rows are created only by future callers. B1.1 completion means locally verified repository preparation; deployment/type synchronization is reported separately, not silently treated as completed.
