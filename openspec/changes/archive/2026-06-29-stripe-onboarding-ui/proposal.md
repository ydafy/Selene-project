# Proposal: Stripe Onboarding UI

## Intent

Fix the Connect onboarding return flow so `profiles_private.stripe_onboarding_status = complete` is treated as source of truth. Today, a seller can return from Stripe, the DB can already be complete, and the app still shows an error / wizard state instead of the activated success screen.

## Scope

### In Scope
- Resolve state precedence across return params, refresh results, cached DB status, and visible error selection.
- Show a dedicated activated/success view when onboarding is complete, with a clear CTA to continue selling / create a listing.
- Keep incomplete/pending states on the final stepper step (`Done/Listo`) with non-blocking status guidance.

### Out of Scope
- Manual payouts and `connect-manual-payout-release`.
- `stripe-connect-migration`.
- New backend capability for `currently_due` / richer Stripe requirement mapping.

## Capabilities

### New Capabilities
- `stripe-onboarding-ui`: seller onboarding screen, stepper guidance, Stripe return UX, and activated state.

### Modified Capabilities
- `connect-onboarding-sync`: state precedence must prefer DB complete over transient refresh failures and avoid surfacing blocking errors after a successful return.

## Approach

Frontend-first V1 in `apps/frontend`: make `useConnectOnboarding` + `resolveConnectOnboardingUiState` prioritize complete status, then simplify `app/sell/onboarding.tsx` into three outcomes: guided wizard, pending/final-step review, or activated success. Keep i18n keys in `en/es` sell namespaces and preserve existing deep-link refresh behavior.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/frontend/app/sell/onboarding.tsx` | Modified | Render success-only state and final-step pending UX |
| `apps/frontend/core/hooks/useConnectOnboarding.ts` | Modified | Align refresh/error handling with DB-complete precedence |
| `apps/frontend/core/utils/connectOnboardingUi.ts` | Modified | Centralize view-state precedence and CTA rules |
| `apps/frontend/core/i18n/locales/en/sell.json` | Modified | Add onboarding guidance/success copy |
| `apps/frontend/core/i18n/locales/es/sell.json` | Modified | Keep locale parity |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Error banner still wins over success | Med | Make complete-status precedence explicit in one resolver |
| Copy sounds prescriptive or risky | Med | Use conditional, non-legal wording |
| Review scope grows past 400 lines | Med | Keep V1 frontend-only and avoid backend contract changes |

## Rollback Plan

Revert the onboarding screen, hook, resolver, and i18n changes together. The existing deep-link and refresh flow remains intact, so rollback restores the previous wizard behavior without schema or function changes.

## Dependencies

- Existing `get-seller-onboarding` and `refresh-connect-account-status` behavior.

## Success Criteria

- [ ] DB-complete sellers always land on the activated/success screen after return or refresh.
- [ ] Pending/incomplete sellers see status on the final step instead of a confusing dead-end.
- [ ] No blocking error is shown when status is complete.
- [ ] English and Spanish copy stays in sync.
- [ ] Proposal stays bounded for a small V1 review.
