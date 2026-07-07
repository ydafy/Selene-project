import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import {
  refreshConnectAccountStatus,
  RefreshConnectAccountError,
  type RefreshProfile,
} from './refresh-connect-account-status.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!stripeSecret || !serviceRoleKey || !supabaseUrl) {
      throw new RefreshConnectAccountError('MISSING_SERVER_CONFIG', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new RefreshConnectAccountError('AUTH_REQUIRED', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
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
            throw new RefreshConnectAccountError('PROFILE_UPDATE_FAILED', 500);
        },
        log,
      },
    );

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof RefreshConnectAccountError ? error.status : 400;
    log('error', 'refresh-connect-account-status failed', { message, status });
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
