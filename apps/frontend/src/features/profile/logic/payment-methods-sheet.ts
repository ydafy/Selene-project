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

export function createPaymentMethodsSecretProvider(
  invoke: ManagePaymentMethodsInvoke,
): ClientSecretProvider {
  return {
    async provideCustomerSessionClientSecret() {
      const response = CustomerSessionResponseSchema.parse(
        await invoke('manage-payment-methods', {
          action: 'create_customer_session',
        }),
      );
      return {
        customerId: response.customerId,
        clientSecret: response.customerSessionClientSecret,
      };
    },
    async provideSetupIntentClientSecret() {
      const response = SetupIntentResponseSchema.parse(
        await invoke('manage-payment-methods', {
          action: 'create_setup_intent',
        }),
      );
      return response.setupIntentClientSecret;
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
