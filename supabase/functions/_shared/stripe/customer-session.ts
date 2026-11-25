// Stripe CustomerSessions for the app's two sheets. Stripe owns the buyer's
// saved cards; Selene keeps no copy. PaymentSheet (checkout and return label)
// and CustomerSheet (profile payment methods) read and change them through a
// short-lived session for one Stripe customer, created for each sheet opening.
import type Stripe from './sdk.ts';

export const CUSTOMER_SESSION_FAILED = 'CUSTOMER_SESSION_FAILED';

// Both sheets show every card attached to the customer, whatever its
// `allow_redisplay`. Stripe's default (`['always']`) hides cards saved without
// the sheet's consent checkbox: `unspecified` (attached through a SetupIntent
// or an ephemeral-key sheet) and `limited`. Every card on a Selene customer was
// added by that user in one of the two sheets, and Selene charges only with
// the buyer present, so none of them should be hidden from their owner. The
// same list in both sheets keeps a card visible in one visible in the other.
const SAVED_CARD_REDISPLAY_FILTERS: Array<
  'always' | 'limited' | 'unspecified'
> = ['always', 'limited', 'unspecified'];

export interface CustomerSessionStripe {
  customerSessions: {
    create: (
      params: Stripe.CustomerSessionCreateParams,
    ) => Promise<{ client_secret: string }>;
  };
}

/** The Stripe message behind a failed call (its `cause` when wrapped), for logs only. */
export function stripeFailureReason(error: unknown): string {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return cause instanceof Error ? cause.message : String(cause);
}

async function createSession(
  stripe: CustomerSessionStripe,
  params: Stripe.CustomerSessionCreateParams,
): Promise<string> {
  let clientSecret: string;
  try {
    ({ client_secret: clientSecret } =
      await stripe.customerSessions.create(params));
  } catch (cause) {
    throw new Error(CUSTOMER_SESSION_FAILED, { cause });
  }
  if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
    throw new Error(CUSTOMER_SESSION_FAILED);
  }
  return clientSecret;
}

/** PaymentSheet: show, save (consent checkbox) and remove saved cards. */
export function createPaymentSheetSession(
  stripe: CustomerSessionStripe,
  customerId: string,
): Promise<string> {
  return createSession(stripe, {
    customer: customerId,
    components: {
      mobile_payment_element: {
        enabled: true,
        features: {
          payment_method_redisplay: 'enabled',
          payment_method_save: 'enabled',
          payment_method_remove: 'enabled',
          payment_method_allow_redisplay_filters: SAVED_CARD_REDISPLAY_FILTERS,
        },
      },
    },
  });
}

/** CustomerSheet: show and remove saved cards; it adds cards through a SetupIntent. */
export function createCustomerSheetSession(
  stripe: CustomerSessionStripe,
  customerId: string,
): Promise<string> {
  return createSession(stripe, {
    customer: customerId,
    components: {
      customer_sheet: {
        enabled: true,
        features: {
          payment_method_remove: 'enabled',
          payment_method_allow_redisplay_filters: SAVED_CARD_REDISPLAY_FILTERS,
        },
      },
    },
  });
}
