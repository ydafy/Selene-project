# Tasks: Stripe Onboarding UI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Resolver Precedence + Visible-Error Helper

- [x] 1.1 (RED) Write failing tests in `connectOnboardingUi.test.ts`: complete-beats-loading, complete-suppresses-error, return-forces-final-step, status-guidance/CTA mapping
- [x] 1.2 (GREEN) Reorder `resolveConnectOnboardingUiState` in `connectOnboardingUi.ts`: check `isComplete` before `isLoading` in viewState precedence
- [x] 1.3 Add `effectiveStep` field: when `isStripeReturn && !isComplete`, set to `lastStepIndex`
- [x] 1.4 Add `resolveConnectOnboardingVisibleError({status, error, refreshError, statusError})` helper returning `null` when `status === 'complete'`
- [x] 1.5 Add final-step status-guidance fields (`showStatusGuidance`, `statusGuidanceKey`) to the output state
- [x] 1.6 (REFACTOR) Run `bun test` on resolver — all existing + new tests pass

## Phase 2: Hook Error Cleanup

- [x] 2.1 (RED) Write tests in `useConnectOnboarding.test.ts` for error suppression when status=complete
- [x] 2.2 (GREEN) In `useConnectOnboarding.ts` refreshFromStripe: clear `error`+`refreshError` when response is complete
- [x] 2.3 Add effect on `status`+`isComplete`: clear `error`+`refreshError` when query data resolves to complete

## Phase 3: Final-Step Guidance UI

- [x] 3.1 Modify `OnboardingStep3` in `OnboardingSteps.tsx` to receive `status` prop
- [x] 3.2 Render status-specific icon+guidance for not-started (`null`), `pending`, `rejected`
- [x] 3.3 Keep existing guidance as default for unknown states

## Phase 4: i18n Keys

- [x] 4.1 Add final-step status-guidance keys to `en/wallet.json` (e.g. `onboarding.status.new`, `onboarding.status.pending`, `onboarding.status.rejected` guidance copy)
- [x] 4.2 Add matching keys to `es/wallet.json` for parity
- [x] 4.3 Verify EN/ES key parity — same keys present in both locale files

## Phase 5: Screen Integration

- [x] 5.1 In `onboarding.tsx`: replace inline `visibleErrorKey` derivation with `resolveConnectOnboardingVisibleError`
- [x] 5.2 Add effect: on `isStripeReturn && !isComplete`, force `currentStep` to last page index
- [x] 5.3 Pass status-guidance fields from resolver to `OnboardingStep3` via render context

## Phase 6: Verification

- [x] 6.1 Run `bun test` from project root — resolver + hook tests all green
- [x] 6.2 Run `cd apps/frontend && bunx tsc --noEmit` — accepted with documented baseline exception; no scoped `useConnectOnboarding.ts` errors remain
- [x] 6.3 Run `bun run lint` — accepted with documented baseline exception; targeted scoped lint passed
