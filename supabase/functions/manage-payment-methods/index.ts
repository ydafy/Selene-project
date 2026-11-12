import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { withSentry } from '../_shared/sentry.ts';
import { createManagePaymentMethodsHandler } from './handler.ts';

const handler = createManagePaymentMethodsHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  createStripe: (stripeSecret) =>
    new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    }),
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
    createClient(supabaseUrl, supabaseSecretKey),
});

Deno.serve(withSentry('manage-payment-methods', handler));
