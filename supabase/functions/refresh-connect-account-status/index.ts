import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';

import {
  refreshConnectAccountStatus,
  RefreshConnectAccountError,
  type RefreshProfile,
} from './refresh-connect-account-status.ts';
import { serveAdminWeb } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';

const log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'refresh-connect-account-status',
      level,
      msg,
      ...meta,
    }),
  );
};

serveAdminWeb(
  withSentry('refresh-connect-account-status', async (req: Request) => {
    try {
      const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
      const supabaseSecretKey = readSupabaseSecretKey();
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      if (!stripeSecret || !supabaseSecretKey || !supabaseUrl) {
        throw new RefreshConnectAccountError('MISSING_SERVER_CONFIG', 500);
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new RefreshConnectAccountError('AUTH_REQUIRED', 401);
      }

      const token = authHeader.replace('Bearer ', '');
      const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        throw new RefreshConnectAccountError('AUTH_REQUIRED', 401);
      }

      const body = (await req.json().catch(() => ({}))) as {
        force?: boolean;
        sellerId?: string;
      };

      const stripe = new Stripe(stripeSecret, {
        apiVersion: STRIPE_API_VERSION,
        httpClient: Stripe.createFetchHttpClient(),
      });

      const selectProfile = async (
        sellerId: string,
      ): Promise<RefreshProfile | null> => {
        const { data, error } = await supabaseAdmin
          .from('profiles_private')
          .select(
            'id, role, stripe_account_id, stripe_onboarding_status, stripe_onboarding_refreshed_at',
          )
          .eq('id', sellerId)
          .maybeSingle();
        if (error)
          throw new RefreshConnectAccountError('PROFILE_LOOKUP_FAILED', 500);
        return (data as RefreshProfile | null) ?? null;
      };

      const response = await refreshConnectAccountStatus(
        { callerId: user.id, sellerId: body.sellerId, force: body.force },
        {
          now: () => new Date(),
          getCallerProfile: selectProfile,
          getTargetProfile: selectProfile,
          retrieveAccount: (accountId) => stripe.accounts.retrieve(accountId),
          updateProfileStatus: async (sellerId, update) => {
            const { error } = await supabaseAdmin
              .from('profiles_private')
              .update({
                stripe_onboarding_status: update.status,
                stripe_onboarding_refreshed_at: update.refreshedAt,
                updated_at: update.refreshedAt,
              })
              .eq('id', sellerId);
            if (error)
              throw new RefreshConnectAccountError(
                'PROFILE_UPDATE_FAILED',
                500,
              );
          },
          log,
        },
      );

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        error instanceof RefreshConnectAccountError ? error.status : 400;
      log('error', 'refresh-connect-account-status failed', {
        message,
        status,
      });
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
);
