import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { reportMessage, withSentry } from '../_shared/sentry.ts';
import {
  createReconcileStripeFeesHandler,
  type FeeWorkerDatabase,
} from './handler.ts';

const handler = createReconcileStripeFeesHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  reportMessage,
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
    createClient<FeeWorkerDatabase>(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  createStripe: (stripeSecret) =>
    new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    }),
  now: () => new Date().toISOString(),
});

Deno.serve(withSentry('reconcile-stripe-fees', handler));
