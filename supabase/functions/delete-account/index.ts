import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { createSupabaseClosurePorts } from '../_shared/account-closure-cleanup.ts';
import { withSentry } from '../_shared/sentry.ts';
import { AuthUnavailableError, createDeleteAccountHandler, isTransientAuthError } from './handler.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'delete-account',
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

const handler = createDeleteAccountHandler({
  getUserId: async (accessToken) => {
    const {
      data: { user },
      error,
    } = await getAdminClient().auth.getUser(accessToken);
    // A 4xx is the auth server's verdict on the token; anything else is an outage to retry.
    if (error && isTransientAuthError(error)) throw new AuthUnavailableError();
    return error || !user ? null : user.id;
  },
  now: () => Date.now(),
  closeAccount: async (userId) => {
    // The RPC is not in the generated types until `bun run db:types` runs after it is applied.
    const { data, error } = await getAdminClient().rpc('fn_close_account' as never, {
      p_user_id: userId,
    } as never);
    return { data: data as unknown, error };
  },
  ...createSupabaseClosurePorts({ getAdmin: getAdminClient, getStripe }),
  log,
});

serve(withSentry('delete-account', handler));
