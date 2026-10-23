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
import { withSentry } from '../_shared/sentry.ts';
import { createAccountClosureCleanupHandler, type CappedClosure } from './handler.ts';

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

// `account_closures` and its RPCs are not in the generated types until `bun run db:types`
// runs after the migrations are applied.
type DbError = { code?: string; message: string } | null;
type ClaimRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: Record<string, unknown>[] | null; error: DbError }>;
type CappedQuery = {
  select: (columns: string) => {
    or: (filter: string) => {
      gte: (column: string, value: number) => {
        order: (column: string) => {
          limit: (count: number) => Promise<{ data: CappedClosure[] | null; error: DbError }>;
        };
      };
    };
  };
};

const handler = createAccountClosureCleanupHandler({
  getCronSecret: () => Deno.env.get('CRON_SECRET'),
  claimClosures: async (limit, minIdleSeconds, maxAttempts) => {
    const admin = getAdminClient();
    return await (admin.rpc as unknown as ClaimRpc).call(admin, 'fn_claim_account_closures', {
      p_limit: limit,
      p_min_idle: `${minIdleSeconds} seconds`,
      p_max_attempts: maxAttempts,
    });
  },
  listCappedClosures: async (maxAttempts, limit) => {
    const table = getAdminClient().from('account_closures' as never) as unknown as CappedQuery;
    return await table
      .select('user_id, attempts')
      .or(OPEN_STEP_FILTER)
      .gte('attempts', maxAttempts)
      .order('updated_at')
      .limit(limit);
  },
  ...createSupabaseClosurePorts({ getAdmin: getAdminClient, getStripe }),
  log,
});

serve(withSentry('account-closure-cleanup', handler));
