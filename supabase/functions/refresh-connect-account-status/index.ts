import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createRefreshConnectAccountStatusHandler } from './handler.ts';

const handler = createRefreshConnectAccountStatusHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
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

serveAdminWeb(withSentry('refresh-connect-account-status', handler));
