```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:190ecc88e01d0907f995d74159b0b16cfe23aa9044fa215e5a41393b4584cbd0
verdict: fail
blockers: 2
critical_findings: 2
requirements: 8/8
scenarios: 0/0
test_command: bun test
test_exit_code: 1
test_output_hash: sha256:326a402bbcd398ab91c8b7a915a96cf4b1c9fd7686d6aaf3af8f0d5e2a243ce7
build_command: deno check --no-lock "supabase/functions/confirm-shipment-delivery/index.ts" "supabase/functions/complete-delivered-shipments/index.ts"
build_exit_code: 0
build_output_hash: sha256:35714d4b40ee1497b952e3fbe001ba35185a2189a79d7923c2a67433ba2e61de
```

## Verification Report

**Change:** confirm-shipment
**Mode:** Strict TDD; OpenSpec persistence; independent final verification
**Date:** 2026-09-07
**Checkout:** HEAD `02fb774576a346be74bd9e11bc7cbda126ab83c7` plus the pre-existing dirty worktree and untracked implementation files.

### Executive Summary

**FAIL.** The fresh focused run passes all 46 tests and both Edge entrypoints pass Deno checking. The maintainer's new completed-state retry, true concurrent buyer/scheduler race, Connect audit/non-mutation, and live payout observations close the previous remote financial and concurrency evidence gaps at the reported sandbox scope. However, the configured full `bun test` still exits 1, and the strict assertion audit identifies source-only tests that cannot count as behavioral TDD evidence. No implementation fix, tooling change, remote operation, RDD review, or native settlement was performed.

All six supplied context files were read directly: proposal, shipment delta spec, design, tasks, apply progress, and prior verification report. The deployment handoff and OpenSpec configuration were also read. The prior report is historical context, not a substitute for current command execution. Later maintainer evidence is explicitly attributed below rather than represented as verifier-observed remote execution.

### Completeness

| Metric | Result |
|---|---:|
| Tasks complete / total | 25/25 |
| Unchecked tasks | 0 |
| Native requirement headings, including removed fallback | 8 |
| Native scenario headings | 0 |
| Behavioral scenario rows in Markdown tables | 8 |
| Requirements supported at the assessed local/manual/structural layers | 8/8 |
| Behavioral table rows supported at the stated layers | 8/8 |

Native counts were checked against `### Requirement:` / `### REQ-<n>:` and `#### Scenario:` headings. Table rows are not native scenario headings. Requirement completion does not override command failures or Strict TDD findings, and does not claim exhaustive deployed negative-path coverage.

### Build, Tests, and Coverage Evidence

All commands ran from `C:\dev\School-portal`. Bun version: `1.3.11 (af24e281)`.

Output hashes are SHA-256 of the captured merged PowerShell stdout/stderr representation: convert each stream object with `ToString()`, join with LF without a final LF, then encode UTF-8. ANSI escapes and `System.Management.Automation.RemoteException` records are retained. Exit/hash metadata printed after capture is excluded. These are not claimed to be raw process-byte hashes.

| ID | Exact command | Exit | Fresh result | Output SHA-256 |
|---|---|---:|---|---|
| T1 | `bun test --coverage 'supabase/migrations/__tests__/confirm_shipment_hardening.test.ts' 'supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts' 'supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts' 'packages/types/src/confirmShipmentContracts.test.ts' 'apps/frontend/tests/orders/shipment-confirmation.test.ts' 'supabase/migrations/__tests__/connect_manual_payout_release.test.ts'` | 0 | 46 pass, 0 fail, 148 assertions, 6 files | `717b1eb208c2387ba6dc30056a682af043c2d55e2c9e0c041ce1fb15b4595c91` |
| T2 | `bun test` | 1 | 974 pass, 14 fail, 16 errors, 2436 assertions; 988 tests across 135 files | `326a402bbcd398ab91c8b7a915a96cf4b1c9fd7686d6aaf3af8f0d5e2a243ce7` |
| B1 | `deno check --no-lock "supabase/functions/confirm-shipment-delivery/index.ts" "supabase/functions/complete-delivered-shipments/index.ts"` | 0 | Both Edge entrypoints checked successfully | `35714d4b40ee1497b952e3fbe001ba35185a2189a79d7923c2a67433ba2e61de` |
| Q1 | `bunx --no-install tsc --noEmit -p 'packages/types/tsconfig.json'` | 2 | Cached TypeScript executable panicked before project checking: bundled `lib/lib.d.ts` does not exist | `bee4a6046d9a08acbbcebe2e088c79f591ba4707871acdd28c346105e96ad5b2` |
| T3 | `bun test 'apps/frontend/core/utils/imageReorder.test.ts' 'supabase/functions/_shared/__tests__/envia-shipping.test.ts'` | 1 | Bounded baseline/environment reproduction: 3 pass, 3 fail, 1 error, 5 assertions; 6 tests across 2 files | `6ee807d3eb964ff87f2ada62f195707619371ca1c986606bb38cd916c0e8c44f` |

Full-suite local transcript: `C:\Users\estra\.local\share\opencode\tool-output\tool_07eab1589001PfwCN7chWPAmdY`. This is an operational evidence locator, not a portable repository artifact. Sensitive fixture values are not reproduced here.

The evidence revision hashes the UTF-8, no-final-LF manifest `confirm-shipment|2026-09-07|strict-tdd|requirements=8|scenarios=0|focused=<T1 hash>|full=<T2 hash>|build=<B1 hash>|types=<Q1 hash>|baseline=<T3 hash>|maintainer=f62e6d6c856c9cbd845510605c6255ff838d89a97a0574fb52de8039e74dc611`, with the placeholders replaced by the exact hexadecimal hashes above. It identifies this evidence set, not a candidate-tree digest or settlement authority.

### Bounded Baseline and Environment Classification

Before T3, the exact command below exited 0 with no diff:

```text
git diff --exit-code HEAD -- 'apps/frontend/core/utils/imageReorder.ts' 'apps/frontend/core/utils/imageReorder.test.ts' 'supabase/functions/_shared/envia-shipping.ts' 'supabase/functions/_shared/__tests__/envia-shipping.test.ts'
```

`git ls-files --` with the same four paths confirmed all four are tracked. This establishes that the inspected production and test sources match HEAD; it does not establish a clean full-repository baseline.

| Failure class | Classification | Bounded evidence |
|---|---|---|
| Image reorder: moving up and first-item upper boundary | Verified HEAD-source baseline defect | T3 reproduces both assertions. The test imports only the unchanged pure `imageReorder` module and Bun. Tests pass `up`/`down`; implementation accepts `left`/`right`, treating any non-left value as right. No confirmation code is involved. |
| Envia helper import | Verified current environment/loader failure on unchanged source | T3 independently reproduces `Cannot find package 'npm:zod@3.23.8'` from unchanged `supabase/functions/_shared/envia-shipping.ts`. It fails before Envia test execution. This does not prove behavior under Deno. |
| Shared TypeScript tool | Environment/tool installation failure | Q1 panics in the cached compiler's bundled-library initialization before it can analyze the project. No project type correctness conclusion follows. |
| Cancellation preparing-window copy | Outside confirmation scope; not baseline-certified | T2 expects English and receives Spanish from the separately modified cancellation utility. |
| Deterministic UUID cutover handoff lookup | Outside confirmation scope; not baseline-certified | T2 attempts the former active-change runbook path after that separate change was archived. |
| Label authorization source ordering; reservation grants and reserve expression; checkout reset; prepare-screen source assertion | Outside the focused confirmation checks; not baseline-certified | Exact failures appear in T2. Several affected files already have unrelated worktree modifications. No clean-baseline run or repair was performed. |
| Order/review loader paths | Current missing-module/path failures; not all baseline-certified | T2 reports missing `../canReviewProduct`, a test-local `[id].tsx`, and incorrectly resolved `apps/app`, `apps/components`, and `apps/core` paths. |

No failure was observed in the five confirmation-focused files. That is not a blanket proof that every other failure is unrelated or pre-existing. The configured verification command remains failing; it was not replaced with a focused command to manufacture a passing envelope. Further lint/frontend build/type-check work was stopped after the out-of-scope failures, per repository scope discipline. T3 is the bounded classification specifically requested by the maintainer, not a correction/re-verification loop.

### Maintainer-Observed Remote Runtime Evidence

The following new evidence comes from the launch prompt. It was observed by the maintainer after the prior failed report and is associated with the reported passing remediation revision `sha256:f62e6d6c856c9cbd845510605c6255ff838d89a97a0574fb52de8039e74dc611`, remediating `sha256:cc3d34d2a93626f66c1fc211a3ffc090426450cc705190c7083328818f0e886e`. Settlement state is context only; the substantive observations below support the assessment. This verifier did not access the remote database, issue buyer/scheduler requests, or independently inspect a settlement ledger.

| ID | Passing manual check | Observed outcome / scope |
|---|---|---|
| M1 | Completed-state buyer retry | HTTP 200, `success=true`, `completionSource=buyer`, `idempotent=true`; event count 1; deprecated wallet release count 0. This exercises the already-completed canonical response, unlike a zero-row scheduler retry. |
| M2 | Connect accounting and already-released queue state | First shipment completed; `is_eligible=false`, reason `already_released`; positive amount; complete Connect onboarding; one Connect audit log; zero wallet mutations. An already-released shipment being ineligible is correct, not evidence of a completion defect. |
| M3 | True concurrent buyer/scheduler completion | On a second due delivered shipment, scheduler HTTP 200 with attempted 1, completed 1, failed 0; buyer HTTP 200 with success true, status completed, source auto, idempotent true. Database: completed, buyer timestamp NULL, exactly one completion event, source auto, actor NULL, zero deprecated wallet releases. |
| M4 | Unreleased completed shipment payout visibility | After M3, live payout eligibility true and no transfer released. This proves completion makes the fixture eligible without itself releasing a transfer. Together M2/M4 exercise released and unreleased queue states. |
| M5 | Cron restoration | Job 21, `complete-delivered-shipments`, schedule `*/5 * * * *`, restored to active true after the race. No configuration was changed by this verifier. |

Historical maintainer observations preserved in the directly read prior report remain separately attributed: migration applied before functions, type generation after SQL, eight all-true structural/grant checks, both functions deployed, missing/wrong cron-secret HTTP 401, automatic completion with auto/null actor/null buyer timestamp/single events, successful buyer UI completion with buyer timestamp/source/actor, and the parent order retaining the least-advanced shipment state. These historical checks were not re-executed locally or represented as fresh remote executions.

Provider limits remain explicit: the historical report describes sandbox labels and controlled signed tracking callbacks, not a new real-carrier delivery event for the manually delivered buyer fixture. This report is not unconditional production go-live approval. The handoff's old pending deployment/cron statements are superseded as observations by the later maintainer evidence, but those artifacts were not edited.

### Spec Compliance Matrix

File labels below identify the actual T1 tests: **buyer** = `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts`; **scheduler** = `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts`; **frontend** = `apps/frontend/tests/orders/shipment-confirmation.test.ts`; **migration** = `supabase/migrations/__tests__/confirm_shipment_hardening.test.ts`.

| Requirement | Behavioral table scenario | Passing runtime evidence | Assessment |
|---|---|---|---|
| Shipment Frontend Permissions | Gate after delivery | Frontend: `allows only buyers to confirm delivered shipments without an active dispute`; historical maintainer action lifecycle | COMPLIANT at helper/manual UI layers. Source copy checks are additional structural evidence only. |
| Confirmation Edge Function Boundary and Authorization | Successful confirmation | Buyer: producer UUID v5 parser/planner interaction, authentication/maintenance/ownership/isolation cases; historical successful buyer HTTP/UI/database flow and M1 | COMPLIANT at executed helper and reported deployed-success layers; direct authenticated RPC rejection has source/grant evidence, not a new negative HTTP test. |
| Delivered-Only and Dispute Gate | Confirm from delivered | Buyer: `allows only delivered shipments to reach the canonical RPC`, active-dispute rejection; historical manual delivered completion | COMPLIANT at helper/manual happy-path layers. |
| Connect Guard on Confirmation | Connect shipment | Historical manual Connect completion plus M2's one Connect audit and zero wallet mutations | COMPLIANT at maintainer-observed transactional scope; migration tests are source guards, not SQL execution. |
| Completion Semantics, Audit Source, and Idempotency | Manual completion | Historical explicit buyer timestamp/source/actor/single event; M1's completed-state idempotent retry | COMPLIANT. |
| Completion Semantics, Audit Source, and Idempotency | Automatic completion | Scheduler's executed exact-48-hour/1ms-early filter; M3's real race, auto source, null actor/timestamp, single event, idempotent buyer loser | COMPLIANT. M3, not the fabricated-result unit test, supplies concurrency evidence. |
| Legacy Path Retirement and Order Side Effects | Legacy and payout | Historical deployed legacy absence and aggregate order observation; M4 live eligible unreleased fixture and M2 already-released exclusion | COMPLIANT at reported deployed structural/manual queue layers. Legacy absence is a deployed structural check rather than a newly issued legacy mutation call. |
| Deployment and Provider Validation Boundary | Deploy and validate | Historical maintainer deployment/type-generation ordering; M1-M5 sandbox checks and restored cron; explicit provider/go-live boundary retained | COMPLIANT as a release-validation boundary, not a claim that all production provider behavior was validated. |

The removed **Order-Level Buyer Confirmation Fallback** requirement is supported by the executed source-removal guards, inspected `useOrderActions` routing, and historically reported deployed legacy absence. It contributes to the eight requirement headings but has no scenario row. Native scenarios remain 0/0; table rows are 8/8 supported at the expressly stated layers.

### Correctness: Static Evidence

| Requirement | Assessment | Inspected source |
|---|---|---|
| Frontend permissions/copy | Implemented | `useShipments.ts` uses unresolved dispute statuses and the delivered-only buyer utility; confirmation copy requires carrier delivery and describes admin payout release. |
| Edge authority | Implemented | Buyer entrypoint validates strict input, uses `auth.getUser`, derives order/shipment/dispute context server-side, checks the plan, and invokes the canonical service-role RPC. Migration revokes PUBLIC/anon/authenticated and grants service role. |
| Delivered/dispute gate | Implemented | Canonical SQL rechecks delivered status and unresolved disputes before first completion; helpers reject invalid states. |
| Connect wallet separation | Implemented | SQL reads Connect state from the shipment, writes wallets only in the non-Connect branch, and emits a Connect INFO system log in the other branch. |
| Audit, timestamps, idempotency | Implemented | `FOR UPDATE`, one unique completion event, stored winner-source response on completed retries, buyer-only timestamp assignment, due auto eligibility. |
| Legacy and aggregate effects | Implemented | Migration drops the old RPC; no frontend fallback; completion updates shipments rather than manually changing parent order/payout release. |
| Deployment boundary | Documented | Ordered handoff and retained production provider-validation caveat; generated column, ledger relationships, RPC signature, and registry were inspected. |
| Removed order fallback | Removed | Retired canonical source absent and source-removal test passes. |

### Design Coherence

| Decision | Followed? | Evidence / deviation |
|---|---|---|
| One canonical transaction for buyer and auto | Yes | Both endpoints invoke `fn_confirm_shipment_delivery`; migration/canonical bodies inspected; M3 confirms the reported race outcome. |
| Unique append-only completion provenance | Yes at intended application boundary | Unique shipment/key constraints, source/actor check, RLS and revoked client access; no completion-event updates in either writer. This is not a claim against a privileged database operator. |
| Connect separated from legacy wallet accounting | Yes | Separate SQL branches and M2 non-mutation/audit observation; live non-Connect accounting remains unobserved. |
| Bounded authenticated scheduler | Yes | POST and exact secret validation before service client/query; query and helper cap 100; due 48-hour filter. |
| Frontend shipment scope and retry | Yes | Required shipment payload and deterministic per-shipment key; invalidation remains shipment/order-scoped; completed-state retry returns stored source. |
| Validation approach | Partial | Planned SQL/declaration/source guards exist, but source inspection cannot satisfy the Strict TDD production-execution rule. No automated mounted UI/HTTP/SQL suite is available here. |
| Shared pure helpers location | Minor deviation | Helpers live beside their respective deployable endpoints rather than `_shared`; each is currently endpoint-local, with no cross-function helper reuse. |

### Strict TDD Compliance

Loaded and applied both `sdd-apply/strict-tdd.md` and `sdd-verify/strict-tdd-verify.md`. Strict mode stayed active; no Standard Mode fallback or retrospective test-first claim was made.

| Check | Result | Details |
|---|---|---|
| TDD Cycle Evidence present | PASS | Apply progress contains the table, historical missing-module/registry RED results, GREEN counts, and resolved-dispute remediation RED/GREEN. |
| Referenced focused test files exist | PASS, 5/5 | All five were read in full and executed in T1. |
| RED confirmed | PARTIAL historical evidence | Initial RED outcomes are recorded; Phase 1 corrective guards were added against already-existing implementation. Chronology was not recreated or manufactured now. |
| GREEN confirmed | PASS, 40/40 change tests | Buyer 16, scheduler 9, frontend 5, migration 8, registry 2; adjacent payout 6 brings T1 to 46. |
| Triangulation | PASS for tested helper branches | Distinct UUID/key, state, actor, dispute, source, timing, and batch-result inputs. Race-named unit test maps a supplied result and is not a concurrency test. |
| Safety net | WARNING | Registry safety net is recorded; several modified frontend paths had no pre-existing focused coverage. New files are untracked in this checkout; modified frontend hooks are tracked. |
| Literal evidence-table markers | WARNING | RED/GREEN prose does not follow the prescribed literal checkmark markers. Verification does not rewrite historical evidence. |
| Assertion quality | FAIL under Strict TDD | Twelve source-only test cases do not invoke their production behavior; see the explicit audit below. |

Three checks pass unqualified (table presence, referenced files, current GREEN), helper triangulation is supported, historical RED/safety-net/format limitations remain, and the assertion audit fails. A claim that all 25 tasks have complete runtime TDD cycles is not justified: generated-type inspection and deployment documentation are not authored runtime behavior, and structural guards must not be counted as executed production behavior.

### Test Layer Distribution

| Layer | Tests | Files / qualification |
|---|---:|---|
| Production helper/runtime contracts | 26 | Buyer 16, scheduler 8, frontend 2 across 3 files; includes actual checkout-producer/parser interaction. |
| Hybrid helper plus source assertions | 2 | Scheduler authorization ordering and frontend unresolved-dispute list cases. |
| Source/declaration guards | 12 | Migration 8, registry 2, frontend wiring/copy 2. Not runtime execution of SQL/declarations/UI. |
| Automated deployed integration/E2E | 0 | Maintainer-observed manual checks are separately reported, not included in automated counts. |
| Total change-focused | 40 | 5 unique files. |
| Adjacent payout checks | 6 | Separate source guards and a test-local payout mirror; excluded from production payout behavioral proof. |

Capabilities list Bun unit tests and no configured integration/E2E runner. No unavailable higher-layer runner was silently assumed.

### Assertion Quality Audit

All five change-focused test files and the adjacent payout file were read. No tautologies, possibly-empty assertion loops, or mock-heavy setup were found in the five focused files. The buyer error-code loop iterates a fixed non-empty literal list.

| File / lines | Finding | Severity / consequence |
|---|---|---|
| `supabase/migrations/__tests__/confirm_shipment_hardening.test.ts:19-133` | Eight tests read SQL and assert strings/regexes or file absence; none executes the transaction. | CRITICAL as behavioral TDD evidence under the explicit production-call rule. Useful planned structural guards, not proof of SQL behavior. |
| `packages/types/src/confirmShipmentContracts.test.ts:7-17` | Two tests inspect declaration text, not compilation or runtime production calls. | CRITICAL if counted as behavioral TDD evidence. Retain their valid structural-contract classification; Q1 did not complete compilation. |
| `apps/frontend/tests/orders/shipment-confirmation.test.ts:107-133` | Two wiring/copy tests inspect source/locales and never invoke the hook or render the screen. | CRITICAL under the production-call rule; these do not execute routing or UI behavior. Historical manual UI evidence is distinct. |
| `apps/frontend/tests/orders/shipment-confirmation.test.ts:44-74` | Source-extracted active-status list plus a real permission-helper call; no hook execution. | WARNING: implementation coupling; only the helper portion is behavioral. |
| `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts:148-164` | Source-offset comparison plus a real request-validator call; no endpoint execution. | WARNING: source ordering is not an HTTP authorization-before-effects test. |
| `supabase/migrations/__tests__/connect_manual_payout_release.test.ts:34-85,146-190` | Payout example calls a test-local mirror rather than the deployed view. | Excluded from production compliance; adjacent pre-existing evidence limitation, not a requested implementation fix. |

**Assertion quality:** one grouped CRITICAL finding spanning 12 source-only cases in 3 change-focused files, plus two hybrid-test coupling warnings. The initial design explicitly planned structural tests, but it cannot waive the active Strict TDD verifier's production-execution requirement. This fresh audit is reported as a verification-method finding, not as proof that the underlying SQL or UI is defective.

### Changed-File Coverage and Quality Metrics

| Instrumented changed production file | Line coverage | Branch coverage | Uncovered lines | Rating |
|---|---:|---|---|---|
| `apps/frontend/core/utils/shipment-confirmation.ts` | 69.05% | Not reported | 42-43, 59, 61-66, 68-71 | Low |
| `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.ts` | 86.24% | Not reported | 175-189 | Acceptable |
| `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.ts` | 100.00% | Not reported | None | Excellent |

Unweighted mean across these three instrumented changed production files: **85.10%**; **28 uncovered lines** in the reported ranges. Overall T1 coverage is 86.83%, but includes test files and the adjacent checkout producer and is not the change-production average. No threshold is configured. SQL, entrypoints, hooks, screen, locales, registry, and generated declarations lack meaningful line instrumentation in T1. Coverage is informational only.

**Type checking:** B1 passes for both Edge entrypoints. Q1 crashes before checking shared types. No frontend/shared-types success is claimed.
**Linter:** skipped after unrelated suite/tool failures, following the repository stop-and-report rule; no lint/config/formatter repairs were attempted.
**UI/build:** no fresh Expo runtime or production frontend build was run; historical UI observations are labeled as maintainer evidence. No remote schema/type generation was repeated.

### Issues

**CRITICAL / blockers**

1. **Configured full suite fails.** T2 exits 1 with 14 failures and 16 errors. T3 certifies a bounded HEAD-source image-reorder defect and current loader failure, but not all full-suite failures. The active verification contract makes a nonzero test exit critical; no scope waiver or alternate passing command was invented.
2. **Strict assertion-quality gate is not satisfied.** Twelve source-only cases do not execute their production behavior. They provide structural regression protection but cannot satisfy the strict behavioral TDD production-call rule. Reported manual checks close specific product-runtime gaps; they do not transform these source guards into runtime tests or establish complete historical TDD compliance.

**WARNING**

- Cached TypeScript tooling is unusable; shared/frontend type correctness is not freshly established.
- Frontend utility coverage is below 80%; hooks, entrypoints, SQL, and UI are not exercised by Bun source checks.
- The frontend toast helper checks `SHIPMENT_NOT_DELIVERED`, while the canonical state conflict is `SHIPMENT_NOT_IN_CONFIRMABLE_STATE`; the latter currently falls back to generic copy. This is a design/error-mapping limitation, not a new spec blocker because a dedicated state-error message is not specified.
- Historical RED/safety-net/literal-table-format evidence is incomplete; it was not rewritten.
- Apply progress and handoff contain stale pending-deployment statements; this report separates later observed runtime evidence without changing them.
- Deployed buyer negative authorization/state/dispute tests, a live 47h59m exclusion fixture, and non-Connect wallet accounting are not newly supplied. Local helper checks are not described as live SQL validation.
- The completed-state SQL branch returns before buyer-actor revalidation; the buyer Edge endpoint still verifies ownership and only service role can call the RPC. This is a defense-in-depth design limitation, not evidence of a client authorization bypass.

**SUGGESTION**

- Keep source guards explicitly classified as structural and add behavioral coverage only through a separately authorized implementation task, not this verifier.
- Retain the distinction between completion eligibility and admin transfer release; the two observed queue states are complementary, not contradictory.

### Final Verdict and Handoff

**FAIL — not archive-ready.** The previous missing retry/race/Connect/payout observations are now supplied and accepted at their reported sandbox scope. The remaining gate failures are the configured full-suite nonzero exit and strict assertion-quality finding, not the former absence of those remote observations.

The complete candidate report must pass `gentle-ai sdd-verify-validate --input <candidate-path> --requirements 8 --scenarios 0` before these exact bytes replace the canonical report. A valid failure report is persistable but not passing settlement evidence. The orchestrator owns the native attempt and all settlement decisions; this verifier does not settle, acquire, reset, initiate RDD/review, or start a correction loop. Escalate the bounded baseline/environment findings and strict evidence limitation for an explicit scope decision.
