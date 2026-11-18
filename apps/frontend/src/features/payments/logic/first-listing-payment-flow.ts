import type { PaymentSetupNeed } from '@/shared/utils/payment-setup-need';

import { CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE } from './connect-onboarding-ui';

/** `from` value that marks the payments guide as step 2 after publishing. */
export const FIRST_LISTING_ONBOARDING_SOURCE = 'listing';

const PROFILE_ROUTE = '/(tabs)/profile' as const;

export const resolveSellSuccessSubtitleKey = (need: PaymentSetupNeed) =>
  need
    ? ('success.subtitleWithPayments' as const)
    : ('success.subtitle' as const);

/** After the evidence is sent, payments are the next step while they are missing. */
export const resolveVerifySuccessRoute = (need: PaymentSetupNeed) =>
  need
    ? ({
        pathname: '/sell/onboarding',
        params: { from: FIRST_LISTING_ONBOARDING_SOURCE },
      } as const)
    : PROFILE_ROUTE;

/** Inside the publish flow the guide is optional: "later" and success both end on the profile. */
export const resolveFirstListingOnboardingExit = (params: { from?: string }) =>
  params.from === FIRST_LISTING_ONBOARDING_SOURCE
    ? { showLater: true, successRoute: PROFILE_ROUTE }
    : { showLater: false, successRoute: CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE };
