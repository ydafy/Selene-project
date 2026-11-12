/**
 * @file supabase/functions/create-connect-account/handler.ts
 *
 * Creates (or re-uses) a Stripe Connect Express account for the calling seller
 * and returns an AccountLink URL for hosted onboarding.
 *
 * Implements delta spec CON-001 (Stripe Connect Onboarding).
 *
 * Auth: only the authenticated seller themselves. Admins should use a separate
 * path (impersonation is intentionally not supported here to keep the audit
 * trail clean — the seller must own the KYC flow).
 *
 * Idempotency:
 *   - If the caller already has `profiles_private.stripe_account_id`, we reuse
 *     it and just mint a fresh AccountLink (the previous link is short-lived).
 *   - If not, we create a new v1 Express account (country MX, transfers and
 *     card_payments requested) with a manual payout schedule.
 */

import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';

import { resolveConnectOnboardingUrls } from './connect-onboarding-urls.ts';
import { CreateConnectAccountRequestSchema } from './request-schema.ts';

export type SupabaseAdminClient = SupabaseClient;

// The two Stripe calls this function makes; index.ts passes the real client.
export interface ConnectAccountStripe {
  accounts: {
    create: (params: Stripe.AccountCreateParams) => Promise<{ id: string }>;
  };
  accountLinks: {
    create: (
      params: Stripe.AccountLinkCreateParams,
    ) => Promise<{ url: string }>;
  };
}

export interface CreateConnectAccountDependencies {
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Called once per request, after the secrets are present.
  createStripe: (stripeSecret: string) => ConnectAccountStripe;
  // Called once per request, after the Authorization header is present.
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
}

const APP_NAME = 'selene';

const log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'create-connect-account',
      level,
      msg,
      ...meta,
    }),
  );
};

export function createCreateConnectAccountHandler(
  deps: CreateConnectAccountDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      // 1. Secrets
      const stripeSecret = deps.getEnv('STRIPE_SECRET_KEY');
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!stripeSecret || !supabaseSecretKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const stripe = deps.createStripe(stripeSecret);

      // 2. Auth
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) throw new Error('AUTH_REQUIRED');

      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) throw new Error('AUTH_REQUIRED');

      // 3. Validate input (links are optional — fallback to defaults below)
      const body = await req.json().catch(() => ({}));
      const { refreshUrl, returnUrl } =
        CreateConnectAccountRequestSchema.parse(body);

      const onboardingUrls = resolveConnectOnboardingUrls(
        { refreshUrl, returnUrl },
        {
          SUPABASE_URL: supabaseUrl,
          SELENE_CONNECT_ONBOARDING_BRIDGE_URL: deps.getEnv(
            'SELENE_CONNECT_ONBOARDING_BRIDGE_URL',
          ),
          SELENE_CONNECT_ONBOARDING_RETURN_URL: deps.getEnv(
            'SELENE_CONNECT_ONBOARDING_RETURN_URL',
          ),
          SELENE_CONNECT_ONBOARDING_REFRESH_URL: deps.getEnv(
            'SELENE_CONNECT_ONBOARDING_REFRESH_URL',
          ),
        },
      );

      // 4. Load existing Connect account, if any
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_account_id, stripe_onboarding_status, email')
        .eq('id', user.id)
        .single();
      if (profileError) throw new Error('PROFILE_NOT_FOUND');

      let accountId = profile?.stripe_account_id ?? null;

      if (!accountId) {
        log('info', 'Creating Stripe Connect Express account', {
          sellerId: user.id,
        });

        // Manual payout schedule: funds stay in the seller's Connect account
        // until Selene triggers the payout, after the order completes.
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'MX',
          email: user.email ?? profile?.email ?? undefined,
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
          settings: {
            payouts: {
              schedule: { interval: 'manual' },
            },
          },
          metadata: {
            supabase_user_id: user.id,
            app_name: APP_NAME,
          },
        });
        accountId = account.id;

        // Persist account id and set status to 'pending'
        const { error: updateError } = await supabaseAdmin
          .from('profiles_private')
          .update({
            stripe_account_id: accountId,
            stripe_onboarding_status: 'pending',
          })
          .eq('id', user.id);
        if (updateError) {
          log('error', 'Failed to persist stripe_account_id', {
            error: updateError.message,
          });
          throw new Error('PROFILE_UPDATE_FAILED');
        }
      } else {
        log('info', 'Reusing existing Connect account', { accountId });
      }

      if (!accountId) throw new Error('ACCOUNT_CREATION_FAILED');

      // 5. Create AccountLink for hosted onboarding.
      // Stripe requires HTTPS return/refresh URLs. `resolveConnectOnboardingUrls`
      // gives Stripe configured HTTPS URLs or the HTTPS bridge URL
      // (`connect-onboarding-return?state=return|refresh`). The bridge redirects
      // back to `selene://...` today; a future production domain can replace the
      // bridge target via env without changing this AccountLink code.
      let onboardingUrl: string | null = null;

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: onboardingUrls.refreshUrl,
        return_url: onboardingUrls.returnUrl,
        type: 'account_onboarding',
      });
      onboardingUrl = link.url;

      if (!onboardingUrl) throw new Error('ACCOUNT_LINK_FAILED');

      return new Response(JSON.stringify({ url: onboardingUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'create-connect-account failed', { message });

      const statusMap: Record<string, number> = {
        AUTH_REQUIRED: 401,
        MISSING_SERVER_CONFIG: 500,
        PROFILE_NOT_FOUND: 404,
        PROFILE_UPDATE_FAILED: 500,
        ACCOUNT_CREATION_FAILED: 500,
        ACCOUNT_LINK_FAILED: 500,
        CONNECT_ONBOARDING_BRIDGE_URL_REQUIRED: 500,
      };
      const status = statusMap[message] || 400;

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
