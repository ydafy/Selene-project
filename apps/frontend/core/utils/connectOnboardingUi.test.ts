import { describe, expect, it } from 'bun:test';

import {
  CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE,
  resolveConnectOnboardingUiState,
  resolveConnectOnboardingVisibleError,
  type ResolveConnectOnboardingUiInput,
} from './connectOnboardingUi';

const baseInput: ResolveConnectOnboardingUiInput = {
  userId: 'user-1',
  currentStep: 0,
  lastStepIndex: 3,
  status: null,
  isComplete: false,
  isLoading: false,
  isStarting: false,
  isRefreshingFromStripe: false,
  isStripeReturn: false,
};

const resolveUi = (overrides: Partial<ResolveConnectOnboardingUiInput> = {}) =>
  resolveConnectOnboardingUiState({ ...baseInput, ...overrides });

describe('resolveConnectOnboardingUiState', () => {
  it('routes the success CTA to the explicit selling entry point', () => {
    expect(CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE).toBe('/sell');
  });

  it('returns the auth-required state before enabling the wizard', () => {
    const state = resolveUi({ userId: undefined });

    expect(state.viewState).toBe('auth-required');
    expect(state.showNext).toBe(false);
    expect(state.showStartCta).toBe(false);
    expect(state.showBack).toBe(false);
  });

  it('keeps initial loading non-interactive', () => {
    const state = resolveUi({ isLoading: true });

    expect(state.viewState).toBe('loading');
    expect(state.isNavigationDisabled).toBe(true);
    expect(state.nextDisabled).toBe(true);
    expect(state.ctaDisabled).toBe(true);
    expect(state.nextLoading).toBe(true);
  });

  it('shows success when complete status is known during loading or Stripe return', () => {
    const state = resolveUi({
      status: 'complete',
      isComplete: true,
      isLoading: true,
      isStripeReturn: true,
    });

    expect(state.viewState).toBe('success');
    expect(state.showNext).toBe(false);
    expect(state.showStartCta).toBe(false);
    expect(state.effectiveStep).toBe(0);
  });

  it('returns the complete success state without wizard actions', () => {
    const state = resolveUi({ status: 'complete', isComplete: true });

    expect(state.viewState).toBe('success');
    expect(state.showNext).toBe(false);
    expect(state.showStartCta).toBe(false);
    expect(state.showRejectedBanner).toBe(false);
  });

  it('shows rejected banner and review CTA on the final step', () => {
    const state = resolveUi({ currentStep: 3, status: 'rejected' });

    expect(state.viewState).toBe('wizard');
    expect(state.showRejectedBanner).toBe(true);
    expect(state.showStartCta).toBe(true);
    expect(state.ctaKey).toBe('review');
  });

  it('maps pending and null statuses to the expected final CTA', () => {
    expect(resolveUi({ currentStep: 3, status: 'pending' }).ctaKey).toBe(
      'continue',
    );
    expect(resolveUi({ currentStep: 3, status: null }).ctaKey).toBe('start');
  });

  it('forces non-complete Stripe returns to the final step', () => {
    const state = resolveUi({
      currentStep: 1,
      status: 'pending',
      isStripeReturn: true,
    });

    expect(state.viewState).toBe('wizard');
    expect(state.effectiveStep).toBe(3);
    expect(state.isFinalStep).toBe(true);
    expect(state.showStartCta).toBe(true);
    expect(state.ctaKey).toBe('continue');
  });

  it('maps final-step status guidance for not-started, pending, and rejected states', () => {
    expect(resolveUi({ currentStep: 3, status: null })).toMatchObject({
      showStatusGuidance: true,
      statusGuidanceKey: 'new',
      ctaKey: 'start',
    });
    expect(resolveUi({ currentStep: 3, status: 'pending' })).toMatchObject({
      showStatusGuidance: true,
      statusGuidanceKey: 'pending',
      ctaKey: 'continue',
    });
    expect(resolveUi({ currentStep: 3, status: 'rejected' })).toMatchObject({
      showStatusGuidance: true,
      statusGuidanceKey: 'rejected',
      ctaKey: 'review',
    });
  });

  it('gates Stripe start behind the final step', () => {
    expect(resolveUi({ currentStep: 2 }).showNext).toBe(true);
    expect(resolveUi({ currentStep: 2 }).showStartCta).toBe(false);
    expect(resolveUi({ currentStep: 3 }).showNext).toBe(false);
    expect(resolveUi({ currentStep: 3 }).showStartCta).toBe(true);
  });

  it('tracks next and back availability from the current step', () => {
    expect(resolveUi({ currentStep: 0 }).showBack).toBe(false);
    expect(resolveUi({ currentStep: 0 }).showNext).toBe(true);
    expect(resolveUi({ currentStep: 1 }).showBack).toBe(true);
    expect(resolveUi({ currentStep: 1 }).showNext).toBe(true);
  });

  it('shows the Stripe return refresh message only while refreshing after return', () => {
    expect(
      resolveUi({ isStripeReturn: true, isRefreshingFromStripe: true })
        .showStripeReturnRefreshMessage,
    ).toBe(true);
    expect(
      resolveUi({ isStripeReturn: true, isRefreshingFromStripe: false })
        .showStripeReturnRefreshMessage,
    ).toBe(false);
    expect(
      resolveUi({ isStripeReturn: false, isRefreshingFromStripe: true })
        .showStripeReturnRefreshMessage,
    ).toBe(false);
  });
});

describe('resolveConnectOnboardingVisibleError', () => {
  it('suppresses all visible errors when status is complete', () => {
    expect(
      resolveConnectOnboardingVisibleError({
        status: 'complete',
        error: 'onboardingUrlUnavailable',
        refreshError: 'refreshFailed',
        statusError: 'statusUnavailable',
      }),
    ).toBeNull();
  });

  it('keeps actionable error precedence for non-complete statuses', () => {
    expect(
      resolveConnectOnboardingVisibleError({
        status: 'pending',
        error: null,
        refreshError: 'refreshFailed',
        statusError: 'statusUnavailable',
      }),
    ).toBe('refreshFailed');
    expect(
      resolveConnectOnboardingVisibleError({
        status: null,
        error: 'onboardingUrlUnavailable',
        refreshError: 'refreshFailed',
        statusError: 'statusUnavailable',
      }),
    ).toBe('onboardingUrlUnavailable');
  });
});
