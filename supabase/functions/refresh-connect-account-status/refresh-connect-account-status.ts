import {
  normalizeAccountStatus,
  type ConnectAccountLike,
  type StripeOnboardingStatus,
} from '../_shared/connect-status.ts';

const THROTTLE_MS = 60_000;

export interface RefreshProfile {
  id: string;
  role: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: StripeOnboardingStatus | null;
  stripe_onboarding_refreshed_at: string | null;
}

export interface RefreshConnectAccountUpdate {
  status: StripeOnboardingStatus;
  refreshedAt: string;
}

export interface RefreshConnectAccountDependencies {
  now: () => Date;
  getCallerProfile: (callerId: string) => Promise<RefreshProfile | null>;
  getTargetProfile: (sellerId: string) => Promise<RefreshProfile | null>;
  retrieveAccount: (accountId: string) => Promise<ConnectAccountLike>;
  updateProfileStatus: (
    sellerId: string,
    update: RefreshConnectAccountUpdate,
  ) => Promise<void>;
  log?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
}

export interface RefreshConnectAccountInput {
  callerId: string;
  sellerId?: string;
  force?: boolean;
}

export interface RefreshConnectAccountResponse {
  status: StripeOnboardingStatus;
  hasStripeAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  refreshedAt: string;
  cached: boolean;
  error?: 'STRIPE_REFRESH_FAILED';
}

export class RefreshConnectAccountError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'RefreshConnectAccountError';
  }
}

function isAdmin(profile: RefreshProfile | null): boolean {
  return profile?.role === 'admin';
}

function isThrottleActive(refreshedAt: string | null, now: Date): boolean {
  if (!refreshedAt) return false;
  const refreshedTime = new Date(refreshedAt).getTime();
  if (Number.isNaN(refreshedTime)) return false;
  return now.getTime() - refreshedTime < THROTTLE_MS;
}

function cachedResponse(
  profile: RefreshProfile,
  now: Date,
  error?: RefreshConnectAccountResponse['error'],
): RefreshConnectAccountResponse {
  const status = profile.stripe_onboarding_status ?? 'pending';
  const refreshedAt =
    profile.stripe_onboarding_refreshed_at ?? now.toISOString();
  const enabled = status === 'complete';
  const shouldExposeError = !enabled && error;

  return {
    status,
    hasStripeAccount: !!profile.stripe_account_id,
    chargesEnabled: enabled,
    payoutsEnabled: enabled,
    refreshedAt,
    cached: true,
    ...(shouldExposeError ? { error: shouldExposeError } : {}),
  };
}

export async function refreshConnectAccountStatus(
  input: RefreshConnectAccountInput,
  deps: RefreshConnectAccountDependencies,
): Promise<RefreshConnectAccountResponse> {
  const caller = await deps.getCallerProfile(input.callerId);
  if (!caller) {
    throw new RefreshConnectAccountError('AUTH_REQUIRED', 401);
  }

  const targetSellerId = input.sellerId ?? input.callerId;
  const target =
    targetSellerId === input.callerId
      ? caller
      : await deps.getTargetProfile(targetSellerId);

  if (!target) {
    throw new RefreshConnectAccountError('PROFILE_NOT_FOUND', 404);
  }

  if (target.id !== input.callerId && !isAdmin(caller)) {
    throw new RefreshConnectAccountError('FORBIDDEN', 403);
  }

  if (!target.stripe_account_id) {
    throw new RefreshConnectAccountError('CONNECT_ACCOUNT_NOT_FOUND', 404);
  }

  const now = deps.now();
  const canBypassThrottle = input.force === true && isAdmin(caller);
  if (
    !canBypassThrottle &&
    isThrottleActive(target.stripe_onboarding_refreshed_at, now)
  ) {
    return cachedResponse(target, now);
  }

  let account: ConnectAccountLike;
  try {
    account = await deps.retrieveAccount(target.stripe_account_id);
  } catch (error) {
    deps.log?.('error', 'Stripe Connect account refresh failed', {
      sellerId: target.id,
      accountId: target.stripe_account_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return cachedResponse(target, now, 'STRIPE_REFRESH_FAILED');
  }

  const normalized = normalizeAccountStatus(account);
  const refreshedAt = now.toISOString();

  await deps.updateProfileStatus(target.id, {
    status: normalized.status,
    refreshedAt,
  });

  return {
    status: normalized.status,
    hasStripeAccount: true,
    chargesEnabled: normalized.chargesEnabled,
    payoutsEnabled: normalized.payoutsEnabled,
    refreshedAt,
    cached: false,
  };
}
