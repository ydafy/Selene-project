import { describe, expect, it, mock } from 'bun:test';

mock.module('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

mock.module('expo-linking', () => ({
  addEventListener: () => ({ remove: () => undefined }),
  createURL: (path: string) => `selene://${path}`,
}));

mock.module('expo-web-browser', () => ({
  dismissBrowser: () => undefined,
  openBrowserAsync: async () => undefined,
}));

mock.module('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
}));

mock.module('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: null,
    isError: false,
    isLoading: false,
    error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}));

mock.module('../db/supabase', () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) } },
}));

mock.module('../services/edge-client', () => ({
  invokeEdge: async () => ({}),
}));

const loadHelpers = () => import('./useConnectOnboarding');

describe('normalizeSellerOnboardingResponse', () => {
  it('exports the onboarding status query stale-time contract', async () => {
    const { CONNECT_ONBOARDING_QUERY_STALE_TIME_MS } = await loadHelpers();

    expect(CONNECT_ONBOARDING_QUERY_STALE_TIME_MS).toBe(30_000);
  });

  it('maps the direct self response to onboarding status fields', async () => {
    const { normalizeSellerOnboardingResponse } = await loadHelpers();

    expect(
      normalizeSellerOnboardingResponse(
        {
          success: true,
          has_stripe_account: true,
          stripe_onboarding_status: 'complete',
        },
        'user-1',
      ),
    ).toEqual({
      has_stripe_account: true,
      stripe_onboarding_status: 'complete',
    });
  });

  it('picks the current user row from an admin rows response', async () => {
    const { normalizeSellerOnboardingResponse } = await loadHelpers();

    expect(
      normalizeSellerOnboardingResponse(
        {
          success: true,
          rows: [
            {
              id: 'other-user',
              stripe_account_id: 'acct_other',
              stripe_onboarding_status: 'complete',
            },
            {
              id: 'user-1',
              stripe_account_id: 'acct_user',
              stripe_onboarding_status: 'pending',
            },
          ],
        },
        'user-1',
      ),
    ).toEqual({
      has_stripe_account: true,
      stripe_onboarding_status: 'pending',
    });
  });

  it('maps error responses to the stable UI status error key', async () => {
    const { normalizeSellerOnboardingResponse, toOnboardingErrorKey } =
      await loadHelpers();

    let caught: unknown;
    try {
      normalizeSellerOnboardingResponse(
        { success: false, error: 'PROFILE_NOT_FOUND' },
        'user-1',
      );
    } catch (error) {
      caught = error;
    }

    expect(toOnboardingErrorKey(caught, 'unknown')).toBe('statusUnavailable');
  });

  it('suppresses refresh errors once DB onboarding status is complete', async () => {
    const { resolveConnectRefreshError } = await loadHelpers();

    expect(
      resolveConnectRefreshError({
        status: 'complete',
        refreshError: 'refreshFailed',
      }),
    ).toBeNull();
  });

  it('clears stale start and refresh errors once DB onboarding status is complete', async () => {
    const { resolveConnectOnboardingErrorsAfterStatus } = await loadHelpers();

    expect(
      resolveConnectOnboardingErrorsAfterStatus({
        status: 'complete',
        error: 'unknown',
        refreshError: 'refreshFailed',
      }),
    ).toEqual({ error: null, refreshError: null });
  });

  it('preserves stale errors while status is not complete', async () => {
    const { resolveConnectOnboardingErrorsAfterStatus } = await loadHelpers();

    expect(
      resolveConnectOnboardingErrorsAfterStatus({
        status: 'pending',
        error: 'unknown',
        refreshError: 'refreshFailed',
      }),
    ).toEqual({ error: 'unknown', refreshError: 'refreshFailed' });
  });
});
