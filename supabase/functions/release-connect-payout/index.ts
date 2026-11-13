import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createReleaseConnectPayoutHandler } from './handler.ts';

const handler = createReleaseConnectPayoutHandler({
  getEnv: (name) => Deno.env.get(name),
  readSupabaseSecretKey: () => readSupabaseSecretKey(),
  createSupabaseAdmin: (supabaseUrl, supabaseSecretKey, options) =>
    createClient(supabaseUrl, supabaseSecretKey, options),
  createStripe: (stripeSecret) =>
    new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    }),
});

serveAdminWeb(withSentry('release-connect-payout', handler));
