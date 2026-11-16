import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { createCancellationReporter } from '../_shared/cancellation/cancellation-alerts.ts';
import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createRefundOverduePayoutHandler } from './handler.ts';
import {
  createStripeRefundOverduePayoutPorts,
  createSupabaseRefundOverduePayoutPorts,
} from './ports.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'refund-overdue-payout',
      level,
      msg,
      ...data,
    }),
  );
};

// Lazy: a missing server config is a 500 for the request, not a crash at import time.
const getAdminClient = () => {
  const url = Deno.env.get('SUPABASE_URL');
  const supabaseSecretKey = readSupabaseSecretKey();
  if (!url || !supabaseSecretKey) throw new Error('MISSING_SERVER_CONFIG');
  return createClient<Database>(url, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

let stripe: Stripe | null = null;
const getStripe = () => {
  if (stripe) return stripe;
  const secret = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secret) throw new Error('MISSING_STRIPE_SECRET_KEY');
  stripe = new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
  return stripe;
};

const handler = createRefundOverduePayoutHandler({
  ...createSupabaseRefundOverduePayoutPorts(getAdminClient),
  ...createStripeRefundOverduePayoutPorts(getStripe),
  reportCritical: createCancellationReporter('refund-overdue-payout', log),
  log,
});

serveAdminWeb(withSentry('refund-overdue-payout', handler));
