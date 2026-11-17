import type { StripeOnboardingStatus } from '@selene/types';

type ConnectOnboardingViewState =
  'auth-required' | 'loading' | 'success' | 'guide';

type ConnectOnboardingCtaKey = 'start' | 'continue' | 'review';
export type ConnectOnboardingStatusNoticeKey =
  'pending' | 'rejected' | 'expired';
/** How the seller came back from Stripe: `refresh` means the account link expired. */
export type ConnectOnboardingStripeReturn = 'return' | 'refresh' | null;
export type ConnectOnboardingVisibleErrorKey =
  | 'statusUnavailable'
  | 'refreshFailed'
  | 'onboardingUrlUnavailable'
  | 'unknown';

export const CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE = '/sell' as const;

export interface ResolveConnectOnboardingUiInput {
  userId?: string | null;
  status: StripeOnboardingStatus | null;
  isComplete: boolean;
  isLoading: boolean;
  isStarting: boolean;
  isRefreshingFromStripe: boolean;
  stripeReturn: ConnectOnboardingStripeReturn;
}

export interface ConnectOnboardingUiState {
  viewState: ConnectOnboardingViewState;
  showStartCta: boolean;
  statusNoticeKey: ConnectOnboardingStatusNoticeKey | null;
  showStripeReturnRefreshMessage: boolean;
  ctaKey: ConnectOnboardingCtaKey;
  ctaLoading: boolean;
  ctaDisabled: boolean;
}

/** A notice replaces the guide header, so the cards below are only the steps. */
export function resolveConnectOnboardingHeaderKeys(
  statusNoticeKey: ConnectOnboardingStatusNoticeKey | null,
) {
  if (statusNoticeKey === null) {
    return {
      titleKey: 'sellerOnboarding:header.title',
      subtitleKey: 'sellerOnboarding:header.subtitle',
    } as const;
  }
  return {
    titleKey: `sellerOnboarding:statusNotice.${statusNoticeKey}Title`,
    subtitleKey: `sellerOnboarding:statusNotice.${statusNoticeKey}Desc`,
  } as const;
}

/** Stripe sends the seller to refresh_url when the account link expired, so it wins. */
export function resolveConnectOnboardingStripeReturn(params: {
  return?: string;
  refresh?: string;
}): ConnectOnboardingStripeReturn {
  if (params.refresh === '1') return 'refresh';
  if (params.return === '1') return 'return';
  return null;
}

export function resolveConnectOnboardingUiState({
  userId,
  status,
  isComplete,
  isLoading,
  isStarting,
  isRefreshingFromStripe,
  stripeReturn,
}: ResolveConnectOnboardingUiInput): ConnectOnboardingUiState {
  const hasCompleteStatus = isComplete || status === 'complete';
  const isBusy = isStarting || isLoading || isRefreshingFromStripe;
  const viewState: ConnectOnboardingViewState = !userId
    ? 'auth-required'
    : hasCompleteStatus
      ? 'success'
      : isLoading && status == null
        ? 'loading'
        : 'guide';
  const isGuide = viewState === 'guide';

  // A rejection needs corrections, so it wins over an expired link.
  const statusNoticeKey: ConnectOnboardingStatusNoticeKey | null = !isGuide
    ? null
    : status === 'rejected'
      ? 'rejected'
      : stripeReturn === 'refresh'
        ? 'expired'
        : status === 'pending'
          ? 'pending'
          : null;
  const ctaKey: ConnectOnboardingCtaKey =
    statusNoticeKey === 'rejected'
      ? 'review'
      : statusNoticeKey === 'expired' || statusNoticeKey === 'pending'
        ? 'continue'
        : 'start';

  return {
    viewState,
    showStartCta: isGuide,
    statusNoticeKey,
    showStripeReturnRefreshMessage:
      isGuide && stripeReturn !== null && isRefreshingFromStripe,
    ctaKey,
    ctaLoading: isBusy,
    ctaDisabled: isBusy,
  };
}

export function resolveConnectOnboardingVisibleError({
  status,
  error,
  refreshError,
  statusError,
}: {
  status: StripeOnboardingStatus | null;
  error: ConnectOnboardingVisibleErrorKey | null;
  refreshError: ConnectOnboardingVisibleErrorKey | null;
  statusError: ConnectOnboardingVisibleErrorKey | null;
}): ConnectOnboardingVisibleErrorKey | null {
  if (status === 'complete') return null;
  return error ?? refreshError ?? statusError;
}
