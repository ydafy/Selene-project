/**
 * @file supabase/functions/create-connect-account/index.ts
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
 *   - If not, we create a new Accounts v2 account with the controller payload
 *     dictated by design.md and proposal.md.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

import { resolveConnectOnboardingUrls } from './connect-onboarding-urls.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';
const APP_NAME = 'selene';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RequestSchema = z.object({
  // The client may still send Expo/app deep links for context. The resolver
  // never forwards raw client URLs to Stripe; it uses configured HTTPS URLs or
  // the HTTPS redirect bridge below.
  refreshUrl: z.string().optional(),
  returnUrl: z.string().optional(),
});

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Secrets
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!stripeSecret || !serviceRoleKey || !supabaseUrl) {
      throw new Error('MISSING_SERVER_CONFIG');
    }

    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 2. Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('AUTH_REQUIRED');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('AUTH_REQUIRED');

    // 3. Validate input (links are optional — fallback to defaults below)
    const body = await req.json().catch(() => ({}));
    const { refreshUrl, returnUrl } = RequestSchema.parse(body);

    const onboardingUrls = resolveConnectOnboardingUrls(
      { refreshUrl, returnUrl },
      {
        SUPABASE_URL: supabaseUrl,
        SELENE_CONNECT_ONBOARDING_BRIDGE_URL: Deno.env.get(
          'SELENE_CONNECT_ONBOARDING_BRIDGE_URL',
        ),
        SELENE_CONNECT_ONBOARDING_RETURN_URL: Deno.env.get(
          'SELENE_CONNECT_ONBOARDING_RETURN_URL',
        ),
        SELENE_CONNECT_ONBOARDING_REFRESH_URL: Deno.env.get(
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
      log('info', 'Creating Stripe Connect Account v2', { sellerId: user.id });

      // Accounts v2 payload per design.md decision matrix:
      //  - losses.payments: 'stripe'         → Stripe absorbs chargebacks
      //  - fees.payer: 'application'         → Selene pays processing fees
      //  - stripe_dashboard.type: 'full'     → seller uses Stripe dashboard
      //  - requirement_collection: 'stripe'  → Stripe collects KYC
      //
      // The Accounts v2 endpoint lives at `stripe.v2.core.accounts.create`.
      // The official Stripe SDK exposes it via the v2 namespace; if a runtime
      // doesn't yet expose `stripe.v2`, fall back to v1 Express accounts to
      // avoid bricking onboarding (logged as a warning for ops).

      try {
        const account = await stripe.v2.core.accounts.create({
          contact_email: user.email ?? profile?.email ?? undefined,
          identity: { country: 'mx' },
          configuration: {
            merchant: {
              mcc: '5734', // Computer software stores — placeholder for HW resale
            },
          },
          defaults: {
            currency: 'mxn',
          },
          metadata: {
            supabase_user_id: user.id,
            app_name: APP_NAME,
          },
          // The controller block is the heart of the Accounts v2 contract.
          // It explicitly models who absorbs losses, who pays fees, what
          // dashboard the seller sees, and who collects requirements (KYC).
          controller: {
            losses: { payments: 'stripe' },
            fees: { payer: 'application' },
            stripe_dashboard: { type: 'full' },
            requirement_collection: 'stripe',
          },
          // Manual payout schedule: funds are frozen in the seller's Connect
          // account until Selene explicitly triggers payouts via Stripe API.
          // This is the true escrow — money only reaches the seller's bank
          // when the order is completed in Selene's DB, not on Stripe's 7-day
          // rolling schedule. Prevents sellers from withdrawing before delivery.
          settings: {
            payouts: {
              schedule: { interval: 'manual' },
            },
          },
        });
        accountId = account.id;
      } catch (v2Err) {
        // If Accounts v2 isn't available on this SDK/runtime, fall back to v1
        // Express with the closest-equivalent capabilities. This keeps the
        // onboarding flow available; the proposal explicitly approves either
        // path during the migration window.
        log('warn', 'Accounts v2 unavailable, falling back to v1 Express', {
          error: v2Err instanceof Error ? v2Err.message : String(v2Err),
        });
        const fallback = await stripe.accounts.create({
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
            fallback_reason: 'v2_unavailable',
          },
        });
        accountId = fallback.id;
      }

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
    // Same v2 fallback strategy as above: prefer v2.core.accountLinks; fall
    // back to v1 stripe.accountLinks if the SDK shape doesn't expose v2 yet.
    let onboardingUrl: string | null = null;

    try {
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['merchant'],
            refresh_url: onboardingUrls.refreshUrl,
            return_url: onboardingUrls.returnUrl,
          },
        },
      });
      onboardingUrl = link.url;
    } catch (v2Err) {
      log('warn', 'AccountLink v2 unavailable, falling back to v1', {
        error: v2Err instanceof Error ? v2Err.message : String(v2Err),
      });
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: onboardingUrls.refreshUrl,
        return_url: onboardingUrls.returnUrl,
        type: 'account_onboarding',
      });
      onboardingUrl = link.url;
    }

    if (!onboardingUrl) throw new Error('ACCOUNT_LINK_FAILED');

    return new Response(JSON.stringify({ url: onboardingUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
