import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../db/supabase';
import { invokeEdge } from '../services/edge-client';
import {
  buildConnectOnboardingDeepLinks,
  isConnectOnboardingUrl,
  shouldAttemptConnectStatusRefresh,
} from '../utils/connectOnboardingUrls';
import type { StripeOnboardingStatus } from '@selene/types';

export interface OnboardingStatusRow {
  has_stripe_account: boolean;
  stripe_onboarding_status: StripeOnboardingStatus | null;
}

export type SellerOnboardingRow = {
  id: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: StripeOnboardingStatus | null;
};

export type SellerOnboardingResponse =
  | ({ success: true } & OnboardingStatusRow)
  | { success: true; rows?: SellerOnboardingRow[] }
  | { success: false; error?: string };

export type ConnectOnboardingErrorKey =
  | 'statusUnavailable'
  | 'refreshFailed'
  | 'onboardingUrlUnavailable'
  | 'unknown';

export const CONNECT_ONBOARDING_ERROR = {
  statusUnavailable: 'statusUnavailable',
  refreshFailed: 'refreshFailed',
  onboardingUrlUnavailable: 'onboardingUrlUnavailable',
  unknown: 'unknown',
} as const satisfies Record<ConnectOnboardingErrorKey, ConnectOnboardingErrorKey>;

const onboardingErrorKeys = new Set<ConnectOnboardingErrorKey>([
  CONNECT_ONBOARDING_ERROR.statusUnavailable,
  CONNECT_ONBOARDING_ERROR.refreshFailed,
  CONNECT_ONBOARDING_ERROR.onboardingUrlUnavailable,
  CONNECT_ONBOARDING_ERROR.unknown,
]);

export const toOnboardingErrorKey = (
  error: unknown,
  fallback: ConnectOnboardingErrorKey,
): ConnectOnboardingErrorKey => {
  if (
    error instanceof Error &&
    onboardingErrorKeys.has(error.message as ConnectOnboardingErrorKey)
  ) {
    return error.message as ConnectOnboardingErrorKey;
  }

  return fallback;
};

export const resolveConnectRefreshError = ({
  status,
  refreshError,
}: {
  status: StripeOnboardingStatus | null;
  refreshError: ConnectOnboardingErrorKey | null;
}): ConnectOnboardingErrorKey | null => {
  if (status === 'complete') return null;
  return refreshError;
};

export const resolveConnectOnboardingErrorsAfterStatus = ({
  status,
  error,
  refreshError,
}: {
  status: StripeOnboardingStatus | null;
  error: ConnectOnboardingErrorKey | null;
  refreshError: ConnectOnboardingErrorKey | null;
}): {
  error: ConnectOnboardingErrorKey | null;
  refreshError: ConnectOnboardingErrorKey | null;
} => {
  if (status !== 'complete') return { error, refreshError };
  return { error: null, refreshError: null };
};

const emptyOnboardingStatus: OnboardingStatusRow = {
  has_stripe_account: false,
  stripe_onboarding_status: null,
};

export const CONNECT_ONBOARDING_QUERY_STALE_TIME_MS = 30_000;

export const normalizeSellerOnboardingResponse = (
  data: SellerOnboardingResponse | null | undefined,
  userId: string,
): OnboardingStatusRow => {
  if (!data?.success) {
    throw new Error(CONNECT_ONBOARDING_ERROR.statusUnavailable);
  }

  if ('has_stripe_account' in data) {
    return {
      has_stripe_account: data.has_stripe_account,
      stripe_onboarding_status: data.stripe_onboarding_status ?? null,
    };
  }

  const ownRow = data.rows?.find((row) => row.id === userId);
  return {
    has_stripe_account: !!ownRow?.stripe_account_id,
    stripe_onboarding_status: ownRow?.stripe_onboarding_status ?? null,
  };
};

/**
 * Hook for the Stripe Connect Express onboarding flow (CON-001).
 *
 * - `status` is the cached onboarding state for the current user.
 * - `startOnboarding()` calls the `create-connect-account` edge function and
 *   opens the returned AccountLink URL in an auth session. After the seller
 *   returns to the app, we refetch the status so the UI updates.
 * - `refresh()` is a convenience to re-poll the status (useful after
 *   account.updated webhook delivery delay).
 */
export function useConnectOnboarding(userId: string | undefined) {
  const qc = useQueryClient();
  const [isStarting, setIsStarting] = useState(false);
  const [isRefreshingFromStripe, setIsRefreshingFromStripe] = useState(false);
  const [error, setError] = useState<ConnectOnboardingErrorKey | null>(null);
  const [refreshError, setRefreshError] =
    useState<ConnectOnboardingErrorKey | null>(null);
  const refreshInFlight = useRef<Promise<unknown> | null>(null);

  const query = useQuery({
    queryKey: ['connect-onboarding', userId],
    queryFn: async (): Promise<OnboardingStatusRow> => {
      if (!userId) return emptyOnboardingStatus;

      const { data, error: functionError } =
        await supabase.functions.invoke<SellerOnboardingResponse>(
          'get-seller-onboarding',
          { body: {} },
        );

      if (functionError) {
        throw new Error(CONNECT_ONBOARDING_ERROR.statusUnavailable);
      }
      return normalizeSellerOnboardingResponse(data, userId);
    },
    enabled: !!userId,
    staleTime: CONNECT_ONBOARDING_QUERY_STALE_TIME_MS,
  });

  const canRefreshFromStripe = !!userId && !!query.data?.has_stripe_account;

  const refreshFromStripe = useCallback(
    async (options?: { skipCachedAccountCheck?: boolean }) => {
      if (
        !shouldAttemptConnectStatusRefresh({
          hasUser: !!userId,
          hasCachedAccount: canRefreshFromStripe,
          skipCachedAccountCheck: options?.skipCachedAccountCheck,
        })
      ) {
        return null;
      }
      if (refreshInFlight.current) return refreshInFlight.current;

      setRefreshError(null);
      setIsRefreshingFromStripe(true);

      const refreshPromise = invokeEdge('refresh-connect-account-status', {
        force: false,
      })
        .then(async (res) => {
          if (res.error && res.status !== 'complete') {
            setRefreshError(CONNECT_ONBOARDING_ERROR.refreshFailed);
          } else if (res.status === 'complete') {
            setError(null);
            setRefreshError(null);
          }
          await qc.invalidateQueries({
            queryKey: ['connect-onboarding', userId],
          });
          return res;
        })
        .catch((e) => {
          setRefreshError(
            toOnboardingErrorKey(e, CONNECT_ONBOARDING_ERROR.unknown),
          );
          throw e;
        })
        .finally(() => {
          refreshInFlight.current = null;
          setIsRefreshingFromStripe(false);
        });

      refreshInFlight.current = refreshPromise;
      return refreshPromise;
    },
    [canRefreshFromStripe, qc, userId],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshFromStripe().catch(() => undefined);
    }, [refreshFromStripe]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshFromStripe().catch(() => undefined);
      }
    });

    return () => subscription.remove();
  }, [refreshFromStripe]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!isConnectOnboardingUrl(url)) return;
      WebBrowser.dismissBrowser();
      void refreshFromStripe({ skipCachedAccountCheck: true }).catch(
        () => undefined,
      );
    });

    return () => subscription.remove();
  }, [refreshFromStripe]);

  const startOnboarding = useCallback(async () => {
    setError(null);
    setIsStarting(true);
    try {
      const res = await invokeEdge(
        'create-connect-account',
        // These are app-return deep links for onboarding context. The Edge
        // Function never forwards raw custom schemes to Stripe; it converts any
        // non-HTTPS value to the HTTPS redirect bridge required by AccountLinks.
        buildConnectOnboardingDeepLinks(Linking.createURL),
      );
      if (!res?.url) {
        throw new Error(CONNECT_ONBOARDING_ERROR.onboardingUrlUnavailable);
      }

      await WebBrowser.openBrowserAsync(res.url);
      await refreshFromStripe({ skipCachedAccountCheck: true });
    } catch (e) {
      setError(toOnboardingErrorKey(e, CONNECT_ONBOARDING_ERROR.unknown));
      throw e;
    } finally {
      setIsStarting(false);
    }
  }, [refreshFromStripe]);

  const refresh = useCallback(() => {
    return qc.invalidateQueries({ queryKey: ['connect-onboarding', userId] });
  }, [qc, userId]);

  const status = query.data?.stripe_onboarding_status ?? null;

  useEffect(() => {
    const nextErrors = resolveConnectOnboardingErrorsAfterStatus({
      status,
      error,
      refreshError,
    });

    if (nextErrors.error !== error) setError(nextErrors.error);
    if (nextErrors.refreshError !== refreshError) {
      setRefreshError(nextErrors.refreshError);
    }
  }, [error, refreshError, status]);

  return {
    status,
    isComplete: status === 'complete',
    isLoading: query.isLoading,
    statusError: query.isError
      ? toOnboardingErrorKey(
          query.error,
          CONNECT_ONBOARDING_ERROR.statusUnavailable,
        )
      : null,
    isStarting,
    isRefreshingFromStripe,
    error,
    refreshError: resolveConnectRefreshError({ status, refreshError }),
    startOnboarding,
    refresh,
    refreshFromStripe,
  };
}
