# Apply Progress: Connect Onboarding Status Sync

## Mode

Strict TDD. Delivery mode is `size:exception` approved by maintainer for this cohesive change despite the review workload forecast.

## Completed Tasks

- [x] 1.1 Add `stripe_onboarding_refreshed_at` migration.
- [x] 1.2 Run `bun db:types`; manually reapplied the pending migration column to generated types because the remote project has not applied the new migration yet.
- [x] 1.3 Register `refresh-connect-account-status` in `EdgeFunctionRegistry`.
- [x] 1.4 Add shared `normalizeAccountStatus()` helper.
- [x] 1.5 Add normalization unit tests.
- [x] 2.1 Add `refresh-connect-account-status` Edge Function and testable core reconciler.
- [x] 2.2 Replace hardcoded Connect onboarding return/refresh defaults with client-provided or env/mobile fallbacks.
- [x] 2.3 Update `account.updated` webhook to use shared status normalization and set refreshed timestamp.
- [x] 2.4 Add refresh reconciler unit tests for throttle/auth/status/error behavior.
- [x] 3.1 Add Android `selene://sell/onboarding` intent filter.
- [x] 3.2 Wire frontend focus/resume/link-return refresh and remove 3s polling.
- [x] 3.3 Show return checking and stale-cache refresh errors on onboarding screen.
- [x] 3.4 Add admin `refreshSeller()` mutation.
- [x] 3.5 Add per-row admin “Refresh from Stripe” action.
- [x] 4.1 Normalize helper tests pass.
- [x] 4.2 Refresh reconciler tests pass.
- [x] 5.1 Add `connect-onboarding-return` HTTPS redirect bridge for Stripe AccountLink return/refresh URLs.
- [x] 5.2 Update `create-connect-account` so Stripe-facing return/refresh URLs are always HTTPS unless the function fails safely before calling Stripe.
- [x] 5.3 Add targeted URL resolver and redirect bridge tests.

## Remaining Verification

- [ ] 4.3 Webhook `account.updated` end-to-end verification in Supabase/Stripe runtime.
- [ ] 4.4 Manual Stripe test-mode onboarding E2E.
- [ ] 4.5 Manual admin refresh confirmation against deployed Edge Function.
- [ ] 5.4 Deploy bridge + updated AccountLink function and rerun onboarding against a fresh/alternate seller account.

## TDD Cycle Evidence

| Task     | Test File                                                                                                                                                     | Layer      | Safety Net                                                  | RED                                                                         | GREEN                                           | TRIANGULATE                                                                                      | REFACTOR                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1.1      | N/A                                                                                                                                                           | Structural | N/A (new migration)                                         | N/A                                                                         | ✅ Migration added                              | ➖ Structural                                                                                    | ➖ None needed                                         |
| 1.2      | `packages/types` typecheck                                                                                                                                    | Type       | N/A                                                         | N/A                                                                         | ✅ `bun db:types` run; package typecheck passed | ➖ Structural                                                                                    | ✅ Manual pending-column patch after remote generation |
| 1.3      | Type contract via compile/lint                                                                                                                                | Type       | N/A                                                         | N/A                                                                         | ✅ Registry updated                             | ➖ Structural                                                                                    | ➖ None needed                                         |
| 1.4-1.5  | `supabase/functions/_shared/connect-status.test.ts`                                                                                                           | Unit       | N/A (new)                                                   | ✅ Missing helper failed                                                    | ✅ Passed                                       | ✅ v1, camelCase, disabled_reason, missing fields                                                | ✅ Shared pure helper                                  |
| 2.1, 2.4 | `supabase/functions/refresh-connect-account-status/refresh-connect-account-status.test.ts`                                                                    | Unit       | N/A (new)                                                   | ✅ Missing reconciler failed                                                | ✅ Passed                                       | ✅ throttle, admin force, 403, rejected, Stripe failure                                          | ✅ DI-based pure reconciler plus thin Edge handler     |
| 2.2      | `supabase/functions/create-connect-account/connect-onboarding-urls.test.ts`                                                                                   | Unit       | Existing helper absent                                      | ✅ Missing URL resolver failed                                              | ✅ Passed                                       | ✅ client URL, env fallback, mobile fallback                                                     | ✅ Extracted URL resolver                              |
| 2.3      | `supabase/functions/_shared/connect-status.test.ts`                                                                                                           | Unit       | Existing webhook logic preserved by shared helper tests     | ✅ New shared behavior tests failed before helper                           | ✅ Passed                                       | ✅ complete/rejected/pending branches                                                            | ✅ Webhook delegates to helper                         |
| 3.1      | N/A                                                                                                                                                           | Structural | N/A                                                         | N/A                                                                         | ✅ Intent filter added                          | ➖ Structural                                                                                    | ➖ None needed                                         |
| 3.2-3.3  | `apps/frontend/core/utils/connectOnboardingUrls.test.ts`                                                                                                      | Unit       | Existing hook had no focused tests                          | ✅ Missing URL helpers failed                                               | ✅ Passed                                       | ✅ deep-link builder and URL matcher branches                                                    | ✅ Extracted pure URL helpers; hook remains thin       |
| 3.4-3.5  | `apps/admin-web/src/lib/connectOnboarding.test.ts` + targeted lint                                                                                            | Unit/Lint  | ✅ Existing admin helper tests passed in targeted run       | ✅ Mutation/UI implemented against typed registry                           | ✅ Targeted lint passed                         | ➖ Component behavior not directly unit-tested                                                   | ✅ Single hook invocation after refactor               |
| 4.1-4.2  | Targeted `bun test` command                                                                                                                                   | Unit       | N/A                                                         | ✅ Failing red tests captured                                               | ✅ 19/19 passed                                 | ✅ Covered listed branches                                                                       | ✅ Lint clean                                          |
| 5.1-5.3  | `supabase/functions/create-connect-account/connect-onboarding-urls.test.ts`, `supabase/functions/connect-onboarding-return/connect-onboarding-return.test.ts` | Unit       | ✅ Existing helper allowed raw `selene://` AccountLink URLs | ✅ Updated tests assert HTTPS Stripe-facing URLs and bridge redirect states | ✅ Targeted tests passed                        | ✅ Client HTTPS, deep-link conversion, HTTPS tunnel override, production override, invalid state | ✅ Bridge target isolated behind env comments          |

## Test Summary

- **Current bugfix targeted tests passing**: 16
- **Previously recorded targeted tests passing before this bugfix**: 19
- **Layers used**: Unit only (project has no integration/E2E tooling configured)
- **Approval tests**: Existing `apps/admin-web/src/lib/connectOnboarding.test.ts` retained and passed
- **Pure functions created**: `normalizeAccountStatus`, `refreshConnectAccountStatus`, `resolveConnectOnboardingUrls`, `resolveConnectOnboardingRedirect`, `buildConnectOnboardingDeepLinks`, `isConnectOnboardingUrl`, `shouldAttemptConnectStatusRefresh`

## Checks Run

- `bun test "supabase/functions/_shared/connect-status.test.ts" "supabase/functions/refresh-connect-account-status/refresh-connect-account-status.test.ts" "supabase/functions/create-connect-account/connect-onboarding-urls.test.ts" "apps/frontend/core/utils/connectOnboardingUrls.test.ts" "apps/admin-web/src/lib/connectOnboarding.test.ts"` — passed, 19 tests.
- `bun test "supabase/functions/create-connect-account/connect-onboarding-urls.test.ts" "supabase/functions/connect-onboarding-return/connect-onboarding-return.test.ts" "apps/frontend/core/utils/connectOnboardingUrls.test.ts"` — passed, 16 tests.
- `deno check "supabase/functions/connect-onboarding-return/index.ts"` — passed.
- `deno check "supabase/functions/create-connect-account/index.ts"` — failed on existing Deno/npm type resolution: `Could not find a matching package for 'npm:@types/node' in the node_modules directory`.
- Targeted `bunx eslint` over changed TypeScript files — passed.
- `bunx tsc --noEmit` in `packages/types` — passed.
- `bun db:types` — ran; remote schema does not yet include the new migration column, so the pending generated type field was restored manually to match the migration in this branch.
- `bunx tsc --noEmit` in `apps/frontend` — failed on pre-existing workspace issues including Bun test globals and legacy `EnrichedOrder.items/dispute` references.
- `bunx tsc -b` in `apps/admin-web` — failed on pre-existing unrelated files: `useAdminProduct.ts`, `usePendingProducts.ts`, `useProductLock.ts`, `DisputeDetailPage.tsx`.

## Deviations

- Full webhook and mobile/admin E2E verification remain manual/deployment checks; they are not marked complete in `tasks.md`.
- Frontend/admin behavior tests were kept at pure-helper and lint level because this repo has no configured React Native or React component integration test layer.
