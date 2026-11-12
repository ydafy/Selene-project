/**
 * @file supabase/functions/account-closure-cleanup/index.ts
 *
 * Cron-invoked retry of the Stripe and Storage cleanup of closed accounts (hourly,
 * authenticated by `x-cron-secret` against `CRON_SECRET`). See handler.ts.
 */
import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { reportMessage, withSentry } from '../_shared/sentry.ts';
import {
  createAccountClosureCleanupHandler,
  createSupabaseAccountClosureCleanupPorts,
} from './handler.ts';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'account-closure-cleanup',
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

const getStripe = () => {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('MISSING_SERVER_CONFIG');
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
};

const handler = createAccountClosureCleanupHandler({
  getCronSecret: () => Deno.env.get('CRON_SECRET'),
  ...createSupabaseAccountClosureCleanupPorts({
    getAdmin: getAdminClient,
    getStripe,
  }),
  log,
  reportMessage,
});

Deno.serve(withSentry('account-closure-cleanup', handler));
