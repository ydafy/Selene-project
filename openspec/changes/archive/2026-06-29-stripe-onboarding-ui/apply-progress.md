# Apply Progress: Stripe Onboarding UI

## Summary

Implemented the frontend onboarding state cleanup for `stripe-onboarding-ui`.

- DB `complete` status now wins over loading, Stripe return params, and stale errors.
- Non-complete Stripe returns resolve to the final `Done/Listo` step.
- Visible onboarding errors are status-aware and hidden for `complete`.
- Final-step guidance covers not-started, pending, and rejected states.
- Success CTA routes to the explicit selling entry point `/sell`.
- EN/ES wallet onboarding status-guidance keys stay in parity.
- Added `refresh-connect-account-status` to the shared Edge Function registry for typed frontend refresh responses.

## TDD Cycle Evidence

| Task | Test File | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Resolver precedence and visible errors | `apps/frontend/core/utils/connectOnboardingUi.test.ts` | Failing tests for complete-over-loading, complete-over-errors, return final step, guidance mapping | Resolver precedence, `effectiveStep`, visible-error helper implemented | Cases cover `complete`, `pending`, `rejected`, `null`, return params, CTA route | Focused resolver suite passed |
| Hook stale error cleanup | `apps/frontend/core/hooks/useConnectOnboarding.test.ts` | Failing helper tests for complete status clearing stale errors | Hook helper/effect clears `error` and `refreshError` when status is complete | Cases cover complete suppression and pending preservation | Focused hook suite passed |
| i18n parity | `apps/frontend/core/i18n/walletOnboardingLocaleParity.test.ts` | Failing parity check for new status guidance keys | EN/ES wallet onboarding keys added | Checks every status-guidance key in both locales | Focused i18n suite passed |
| Success CTA route | `apps/frontend/core/utils/connectOnboardingUi.test.ts` | Review finding: `router.back()` was history-dependent | Added `CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE = '/sell'` and screen uses `router.replace` | Test asserts explicit route contract | Focused resolver suite and targeted ESLint passed |
| Edge refresh response typing | `packages/types/src/connectPayoutContracts.test.ts` | Type-check reported missing `refresh-connect-account-status` registry entry | Registry payload/response contract added | Contract test covers cached complete response shape | Focused type contract test added |

## Verification Commands

- `bun test apps/frontend/core/utils/connectOnboardingUi.test.ts`
- `bun test apps/frontend/core/hooks/useConnectOnboarding.test.ts`
- `bun test apps/frontend/core/i18n/walletOnboardingLocaleParity.test.ts`
- `bun test packages/types/src/connectPayoutContracts.test.ts`
- Targeted ESLint for scoped onboarding files passed during apply/review.

## Known Baseline Notes

- Broad frontend type-check had unrelated baseline errors outside this change during initial verification.
- Root lint has generated `apps/admin-web/dist` noise unrelated to this change.
