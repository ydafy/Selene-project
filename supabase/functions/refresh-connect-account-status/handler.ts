import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type { ConnectAccountLike } from '../_shared/stripe/connect-status.ts';

import {
  refreshConnectAccountStatus,
  RefreshConnectAccountError,
  type RefreshProfile,
} from './refresh-connect-account-status.ts';

export type SupabaseAdminClient = SupabaseClient;

// The one Stripe call this function makes; index.ts passes the real client.
export interface RefreshConnectAccountStripe {
  accounts: {
    retrieve: (accountId: string) => Promise<ConnectAccountLike>;
  };
}

export interface RefreshConnectAccountStatusDependencies {
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Called once per request, after the Authorization header is present.
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
  // Called once per request, after the caller is authenticated.
  createStripe: (stripeSecret: string) => RefreshConnectAccountStripe;
  now?: () => Date;
}

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

export function createRefreshConnectAccountStatusHandler(
  deps: RefreshConnectAccountStatusDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const stripeSecret = deps.getEnv('STRIPE_SECRET_KEY');
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!stripeSecret || !supabaseSecretKey || !supabaseUrl) {
        throw new RefreshConnectAccountError('MISSING_SERVER_CONFIG', 500);
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new RefreshConnectAccountError('AUTH_REQUIRED', 401);
      }

      const token = authHeader.replace('Bearer ', '');
      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );
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

      const stripe = deps.createStripe(stripeSecret);

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
          now: deps.now ?? (() => new Date()),
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
  };
}
