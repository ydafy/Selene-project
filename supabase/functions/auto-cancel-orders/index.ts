import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { reportMessage, withSentry } from '../_shared/sentry.ts';
import { createAutoCancelOrdersHandler } from './handler.ts';

const handler = createAutoCancelOrdersHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  reportMessage,
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
    createClient(supabaseUrl, supabaseSecretKey),
  createStripe: () =>
    new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    }),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

Deno.serve(withSentry('auto-cancel-orders', handler));
