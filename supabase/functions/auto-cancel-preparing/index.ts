import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { reportMessage, withSentry } from '../_shared/sentry.ts';
import { createAutoCancelPreparingHandler } from './handler.ts';

const handler = createAutoCancelPreparingHandler({
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
  fetch,
  now: () => Date.now(),
  randomUUID: () => crypto.randomUUID(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

Deno.serve(withSentry('auto-cancel-preparing', handler));
