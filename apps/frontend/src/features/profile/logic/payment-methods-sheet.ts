/**
 * Stripe CustomerSheet owns the buyer's saved cards (S7b, S7d): Selene keeps no
 * copy, list, delete action or card limit. `manage-payment-methods` only
 * creates the CustomerSession the sheet reads and the SetupIntents it confirms.
 * Each opening asks for a new session because the session expires.
 */

import { z } from 'zod';
import type {
  ClientSecretProvider,
  CustomerSheetResult,
} from '@stripe/stripe-react-native';

type ManagePaymentMethodsAction =
  { action: 'create_customer_session' } | { action: 'create_setup_intent' };

export type ManagePaymentMethodsInvoke = (
  name: 'manage-payment-methods',
  body: ManagePaymentMethodsAction,
) => Promise<unknown>;

const CustomerSessionResponseSchema = z.object({
  customerId: z.string().min(1),
  customerSessionClientSecret: z.string().min(1),
});

const SetupIntentResponseSchema = z.object({
  setupIntentClientSecret: z.string().min(1),
});

export type PaymentMethodsSession = {
  clientSecretProvider: ClientSecretProvider;
  /** True once the sheet asked for a SetupIntent and none could be fetched. */
  setupIntentFailed: () => boolean;
};

/**
 * Fetches a CustomerSession and a SetupIntent before the sheet opens, so a
 * failure keeps the sheet closed and the screen can offer a retry.
 *
 * stripe-react-native 0.81.0 does not catch a rejected
 * `provideSetupIntentClientSecret` and cannot pass an error to the native
 * request (`CustomerSheet.tsx` listener, string-only
 * `clientSecretProviderSetupIntentClientSecretCallback`), so a rejection would
 * leave the sheet waiting with no message. The provider therefore never
 * rejects: it hands out the prefetched secret and fetches the next one for a
 * second card. If that fetch and a new one at add time both fail, the request
 * stays pending until the user closes the sheet, and `setupIntentFailed`
 * tells the screen to show the error then.
 */
export async function preparePaymentMethodsSession(
  invoke: ManagePaymentMethodsInvoke,
): Promise<PaymentMethodsSession> {
  const fetchCustomerSession = async () => {
    const response = CustomerSessionResponseSchema.parse(
      await invoke('manage-payment-methods', {
        action: 'create_customer_session',
      }),
    );
    return {
      customerId: response.customerId,
      clientSecret: response.customerSessionClientSecret,
    };
  };
  const fetchSetupIntent = async () =>
    SetupIntentResponseSchema.parse(
      await invoke('manage-payment-methods', { action: 'create_setup_intent' }),
    ).setupIntentClientSecret;
  const fetchSetupIntentOrNull = () => fetchSetupIntent().catch(() => null);

  const [firstSession, firstSetupIntent] = await Promise.all([
    fetchCustomerSession(),
    fetchSetupIntent(),
  ]);

  let prefetchedSession: typeof firstSession | null = firstSession;
  let nextSetupIntent: Promise<string | null> =
    Promise.resolve(firstSetupIntent);
  let failed = false;

  return {
    setupIntentFailed: () => failed,
    clientSecretProvider: {
      // The SDK forwards a rejection here to the native sheet, so later
      // requests may fetch and fail normally.
      async provideCustomerSessionClientSecret() {
        const session = prefetchedSession ?? (await fetchCustomerSession());
        prefetchedSession = null;
        return session;
      },
      async provideSetupIntentClientSecret() {
        const secret =
          (await nextSetupIntent) ?? (await fetchSetupIntentOrNull());
        if (secret === null) {
          failed = true;
          return new Promise<string>(() => {});
        }
        nextSetupIntent = fetchSetupIntentOrNull();
        return secret;
      },
    },
  };
}

/** `closed` covers a cancel, a dismiss and a selection: none needs an action. */
export function customerSheetOutcome(
  result: CustomerSheetResult,
): 'closed' | 'failed' {
  if (result.error && result.error.code !== 'Canceled') return 'failed';
  return 'closed';
}
