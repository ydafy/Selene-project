/**
 * HTTPS redirect bridge for Stripe Connect AccountLink return/refresh URLs.
 *
 * Stripe requires `return_url` and `refresh_url` to be valid HTTPS URLs; it will
 * reject raw app schemes such as `selene://sell/onboarding?return=1`. This Edge
 * Function gives Stripe a stable HTTPS URL and then redirects the browser back
 * into the mobile app deep link. No auth is required because this function only
 * redirects to configured, non-secret destinations.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

import { resolveConnectOnboardingRedirect } from './connect-onboarding-return.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const redirect = resolveConnectOnboardingRedirect({
    requestUrl: req.url,
    env: {
      SELENE_CONNECT_ONBOARDING_APP_URL: Deno.env.get(
        'SELENE_CONNECT_ONBOARDING_APP_URL',
      ),
      SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK: Deno.env.get(
        'SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK',
      ),
      SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK: Deno.env.get(
        'SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK',
      ),
    },
  });

  if (!redirect.ok) {
    return new Response(JSON.stringify({ error: redirect.error }), {
      status: redirect.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: redirect.url,
      'Cache-Control': 'no-store',
    },
  });
});
