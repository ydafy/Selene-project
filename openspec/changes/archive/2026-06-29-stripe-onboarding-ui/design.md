# Design: Stripe Onboarding UI

## Technical Approach

Keep this change frontend-only and centered on one pure resolver. `profiles_private.stripe_onboarding_status = complete` becomes the highest known-status UI truth after auth. The screen will render one of four outcomes: auth required, initial loading, success, or guided wizard/final-step guidance. Hook changes only clear/suppress stale errors and invalidate the existing `connect-onboarding` query; no Stripe requirement mapping, payouts, migration, or backend contract expansion is included.

## Current Root-Cause Hypotheses to Verify

- `resolveConnectOnboardingUiState` currently checks `isLoading` before `isComplete`, so cached/known `complete` can be masked by loading.
- `visibleErrorKey = error ?? refreshError ?? statusError` is screen-local and not status-aware, so stale refresh/status errors can still render after complete.
- Stripe return params do not force the final step for non-complete sellers, leaving return UX dependent on the pre-return step.

## Architecture / State Model

Precedence in `resolveConnectOnboardingUiState`:

1. missing auth -> `auth-required`
2. known `status === 'complete'` or `isComplete` -> `success`
3. `isLoading && status == null` -> `loading`
4. non-complete + Stripe return -> `wizard` with `effectiveStep = lastStepIndex`
5. otherwise -> `wizard`

Visible errors move into a pure helper, e.g. `resolveConnectOnboardingVisibleError({ status, error, refreshError, statusError })`, returning `null` when `status === 'complete'`. Status-error display is allowed only when no complete status is known and the state is not initial success.

```text
Stripe return/focus/resume -> refreshFromStripe -> invalidate connect query
                               -> status/error helpers
                               -> onboarding screen outcome
```

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Pure resolver owns precedence | More helper tests, less screen branching | Choose: prevents future drift between screen and hook |
| Preserve `wallet:onboarding` namespace | Proposal mentioned sell files, but current UI already uses wallet keys | Choose: preserve namespace; require EN/ES parity |
| Frontend-only status handling | Less personalized than `currently_due` mapping | Choose: matches scope guard and review budget |
| Return forces final step | Adds `effectiveStep`/sync effect | Choose: non-complete return should show Done/Listo guidance |

## Affected Functions / Components

| File | Action | Description |
|---|---|---|
| `apps/frontend/core/utils/connectOnboardingUi.ts` | Modify | Add complete-before-loading precedence, `effectiveStep`, return-final-step flags, CTA/status guidance fields, visible-error helper. |
| `apps/frontend/core/utils/connectOnboardingUi.test.ts` | Modify | Cover precedence matrix, return final step, CTA keys, complete suppressing errors. |
| `apps/frontend/core/hooks/useConnectOnboarding.ts` | Modify | Clear refresh/start errors on complete responses and after query data becomes complete; keep query invalidation. |
| `apps/frontend/core/hooks/useConnectOnboarding.test.ts` | Modify | Extend pure helper tests for refresh/status error suppression; avoid RN render tests. |
| `apps/frontend/app/sell/onboarding.tsx` | Modify | Consume resolver fields, bypass stepper on success, force/show final step after return when non-complete. |
| `apps/frontend/components/features/onboarding/OnboardingSteps.tsx` | Modify | Let final step render status-specific guidance copy for not-started, pending, and rejected. |
| `apps/frontend/core/i18n/locales/en/wallet.json` | Modify | Add/adjust onboarding final-step/success/error/status copy. |
| `apps/frontend/core/i18n/locales/es/wallet.json` | Modify | Spanish parity for every changed key. |

## CTA Rules

- `null` / not-started: final step CTA = `start`; opens Stripe.
- `pending`: final step CTA = `continue`; opens Stripe without failure framing.
- `rejected`: final step CTA = `review`; opens Stripe with corrective guidance.
- `complete`: success view CTA only; no Stripe start/review CTA and no stepper.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | State precedence, visible-error derivation, CTA mapping, return final-step behavior | Bun tests for pure helpers in `connectOnboardingUi.test.ts` |
| Unit | Refresh-error suppression when complete | Existing `useConnectOnboarding.test.ts` helper tests |
| i18n | EN/ES key parity for new wallet onboarding keys | Add focused JSON key assertions if no existing wallet parity test exists |
| RN render | Not planned | Avoid heavy render tests unless an obvious harness already exists |

## Migration / Rollout / Rollback

No migration required. Roll out as a single frontend change. Rollback by reverting the screen, resolver, hook, tests, and wallet locale edits together; existing Edge Functions and deep links remain unchanged.

## Review Budget Risks

- Keep under ~400 reviewed lines by avoiding backend/types changes and large asset/copy expansion.
- Do not migrate namespaces from `wallet:onboarding`; migration would create noisy churn without product value.

## Open Questions

- None blocking.
