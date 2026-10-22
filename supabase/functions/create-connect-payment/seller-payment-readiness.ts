import type { StripeOnboardingStatus } from '../_shared/connect-status.ts';

export interface SellerPaymentProfile {
  id: string;
  stripe_account_id: string | null;
  stripe_onboarding_status: StripeOnboardingStatus | null;
}

/**
 * Returns the sellers that cannot receive this checkout's funds.
 *
 * A Connect account id alone is not enough: Stripe may still require
 * onboarding or have restricted the account. Only `complete` (charges and
 * payouts enabled, kept current by `account.updated`) lets the platform later
 * release the shipment amount to the seller. Missing profiles fail closed.
 */
export function findSellersNotReadyForPayment(
  sellerIds: readonly string[],
  profiles: readonly SellerPaymentProfile[],
): string[] {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return sellerIds.filter((sellerId) => {
    const profile = profileById.get(sellerId);
    return (
      !profile?.stripe_account_id ||
      profile.stripe_onboarding_status !== 'complete'
    );
  });
}
