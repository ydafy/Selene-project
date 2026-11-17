import { describe, expect, it } from 'bun:test';

import {
  CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE,
  resolveConnectOnboardingStripeReturn,
  resolveConnectOnboardingUiState,
  resolveConnectOnboardingVisibleError,
  type ResolveConnectOnboardingUiInput,
} from './connect-onboarding-ui';

const baseInput: ResolveConnectOnboardingUiInput = {
  userId: 'user-1',
  status: null,
  isComplete: false,
  isLoading: false,
  isStarting: false,
  isRefreshingFromStripe: false,
  stripeReturn: null,
};

const resolveUi = (overrides: Partial<ResolveConnectOnboardingUiInput> = {}) =>
  resolveConnectOnboardingUiState({ ...baseInput, ...overrides });

describe('resolveConnectOnboardingUiState', () => {
  it('routes the success CTA to the explicit selling entry point', () => {
    expect(CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE).toBe('/sell');
  });

  it('returns the auth-required state without the Stripe CTA', () => {
    const state = resolveUi({ userId: undefined });

    expect(state.viewState).toBe('auth-required');
    expect(state.showStartCta).toBe(false);
    expect(state.statusNoticeKey).toBeNull();
  });

  it('keeps initial loading non-interactive', () => {
    const state = resolveUi({ isLoading: true });

    expect(state.viewState).toBe('loading');
    expect(state.ctaDisabled).toBe(true);
    expect(state.ctaLoading).toBe(true);
  });

  it('shows success when complete status is known during loading or a Stripe return', () => {
    for (const stripeReturn of ['return', 'refresh'] as const) {
      const state = resolveUi({
        status: 'complete',
        isComplete: true,
        isLoading: true,
        stripeReturn,
      });

      expect(state.viewState).toBe('success');
      expect(state.showStartCta).toBe(false);
      expect(state.statusNoticeKey).toBeNull();
    }
  });

  it('shows the guide with the start CTA and no notice for a new seller', () => {
    expect(resolveUi()).toMatchObject({
      viewState: 'guide',
      showStartCta: true,
      statusNoticeKey: null,
      ctaKey: 'start',
    });
  });

  it('maps pending and rejected statuses to their notice and CTA', () => {
    expect(resolveUi({ status: 'pending' })).toMatchObject({
      viewState: 'guide',
      statusNoticeKey: 'pending',
      ctaKey: 'continue',
    });
    expect(resolveUi({ status: 'rejected' })).toMatchObject({
      viewState: 'guide',
      statusNoticeKey: 'rejected',
      ctaKey: 'review',
    });
  });

  it('shows the expired-link notice and continue CTA on a refresh return', () => {
    expect(resolveUi({ stripeReturn: 'refresh' })).toMatchObject({
      viewState: 'guide',
      statusNoticeKey: 'expired',
      ctaKey: 'continue',
    });
    expect(
      resolveUi({ stripeReturn: 'refresh', status: 'pending' }),
    ).toMatchObject({ statusNoticeKey: 'expired', ctaKey: 'continue' });
  });

  it('keeps the rejected notice over an expired link', () => {
    expect(
      resolveUi({ stripeReturn: 'refresh', status: 'rejected' }),
    ).toMatchObject({ statusNoticeKey: 'rejected', ctaKey: 'review' });
  });

  it('does not show the expired notice on a normal return', () => {
    expect(resolveUi({ stripeReturn: 'return' }).statusNoticeKey).toBeNull();
    expect(
      resolveUi({ stripeReturn: 'return', status: 'pending' }).statusNoticeKey,
    ).toBe('pending');
  });

  it('disables the CTA while starting or refreshing', () => {
    expect(resolveUi({ isStarting: true }).ctaDisabled).toBe(true);
    expect(resolveUi({ isRefreshingFromStripe: true }).ctaLoading).toBe(true);
    expect(resolveUi().ctaDisabled).toBe(false);
  });

  it('shows the Stripe return refresh message only while refreshing after a return', () => {
    expect(
      resolveUi({ stripeReturn: 'return', isRefreshingFromStripe: true })
        .showStripeReturnRefreshMessage,
    ).toBe(true);
    expect(
      resolveUi({ stripeReturn: 'refresh', isRefreshingFromStripe: true })
        .showStripeReturnRefreshMessage,
    ).toBe(true);
    expect(
      resolveUi({ stripeReturn: 'return', isRefreshingFromStripe: false })
        .showStripeReturnRefreshMessage,
    ).toBe(false);
    expect(
      resolveUi({ stripeReturn: null, isRefreshingFromStripe: true })
        .showStripeReturnRefreshMessage,
    ).toBe(false);
  });
});

describe('resolveConnectOnboardingStripeReturn', () => {
  it('maps the Stripe return_url and refresh_url params', () => {
    expect(resolveConnectOnboardingStripeReturn({ return: '1' })).toBe(
      'return',
    );
    expect(resolveConnectOnboardingStripeReturn({ refresh: '1' })).toBe(
      'refresh',
    );
  });

  it('treats an expired link as refresh even when return is also set', () => {
    expect(
      resolveConnectOnboardingStripeReturn({ return: '1', refresh: '1' }),
    ).toBe('refresh');
  });

  it('ignores missing or unexpected values', () => {
    expect(resolveConnectOnboardingStripeReturn({})).toBeNull();
    expect(
      resolveConnectOnboardingStripeReturn({ return: '0', refresh: 'yes' }),
    ).toBeNull();
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
