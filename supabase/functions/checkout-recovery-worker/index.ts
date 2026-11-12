import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { reportMessage, withSentry } from '../_shared/sentry.ts';
import { createCheckoutRecoveryWorkerHandler } from './handler.ts';

const handler = createCheckoutRecoveryWorkerHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  reportMessage,
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) =>
    createClient<Database>(supabaseUrl, supabaseSecretKey),
  stripe: new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  }),
});

Deno.serve(withSentry('checkout-recovery-worker', handler));
