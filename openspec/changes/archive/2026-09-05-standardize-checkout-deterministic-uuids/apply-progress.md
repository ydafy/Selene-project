# Apply Progress: Standardize Checkout Deterministic UUIDs

## Status

All 19 tasks are complete in Strict TDD mode. The producer now creates RFC 9562
UUID v5 values from the pinned checkout namespace and exact canonical names.
Strict confirmation validation remains unchanged; producer-driven contracts
prove its generated identifiers are accepted by confirmation and settlement.

**Routing**: Ready for re-verification. **Next recommended**: `sdd-verify`.

## Completed Tasks

- [x] 1.1–1.7 RED tests and producer-to-consumer contracts
- [x] 2.1–2.5 UUID v5 implementation, legacy helper removal, focused GREEN
- [x] 3.1–3.3 consumer contract verification and read-only consumer audit
- [x] 4.1–4.4 broader command evidence, runbook, and remote-operation stop

## TDD Cycle Evidence

| Task | Test File / Layer | Safety Net | RED | GREEN | REFACTOR |
|---|---|---|---|---|---|
| 1.1 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — missing UUID v5 export | ✅ Passed — golden vectors | Extracted pure `uuidV5` |
| 1.2 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — hash-shaped IDs rejected by strict consumer | ✅ Passed — Zod and regex assertions | Shared strict regex in test |
| 1.3 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — producer did not meet v5 contract | ✅ Passed — distinct/retry-stable product IDs | None needed |
| 1.4 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — UUID v5 producer contract absent | ✅ Passed — rebuilt full PI params deep-equal | Reused existing pure builder |
| 1.5 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — legacy SHA-256 fixture differs from v5 contract | ✅ Passed — fixed legacy incompatibility assertion | Legacy derivation stays test-only |
| 1.6 | `confirm-shipment-delivery.test.ts` / Unit contract | 15 passing | ✅ Written — `INVALID_REQUEST` from strict UUID parser | ✅ Passed — real producer IDs parse and build RPC input | No consumer changes |
| 1.7 | `single-modal-settlement.test.ts` / Unit contract | 42 passing | ✅ Written — pre-v5 producer violates v5 version assertion | ✅ Passed — producer metadata resolves and recovery outcome remains intact | No consumer changes |
| 2.1 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — SHA-1 namespace algorithm absent | ✅ Passed — 39 passing | Pure byte conversion and formatter |
| 2.2 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — canonical v5 names absent | ✅ Passed — golden vectors and PI equality | None needed |
| 2.3 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — legacy fixture proves old path differs | ✅ Passed — no obsolete production SHA-256 helpers | None needed |
| 2.4 | `single-payment-builder.test.ts` / Unit | 35 passing | ✅ Written — old deterministic fixture no longer conforms | ✅ Passed — UUID v5 vectors | None needed |
| 2.5 | `single-payment-builder.test.ts` / Unit | 35 passing | N/A | ✅ Passed — `39 pass, 0 fail` | N/A |
| 3.1 | `confirm-shipment-delivery.test.ts` / Unit contract | 15 passing | ✅ Written — strict parser rejected old producer ID | ✅ Passed — `16 pass, 0 fail` | N/A |
| 3.2 | `single-modal-settlement.test.ts` / Unit contract | 42 passing | ✅ Written — v5 version assertion rejected old producer ID | ✅ Passed — `43 pass, 0 fail` | N/A |
| 3.3 | Read-only audit | N/A | N/A | Audited with no consumer edits | N/A |
| 4.1 | Broader commands | N/A | N/A | Commands executed; unrelated baseline failures recorded | N/A |
| 4.2 | Deno quality commands | N/A | N/A | Commands executed; baseline environment/style failures recorded | N/A |
| 4.3 | `cutover-runbook.md` / Documentation | N/A | N/A | Maintainer-only runbook written | N/A |
| 4.4 | Process boundary | N/A | N/A | No remote command, deploy, SQL, or type generation executed | N/A |

## Verification Remediation Evidence

This bounded remediation addresses failed verification evidence revision
`sha256:33472798e89f0b3621de36b84fed841c23f13e8bcf95c18c97eb0ccdfd3516a3`.

| Contract | RED | GREEN |
|---|---|---|
| Stripe retry boundary | ✅ Written — `createSinglePaymentIntent` export was absent and the focused suite failed to load | ✅ Passed — a fake local Stripe client received two byte-identical parameter objects and the same `selene_pi_checkout-retry-key` option while creating one local PaymentIntent object |
| UUID and cutover static contract | ✅ Written — source/runbook contract test was added | ✅ Passed — namespace, canonical templates, adapter wiring, sandbox-only, fresh-key, and approved-production-migration guards pass without remote access |
| Settlement recovery mapping | ✅ Written — fixture-only assertion was replaced with real producer metadata reassembly | ✅ Passed — checkout producer metadata reassembles to the same UUID v5 shipment/product mapping before settlement recovery handling |

- Focused remediation command: `bun test supabase/functions/create-connect-payment/single-payment-builder.test.ts supabase/functions/create-connect-payment/deterministic-uuid-cutover.contract.test.ts supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` → `102 pass, 0 fail`.
- Focused lint command: `bunx eslint` on the five changed TypeScript files → no output, exit 0.
- `git diff --check` completed with exit 0; it emitted only pre-existing CRLF conversion warnings for unrelated files.
- Targeted `deno check` remains blocked before source diagnostics because the environment cannot resolve `npm:@types/node`; no configuration was changed.
- No remote Supabase, Stripe, Envia, SQL, deployment, secret, cron, webhook, or generated-type operation occurred. Sandbox deployment smoke remains maintainer-only and pending under `cutover-runbook.md`.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused producer test | `bun test supabase/functions/create-connect-payment/single-payment-builder.test.ts` → `39 pass, 0 fail` |
| Focused confirmation contract | `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` → `16 pass, 0 fail` |
| Focused settlement contract | `bun test supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` → `43 pass, 0 fail` |
| Runtime harness | N/A — pure producer and consumer-contract tests exercise the available local runtime boundary; remote sandbox steps are deliberately maintainer-only in `cutover-runbook.md`. |
| Rollback boundary | Revert `single-payment-builder.ts`, its three focused test files, and `cutover-runbook.md`; no schema, consumer behavior, generated type, or remote state change was made by this apply work unit. |

## Broader Verification

- `bun test` executed: `973 pass, 11 fail, 16 errors` across 134 files. Failures are outside this change, including missing `npm:zod@3.23.8` in shared Envia tests, reservation SQL expectation drift, frontend path fixtures, and image reorder behavior.
- `bun run lint` executed: failed on generated `apps/admin-web/dist/assets/index-Bx_GP8zs.js`; no errors were reported for this change's TypeScript files. Focused ESLint completed with no output.
- `deno fmt --check` executed on the producer and read-only entry point: both have pre-existing repository-wide Deno formatting differences.
- `deno lint` executed: read-only entry point has four existing inline import-prefix findings.
- `deno check` executed for both producer files: blocked because Deno cannot resolve installed `npm:@types/node`. No configuration was changed.

## Deployment Handoff

The maintainer must follow `cutover-runbook.md`. It names the only SQL artifact,
`supabase/queries/maintenance/reset-prelaunch-order-test-data.sql`, after a
successful `create-connect-payment` sandbox deployment. No agent remote
operation, Stripe/Envia operation, secret/configuration change, webhook/cron
change, or `bun db:types` command occurred.
