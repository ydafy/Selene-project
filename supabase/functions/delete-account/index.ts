import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { createSupabaseClosurePorts } from '../_shared/account-closure-cleanup.ts';
import { withSentry } from '../_shared/sentry.ts';
import {
  AuthUnavailableError,
  createDeleteAccountHandler,
  isTransientAuthError,
} from './handler.ts';

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
    const { data, error } = await getAdminClient().rpc('fn_close_account', {
      p_user_id: userId,
    });
    return { data: data as unknown, error };
  },
  ...createSupabaseClosurePorts({ getAdmin: getAdminClient, getStripe }),
  log,
});

Deno.serve(withSentry('delete-account', handler));
