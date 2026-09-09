# Apply Progress: Hardened Buyer Shipment Confirmation

**Mode**: Strict TDD (`bun test`)
**Delivery**: Maintainer-approved `size:exception` (`exception-ok`)
**Work unit**: Phase 6 — deployment handoff and provider validation boundary
**Cumulative status**: 25/25 tasks complete
**Gate correction**: `phase-1-gate-correction` (one allowed corrective rerun)

## Completed Tasks

- [x] 1.1 RED source-guard tests for the schema, ledger, RPC authority, grants, Connect wallet guard, and legacy retirement.
- [x] 1.2 CLI-created migration `20260903002546_confirm_shipment_hardening.sql` adds the nullable buyer confirmation timestamp, append-only completion ledger, due index, service-role RPC, grants, and legacy drops.
- [x] 1.3 Canonical shipment confirmation SQL now implements the shared race-safe completion transaction; the legacy order-level SQL source is removed.
- [x] 1.4 Focused source-guard test passed.
- [x] 2.1 RED unit tests cover request validation, auth, maintenance, buyer ownership, shipment isolation, delivered-only and dispute gates, canonical result mapping, idempotent success, and safe diagnostics.
- [x] 2.2 Pure confirmation helper validates client scope and idempotency before constructing server-authoritative buyer RPC input.
- [x] 2.3 `confirm-shipment-delivery` authenticates the caller, fetches maintenance/order/shipment/dispute context with service role, and calls only the canonical RPC.
- [x] 2.4 Focused Edge Function contract tests passed.
- [x] 3.1 RED unit tests cover cron authentication before shipment access, POST-only validation, a bounded 100-row batch, 48-hour eligibility, retry idempotency, buyer/auto race resolution, and partial-failure accounting.
- [x] 3.2 Pure scheduler helper authenticates the cron request, filters eligible delivery candidates, creates deterministic auto RPC input, maps canonical completion outcomes, and emits safe diagnostics.
- [x] 3.3 `complete-delivered-shipments` authenticates the cron secret before service-role database work, selects at most 100 due shipments, and calls only the canonical RPC with retry-safe batch reporting.
- [x] 3.4 Focused scheduler contract tests passed.
- [x] 4.1 RED registry source-contract tests cover the confirmation request payload and canonical completion response.
- [x] 4.2 `EdgeFunctionRegistry` includes the typed `confirm-shipment-delivery` request and response contract.
- [x] 4.3 GREEN focused registry contract tests passed.
- [x] 4.4 Maintainer confirmed remote migration application and manual type generation; generated types were read-only verified against the migration's column, completion ledger, relationships, and canonical RPC signature/return contract.
- [x] 5.1 RED frontend source-contract and unit tests cover the delivered-only buyer gate, active-dispute exclusion, shipment-scoped idempotency, error mapping, Edge Function routing, legacy fallback retirement, and localized copy.
- [x] 5.2 Shipment confirmation utility builds deterministic per-shipment idempotency payloads and maps safe confirmation failures for the existing toast pattern.
- [x] 5.3 Shipment permissions now allow confirmation only for a buyer's delivered shipment with no active dispute.
- [x] 5.4 Confirmation invokes the typed `confirm-shipment-delivery` Edge Function and no longer falls back to `fn_confirm_delivery`.
- [x] 5.5 The order detail confirmation dialog requires a concrete shipment, retains retry behavior after an error, and its English and Spanish copy states delivery-only confirmation with admin-released payout.
- [x] 5.6 Focused frontend test passed.
- [x] 6.1 Created the deployment handoff with ordered SQL/function deployment, required secrets, cron setup, sandbox smoke checks, and post-deployment validation.
- [x] 6.2 Verified the handoff records the confirmed migration first, functions second, confirmed post-SQL type generation, and the exact scheduler route/header contract: Vault-held project anon JWT for gateway headers plus `x-cron-secret` matching Edge `CRON_SECRET`.
- [x] 6.3 Maintainer-confirmed remote migration application and manual type generation are recorded, local generated types structurally confirm the new column, ledger, and RPC, and the maintainer-supplied execution result for the exact read-only live SQL query records all eight required structural/grant checks as `true` in `deployment-handoff.md`.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 correction | `supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` | Source guard | 4 pass, 0 fail, 38 `expect()` calls | Test guards added before the corrective execution; the existing source already implemented these contracts | 8 pass, 0 fail, 48 `expect()` calls | Active dispute, buyer ownership, buyer/auto actor and idempotency, and buyer/auto timestamp branches | None needed |
| 1.2–1.3 | Existing Phase 1 source and migration | SQL source | Historical RED evidence retained | Historical migration/canonical-source implementation | Previously green; preserved by the corrective source guard | Covered by the correction guards above | None needed |
| 1.4 correction | `supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` | Source guard | 4 pass, 0 fail, 38 `expect()` calls | Test guards added before the corrective execution | 8 pass, 0 fail, 48 `expect()` calls | Eight source-guard scenarios across distinct authorization and completion paths | None needed |
| 2.1 | `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Unit / endpoint-contract | N/A (new files) | 0 pass, 1 fail because the required helper module did not exist | 15 pass, 0 fail, 22 `expect()` calls | Valid and invalid UUID/key inputs; delivered and completed retry branches; state, dispute, ownership, canonical RPC errors, and no client Connect/payment forwarding | None needed |
| 2.2 | `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Unit | N/A (new file) | Test suite existed before the helper | 15 pass, 0 fail, 22 `expect()` calls | Success, rejection, and duplicate-completion paths exercise distinct helper branches | None needed |
| 2.3 | `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Endpoint-contract | N/A (new file) | Endpoint contract tests existed before the endpoint | 15 pass, 0 fail, 22 `expect()` calls | Authentication, maintenance, ownership, scope, dispute, canonical mapping, and safe diagnostics are shared endpoint contracts | None needed |
| 2.4 | `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Unit / endpoint-contract | N/A (new file) | RED recorded in task 2.1 | 15 pass, 0 fail, 22 `expect()` calls | All specified success and failure classes have a second distinct case where applicable | None needed |
| 3.1 | `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` | Unit / endpoint source-contract | N/A (new files) | 0 pass, 1 fail, 1 error because `./complete-delivered-shipments` did not exist | 9 pass, 0 fail, 13 `expect()` calls | Invalid/missing configuration; 48-hour boundary and 1ms exclusion; capped and partial batches; auto retry and buyer-winner race | Extracted request validation and batch-result summarization without behavior change; tests stayed green |
| 3.2 | `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` | Unit | N/A (new file) | Test suite existed before the helper | 7 pass, 0 fail, 9 `expect()` calls | Authentication, eligibility, bounded selection, retry, race, and malformed RPC paths exercise distinct helper branches | Extracted `validateAutoCompletionRequest` and `summarizeAutoCompletionResults`; final 9 pass, 0 fail, 13 `expect()` calls |
| 3.3 | `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` | Endpoint source-contract | N/A (new file) | 0 pass, 1 fail, 1 error because `validateAutoCompletionRequest` and `index.ts` did not exist | 8 pass, 0 fail, 12 `expect()` calls | Secret validation precedes the shipments query; partial failures preserve successful/idempotent counts for retry | Final endpoint contract refactor stayed green: 9 pass, 0 fail, 13 `expect()` calls |
| 3.4 | `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` | Unit / endpoint source-contract | N/A (new files) | RED recorded in tasks 3.1 and 3.3 | 9 pass, 0 fail, 13 `expect()` calls | All scheduler acceptance paths have distinct happy/edge coverage | None needed |
| 4.1 | `packages/types/src/confirmShipmentContracts.test.ts` | Source-contract | N/A (new test); 6 pass, 0 fail, 11 `expect()` calls in the pre-existing registry safety net | 0 pass, 2 fail, 2 `expect()` calls because the registry entry did not exist | 2 pass, 0 fail, 2 `expect()` calls | Request payload and completion response assertions cover separate structural contract paths | None needed; registry declaration is structural |
| 4.2 | `packages/types/src/confirmShipmentContracts.test.ts` | Source-contract | 6 pass, 0 fail, 11 `expect()` calls | RED recorded in task 4.1 | 2 pass, 0 fail, 2 `expect()` calls | Covered by the two independent request/response contract assertions | None needed; minimal registry declaration |
| 4.3 | `packages/types/src/confirmShipmentContracts.test.ts` | Source-contract | 6 pass, 0 fail, 11 `expect()` calls | RED recorded in task 4.1 | 2 pass, 0 fail, 2 `expect()` calls | Request payload and canonical response are distinct source-contract cases | None needed; structural contract has no runtime branch |
| 4.4 | `packages/types/src/database.types.ts` | Generated-schema verification | N/A — no source change; task is a post-deployment read-only inspection | N/A — no implementation is authored for generated output | Maintainer-confirmed remote migration and manual type generation; local generated output matches the migrated schema | Verified independent structures: shipment column, ledger rows/relationships, and RPC args/return shape | None; no edit was needed or permitted |
| 5.1 | `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Unit / source-contract | N/A — new focused test; CodeGraph found no pre-existing coverage for the modified hooks or detail screen | 0 pass, 1 fail, 1 error because `shipment-confirmation` did not exist | 4 pass, 0 fail, 19 `expect()` calls | Delivered/shipped, disputed/undisputed, buyer/non-buyer, and two shipment IDs/error codes exercise distinct paths | None needed |
| 5.2 | `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Unit | N/A — new utility | RED recorded in task 5.1 | 4 pass, 0 fail, 19 `expect()` calls | Two shipment payloads prove keys are shipment-scoped; active-dispute and maintenance errors use separate mappings | None needed |
| 5.3 | `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Unit / source-contract | N/A — no pre-existing focused coverage | RED recorded in task 5.1 | 4 pass, 0 fail, 19 `expect()` calls | Delivered, shipped, active-dispute, and non-buyer inputs cover each permission branch | Extracted the gate into a pure utility used by `useShipments` |
| 5.4 | `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Source-contract | N/A — no pre-existing focused coverage | RED recorded in task 5.1 | 4 pass, 0 fail, 19 `expect()` calls | The test asserts typed Edge routing and independently rejects the legacy fallback text | None needed |
| 5.5 | `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Source-contract | N/A — no pre-existing focused coverage | RED recorded in task 5.1 | 4 pass, 0 fail, 19 `expect()` calls | English and Spanish delivered-only/admin-payout copy assertions cover two localized branches | Dialog guard and retry handling preserve existing cancel-dialog behavior |
| 5.6 | `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Unit / source-contract | N/A — new focused suite | RED recorded in task 5.1 | `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` — 4 pass, 0 fail, 19 `expect()` calls | All focused scenarios remain green after the small refactor | None needed |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test | `bun test supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` — 8 pass, 0 fail, 48 `expect()` calls |
| Runtime harness | Deferred to Phase 6. Remote SQL apply is maintainer-only and was not run; this Work Unit records source guards only and makes no live SQL claim. |
| Rollback boundary | `supabase/migrations/20260903002546_confirm_shipment_hardening.sql` and `supabase/queries/orders/fn_confirm_shipment_delivery.sql`; restoring the retired legacy path is emergency-only because it restores known unsafe behavior. |

### Work Unit 2 Evidence

| Evidence | Result |
|---|---|
| Focused test | `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` — 15 pass, 0 fail, 22 `expect()` calls |
| Runtime harness | Deferred. `supabase functions serve` requires Docker, which is explicitly out of scope; remote deployment is maintainer-only. The endpoint contract is covered by the focused unit suite and must receive maintainer-environment `serve + curl` validation in Phase 6. |
| Rollback boundary | `supabase/functions/confirm-shipment-delivery/` — remove the new endpoint and helper together; the canonical SQL Connect wallet guard remains unchanged. |

### Work Unit 3 Evidence

| Evidence | Result |
|---|---|
| Focused test | `bun test supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` — 9 pass, 0 fail, 13 `expect()` calls |
| Runtime harness | Deferred to Phase 6. `supabase functions serve` requires Docker, which is explicitly out of scope; remote deployment is maintainer-only. The focused unit/source-contract suite proves the request ordering and scheduler contracts; maintainer-environment `serve + curl` validation remains required in Phase 6. |
| Rollback boundary | `supabase/functions/complete-delivered-shipments/` — remove the scheduled endpoint, helper, and focused test together; the canonical SQL RPC and buyer function remain unchanged. |

### Work Unit 4 Evidence

| Evidence | Result |
|---|---|
| Safety net | `bun test packages/types/src/connectPayoutContracts.test.ts` — 6 pass, 0 fail, 11 `expect()` calls before changing the shared registry. |
| RED | `bun test packages/types/src/confirmShipmentContracts.test.ts` — 0 pass, 2 fail, 2 `expect()` calls; the new source-contract test failed because `confirm-shipment-delivery` was absent. |
| Focused GREEN | `bun test packages/types/src/confirmShipmentContracts.test.ts` — 2 pass, 0 fail, 2 `expect()` calls. |
| Runtime harness | N/A. This unit is a TypeScript registry source-contract only; `bun db:types` remains forbidden until the maintainer confirms remote SQL. |
| Rollback boundary | Remove the `confirm-shipment-delivery` registry entry and `confirmShipmentContracts.test.ts` together; do not modify generated database types. |

### Task 4.4 Generated Schema Verification

| Evidence | Result |
|---|---|
| Deployment prerequisite | Maintainer explicitly confirmed the remote application of `supabase/migrations/20260903002546_confirm_shipment_hardening.sql` and manual execution of the database type-generation command. This executor did not run `bun db:types` or perform any remote operation. |
| `shipments` column | `Database['public']['Tables']['shipments']` exposes `buyer_confirmed_at: string \| null` in `Row` and optional `string \| null` in `Insert` and `Update` (lines 2093, 2133, 2173). |
| Completion ledger fields | `shipment_completion_events` exposes `id`, `shipment_id`, `order_id`, `source`, `actor_id`, `idempotency_key`, `completed_at`, `is_connect`, and `created_at`; required/optional shapes align with the migration defaults and nullable actor (lines 1847–1880). |
| Completion ledger relationships | Generated relationships include `shipment_completion_events_actor_id_fkey` to `profiles.id`, `shipment_completion_events_order_id_fkey` to `orders.id`, and the unique `shipment_completion_events_shipment_id_fkey` to `shipments.id`, including generated view relation variants (lines 1881–1952). |
| Canonical RPC contract | `fn_confirm_shipment_delivery` has args `p_shipment_id`, `p_source`, `p_actor_id`, `p_idempotency_key` as strings and returns an array with `success: boolean`, `error: string`, `completion_source: string`, and `idempotent: boolean` (lines 3209–3221). |
| Alias/registry context | `packages/types/src/index.ts` imports `Database`, exposes generic `Tables`/`Enums`, aliases `Shipment = Tables<'shipments'>`, and retains the typed `confirm-shipment-delivery` Edge Function contract (lines 2–30, 140–177). |
| Focused test / runtime harness | N/A by task scope: this is a read-only generated-artifact verification after a maintainer-run command. No pre-existing narrow source contract verifies remote-generated output, and the user explicitly prohibited tests. |
| Rollback boundary | No repository source behavior changed. Reverting this evidence/checkbox changes only OpenSpec task tracking; generated types remain tool-owned and were not manually edited. |

### Work Unit 5 Evidence

| Evidence | Result |
|---|---|
| Focused RED | `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` — 0 pass, 1 fail, 1 error; the test could not resolve the intentionally absent `shipment-confirmation` utility. |
| Focused GREEN | `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` — 4 pass, 0 fail, 19 `expect()` calls. |
| Runtime harness | `bun run start --offline` in `apps/frontend` could not start because port 8081 is already occupied and Expo required non-interactive confirmation for port 8082. This is an environment conflict, not an application assertion; no alternate process was stopped and no user changes were modified. |
| Rollback boundary | Revert `apps/frontend/core/utils/shipment-confirmation.ts`, the confirmation blocks in `useShipments.ts` and `useOrderActions.ts`, the order-detail dialog guard, the two `orders.json` entries, and `shipment-confirmation.test.ts` together. This restores only the prior confirmation client behavior. |

## Evidence

- Historical RED: `bun test supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` — 0 pass, 4 fail before migration and canonical SQL implementation.
- Corrective GREEN: `bun test supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` — 8 pass, 0 fail, 48 `expect()` calls.
- Source guards now assert active-dispute rejection; buyer/order ownership; buyer and auto actor/idempotency requirements; buyer timestamp assignment; and auto preservation of `buyer_confirmed_at` as NULL through its eligibility gate and update branch.
- Runtime harness: Deferred to Phase 6. Remote SQL execution is maintainer-only and was not run; no live SQL runtime proof is claimed.
- Reusable harness: Yes. The focused test remains a source guard for migration and canonical SQL regressions.
- Settlement token retained by orchestrator: `sha256:06da14b54d87430d195f1e1653a697246031a9bae5a527136e8eaa1c88cbfdfa`. This correction did not acquire or settle it.
- Phase 2 RED: `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` — 0 pass, 1 fail; the newly written test correctly failed because `./confirm-shipment-delivery` did not exist.
- Phase 2 GREEN: `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` — 15 pass, 0 fail, 22 `expect()` calls.
- Phase 2 diagnostics retain only shipment ID, buyer source, deterministic key, result, and code; caller identity, authorization data, and raw database errors are excluded.
- Settlement token retained by orchestrator: `sha256:76583022416f02a72c81555b2cb2fd30d3027b4f63dcb490f22a7c36dfa3b1fa`. This apply batch did not acquire or settle it.
- Evidence revision: `confirm-shipment-phase-2-r1`; source bundle SHA-256: `0d7166f65f159da7a67acfa4a999b9d99623b0e7af1c4b124b760300fe2ddff9` for the helper, endpoint, and focused test.
- Phase 3 initial RED: `bun test supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` — 0 pass, 1 fail, 1 error; the newly written test correctly failed because `./complete-delivered-shipments` did not exist.
- Phase 3 endpoint RED: `bun test supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` — 0 pass, 1 fail, 1 error; the scheduler request-validation export and `index.ts` did not exist.
- Phase 3 partial-failure RED: `bun test supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` — 0 pass, 1 fail, 1 error; the batch-result summarizer did not exist.
- Phase 3 GREEN: `bun test supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` — 9 pass, 0 fail, 13 `expect()` calls.
- The scheduler validates `x-cron-secret` and `CRON_SECRET` before creating the service-role client or querying shipments, bounds each database selection to 100 rows, and uses only `fn_confirm_shipment_delivery` with `auto_completion_<shipmentId>` keys.
- A buyer winner returned by the canonical RPC is counted as idempotent success, while a partial batch failure returns a retryable 500 after emitting secret-free diagnostics; already completed rows remain idempotent on retry.
- Runtime harness remains deferred: Docker and remote deployment are explicitly prohibited. No secret, cron, Dashboard, SQL, function deployment, or generated-type action was performed.
- Settlement token retained by orchestrator: `sha256:69afe4b6fd2ddf8ff0878e6a7ef397554898bea97509419e26d1a6c4ea57f7b7`. This apply batch did not acquire or settle it.
- Evidence revision: `confirm-shipment-phase-3-r1`.
- Phase 4 safety net: `bun test packages/types/src/connectPayoutContracts.test.ts` — 6 pass, 0 fail, 11 `expect()` calls before modifying `EdgeFunctionRegistry`.
- Phase 4 RED: `bun test packages/types/src/confirmShipmentContracts.test.ts` — 0 pass, 2 fail, 2 `expect()` calls because the new `confirm-shipment-delivery` entry was absent.
- Phase 4 GREEN: `bun test packages/types/src/confirmShipmentContracts.test.ts` — 2 pass, 0 fail, 2 `expect()` calls.
- The registry contract requires `orderId`, `shipmentId`, and `idempotencyKey`; successful responses preserve canonical completed status, completion source, and idempotency, while failures expose only `error`.
- Triangulation used separate request and response source-contract cases. Refactor was unnecessary because the registry addition is declarative.
- No remote SQL, deployment, generated-type regeneration, or `bun db:types` operation was performed in the Phase 4.1–4.3 apply batch. Task 4.4 was subsequently completed only after maintainer confirmation of remote SQL application and manual type generation.
- Settlement token retained by orchestrator: `sha256:9c87d7fd94ca2fc6949111f5ea14b3f3b77912f27cce4a6e2833f8ab8e9c7035`. This apply batch did not acquire or settle it.
- Evidence revision: `confirm-shipment-phase-4-r1`.
- Task 4.4 generated-schema verification: after the maintainer confirmed the remote migration and manual type generation, local read-only inspection found the exact migration contract in `packages/types/src/database.types.ts`: `shipments.buyer_confirmed_at`; `shipment_completion_events` fields and its profile/order/shipment relationships; and `fn_confirm_shipment_delivery` with all four canonical arguments and its `success`, `error`, `completion_source`, `idempotent` row return. `packages/types/src/index.ts` remains compatible through `Tables<'shipments'>` and the confirmation Edge Function registry. No generated file was manually edited and `bun db:types` was not rerun.
- Settlement token retained by orchestrator: `sha256:894dd9ae4b09aeb3e03ccf85fc0d4a55b26e6db26a82ff60b6a1c23e3f91e725`. This apply batch did not acquire, settle, or reset it.
- Evidence revision: `confirm-shipment-phase-4-r2`.
- Phase 5 RED: `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` — 0 pass, 1 fail, 1 error because `../../core/utils/shipment-confirmation` did not exist.
- Phase 5 GREEN: `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` — 4 pass, 0 fail, 19 `expect()` calls.
- The frontend builds `confirm_shipment_<shipmentId>` keys through the typed Edge Function registry, gates a confirmation to a buyer's delivered shipment with no active dispute, and has no `fn_confirm_delivery` fallback.
- Dialog copy now states that confirmation follows a carrier delivery mark and that the payout is released by Selene's admin process. The dialog retains its retry state after the hook surfaces an error toast.
- Local Expo runtime harness was blocked by an existing process on port 8081: `bun run start --offline` exited 1 because Expo needed an interactive decision to use port 8082. No process was stopped or reconfigured.
- Settlement token retained by orchestrator: `sha256:29f9262404cab4c5906daa0d7b490c5e3f806e67965048937623d288a93bb1ed`. This apply batch did not acquire, settle, or reset it.
- Evidence revision: `confirm-shipment-phase-5-r1`.
- Phase 5 recovery GREEN/REFACTOR: `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` — exit 0; 4 pass, 0 fail, 19 `expect()` calls; completed in 51.00ms under Bun 1.3.11 (`af24e281`). This independent second native attempt confirms the existing Phase 5 implementation without source changes; no refactor was necessary.
- Recovery token retained by orchestrator: `sha256:916dbe832d3b774b9e00ed7c6c3bdd352547356a2f3207e115f129ee439fd2d2`. This recovery did not acquire, settle, or reset it.
- Evidence revision: `confirm-shipment-phase-5-r2`.

## Task 6.3 Live SQL Evidence

The maintainer executed the exact read-only query in `deployment-handoff.md` and supplied the following result; no secrets were recorded:

```text
buyer_confirmed_at_exists=true
completion_events_table_exists=true
due_index_exists=true
canonical_rpc_exists=true
legacy_rpc_removed=true
completion_events_rls_enabled=true
anon_rpc_execution_revoked=true
service_role_rpc_execution_granted=true
```

This confirms only the deployed structural and function-grant state. It does not claim function deployments, Edge/Vault secret configuration, cron setup, RPC smoke tests, or provider validation.

## Remaining Deployment Actions

- Deploy `confirm-shipment-delivery`, then `complete-delivered-shipments` through the maintainer workflow.
- Configure the required Edge and Vault secrets, then create the authenticated five-minute cron schedule after its direct scheduler-authentication smoke check passes.
- Complete sandbox/manual buyer, scheduler, automatic-completion, race, Connect-accounting, and provider validation checks.
- Phase 6 handoff evidence: migration `supabase/migrations/20260903002546_confirm_shipment_hardening.sql` was maintainer-confirmed as manually applied; maintainer-confirmed manual type generation was independently structurally verified in `packages/types/src/database.types.ts` for `buyer_confirmed_at`, `shipment_completion_events`, and `fn_confirm_shipment_delivery`; the maintainer-supplied live SQL result confirms all eight structural/grant checks. No deployment, cron setup, secret configuration, RPC smoke, or provider validation evidence is claimed.
- Scheduler source verification: `supabase/functions/complete-delivered-shipments/index.ts` reads `req.headers.get('x-cron-secret')`, compares it to `Deno.env.get('CRON_SECRET')`, accepts only POST, and is reached at `/functions/v1/complete-delivered-shipments`. `supabase/config.toml` disables JWT verification only for unrelated functions, so the handoff retains gateway authentication with the Vault-held project anon JWT and never uses a service-role request header.
- Evidence revision: `confirm-shipment-phase-6-r1`.
- Native attempt token retained by orchestrator: `sha256:ff6d58072120672e14135adce7c66a1239f99d67e180fd2bcdc22e3db69a0861`. This apply batch did not acquire, settle, or reset it.
- Evidence revision: `sha256:edb2d7d6dfa1461bffbf010bf7052d74c9e6146808edbf1ecbfb55c31e73acc8`; this focused evidence correction remediates failed evidence revision `sha256:8b835669a1f673bc8cfdffe4c749bdb6a48b66a6acec3f4805f5675a1dad9c27`.
- Native token retained by orchestrator: `sha256:edb2d7d6dfa1461bffbf010bf7052d74c9e6146808edbf1ecbfb55c31e73acc8`. This focused remediation did not acquire, settle, or reset it.

## Focused Remediation: Resolved Dispute Confirmation Gate

- Scope: `apps/frontend/core/hooks/useShipments.ts` now derives an active dispute from generated `Enums<'dispute_status'>` values rather than from row existence. Unresolved `open`, `under_review`, `waiting_return`, `return_shipped`, and `return_delivered` statuses block buyer confirmation; `resolved` and `rejected` do not.
- RED: after adding the focused source-contract test first, `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` exited 1 with `4 pass`, `1 fail`, and `20 expect() calls`. The failing expectation received `undefined` for `ACTIVE_DISPUTE_STATUSES`, proving the partial `const activeDispute = isDispute;` implementation did not model unresolved statuses.
- GREEN: `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` exited 0 with `5 pass`, `0 fail`, and `24 expect() calls` under Bun `1.3.11 (af24e281)`.
- REFACTOR: none required; the correction is a single typed status allowlist and the focused test remains green.
- Rollback boundary: remove `ACTIVE_DISPUTE_STATUSES`, restore the previous dispute-presence gate, and remove the focused source-contract case together. That rollback restores the known incorrect behavior and is not recommended.
- Remaining runtime-evidence blocker: maintainer-environment Edge Function deployment, secret/cron configuration, RPC smoke tests, and provider validation remain unproven; this remediation makes no runtime claim.
- Next verify: rerun `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts`, then perform the pending maintainer runtime checks recorded in Remaining Deployment Actions.
- Native token retained by orchestrator: `sha256:16a332e7aa515b7d919d93b31dc465ba1be27902df430fc867bdc4f1919e7317`. This focused remediation did not acquire, settle, or reset it. Any passing settlement must remediate failed evidence revision `sha256:b738d7945d7a00a2bbd11cf3e4caea428cb8ec6e461ca6465aaef45360e3a379`.
