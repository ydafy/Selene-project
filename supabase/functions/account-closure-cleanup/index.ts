/**
 * @file supabase/functions/account-closure-cleanup/index.ts
 *
 * Cron-invoked retry of the Stripe and Storage cleanup of closed accounts (hourly,
 * authenticated by `x-cron-secret` against `CRON_SECRET`). See handler.ts.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { createSupabaseClosurePorts } from '../_shared/account-closure-cleanup.ts';
import { reportMessage, withSentry } from '../_shared/sentry.ts';
import { createAccountClosureCleanupHandler } from './handler.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';
const OPEN_STEP_FILTER = [
  'stripe_customer_cleanup.in.(pending,failed)',
  'stripe_account_cleanup.in.(pending,failed)',
  'storage_cleanup.in.(pending,failed)',
].join(',');

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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('MISSING_SERVER_CONFIG');
  return createClient<Database>(url, serviceRoleKey, {
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
  claimClosures: async (limit, minIdleSeconds, maxAttempts) => {
    return await getAdminClient().rpc('fn_claim_account_closures', {
      p_limit: limit,
      p_min_idle: `${minIdleSeconds} seconds`,
      p_max_attempts: maxAttempts,
    });
  },
  listCappedClosures: async (maxAttempts, limit) => {
    return await getAdminClient()
      .from('account_closures')
      .select('user_id, attempts')
      .or(OPEN_STEP_FILTER)
      .gte('attempts', maxAttempts)
      .order('updated_at')
      .limit(limit);
  },
  ...createSupabaseClosurePorts({ getAdmin: getAdminClient, getStripe }),
  log,
  reportMessage,
});

serve(withSentry('account-closure-cleanup', handler));
