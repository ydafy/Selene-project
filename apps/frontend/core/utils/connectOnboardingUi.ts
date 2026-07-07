import type { StripeOnboardingStatus } from '@selene/types';

export type ConnectOnboardingViewState =
  | 'auth-required'
  | 'loading'
  | 'success'
  | 'wizard';

export type ConnectOnboardingCtaKey = 'start' | 'continue' | 'review';
export type ConnectOnboardingStatusGuidanceKey = 'new' | 'pending' | 'rejected';
export type ConnectOnboardingVisibleErrorKey =
  | 'statusUnavailable'
  | 'refreshFailed'
  | 'onboardingUrlUnavailable'
  | 'unknown';

export const CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE = '/sell' as const;

export interface ResolveConnectOnboardingUiInput {
  userId?: string | null;
  currentStep: number;
  lastStepIndex: number;
  status: StripeOnboardingStatus | null;
  isComplete: boolean;
  isLoading: boolean;
  isStarting: boolean;
  isRefreshingFromStripe: boolean;
  isStripeReturn: boolean;
}

export interface ConnectOnboardingUiState {
  viewState: ConnectOnboardingViewState;
  effectiveStep: number;
  isFinalStep: boolean;
  isNavigationDisabled: boolean;
  showBack: boolean;
  showNext: boolean;
  showStartCta: boolean;
  showRejectedBanner: boolean;
  showStatusGuidance: boolean;
  statusGuidanceKey: ConnectOnboardingStatusGuidanceKey | null;
  showStripeReturnRefreshMessage: boolean;
  ctaKey: ConnectOnboardingCtaKey;
  ctaLoading: boolean;
  ctaDisabled: boolean;
  nextLoading: boolean;
  nextDisabled: boolean;
  backDisabled: boolean;
}

export function resolveConnectOnboardingUiState({
  userId,
  currentStep,
  lastStepIndex,
  status,
  isComplete,
  isLoading,
  isStarting,
  isRefreshingFromStripe,
  isStripeReturn,
}: ResolveConnectOnboardingUiInput): ConnectOnboardingUiState {
  const hasCompleteStatus = isComplete || status === 'complete';
  const effectiveStep = isStripeReturn && !hasCompleteStatus ? lastStepIndex : currentStep;
  const isFinalStep = effectiveStep >= lastStepIndex;
  const isNavigationDisabled = isStarting || isLoading || isRefreshingFromStripe;
  const viewState: ConnectOnboardingViewState = !userId
    ? 'auth-required'
    : hasCompleteStatus
        ? 'success'
        : isLoading && status == null
          ? 'loading'
          : 'wizard';

  const ctaKey: ConnectOnboardingCtaKey =
    status === 'rejected' ? 'review' : status === 'pending' ? 'continue' : 'start';
  const statusGuidanceKey: ConnectOnboardingStatusGuidanceKey | null =
    status === 'rejected' ? 'rejected' : status === 'pending' ? 'pending' : null;
  const effectiveStatusGuidanceKey =
    viewState === 'wizard' && isFinalStep ? (statusGuidanceKey ?? 'new') : null;

  return {
    viewState,
    effectiveStep,
    isFinalStep,
    isNavigationDisabled,
    showBack: viewState === 'wizard' && effectiveStep > 0,
    showNext: viewState === 'wizard' && !isFinalStep,
    showStartCta: viewState === 'wizard' && isFinalStep,
    showRejectedBanner: viewState === 'wizard' && status === 'rejected',
    showStatusGuidance: effectiveStatusGuidanceKey != null,
    statusGuidanceKey: effectiveStatusGuidanceKey,
    showStripeReturnRefreshMessage:
      viewState === 'wizard' && isStripeReturn && isRefreshingFromStripe,
    ctaKey,
    ctaLoading: isNavigationDisabled,
    ctaDisabled: isNavigationDisabled,
    nextLoading: isNavigationDisabled,
    nextDisabled: isNavigationDisabled,
    backDisabled: isNavigationDisabled,
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
