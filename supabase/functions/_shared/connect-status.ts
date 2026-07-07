export type StripeOnboardingStatus = 'pending' | 'complete' | 'rejected';

export interface ConnectAccountLike {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
  requirements?: {
    disabled_reason?: string | null;
    disabledReason?: string | null;
  } | null;
  disabled_reason?: string | null;
  disabledReason?: string | null;
}

export interface NormalizedConnectStatus {
  status: StripeOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

export function normalizeAccountStatus(
  account: ConnectAccountLike,
): NormalizedConnectStatus {
  const chargesEnabled =
    account.charges_enabled === true || account.chargesEnabled === true;
  const payoutsEnabled =
    account.payouts_enabled === true || account.payoutsEnabled === true;
  const disabledReason =
    account.requirements?.disabled_reason ??
    account.requirements?.disabledReason ??
    account.disabled_reason ??
    account.disabledReason ??
    null;

  if (chargesEnabled && payoutsEnabled) {
    return { status: 'complete', chargesEnabled, payoutsEnabled };
  }

  if (disabledReason && disabledReason !== 'requirements.past_due') {
    return { status: 'rejected', chargesEnabled, payoutsEnabled };
  }

  return { status: 'pending', chargesEnabled, payoutsEnabled };
}
