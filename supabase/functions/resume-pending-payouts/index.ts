import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { reportMessage, withSentry } from '../_shared/sentry.ts';
import { createResumePendingPayoutsHandler } from './handler.ts';

const handler = createResumePendingPayoutsHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  reportMessage,
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
    createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  createStripe: (stripeSecret) =>
    new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    }),
});

Deno.serve(withSentry('resume-pending-payouts', handler));
