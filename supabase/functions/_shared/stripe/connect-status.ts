export type StripeOnboardingStatus = 'pending' | 'complete' | 'rejected';

export interface ConnectAccountLike {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
  // v1 capability map; a v2 `recipient` account read through v1 has only
  // `transfers` (no `card_payments`).
  capabilities?: {
    transfers?: string | null;
  } | null;
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
  const transfersActive = account.capabilities?.transfers === 'active';
  const disabledReason =
    account.requirements?.disabled_reason ??
    account.requirements?.disabledReason ??
    account.disabled_reason ??
    account.disabledReason ??
    null;

  // Selene uses separate charges and transfers: the seller's connected account
  // never takes charges, so readiness is payouts plus an active transfers
  // capability. chargesEnabled is reported only, never required (#330, S5).
  if (payoutsEnabled && transfersActive) {
    return { status: 'complete', chargesEnabled, payoutsEnabled };
  }

  if (disabledReason && disabledReason !== 'requirements.past_due') {
    return { status: 'rejected', chargesEnabled, payoutsEnabled };
  }

  return { status: 'pending', chargesEnabled, payoutsEnabled };
}
