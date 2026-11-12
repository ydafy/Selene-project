/**
 * HTTPS redirect bridge for Stripe Connect AccountLink return/refresh URLs.
 *
 * Stripe requires `return_url` and `refresh_url` to be valid HTTPS URLs; it will
 * reject raw app schemes such as `selene://sell/onboarding?return=1`. This Edge
 * Function gives Stripe a stable HTTPS URL and then redirects the browser back
 * into the mobile app deep link. No auth is required because this function only
 * redirects to configured, non-secret destinations.
 */

import { resolveConnectOnboardingRedirect } from './connect-onboarding-return.ts';

export interface ConnectOnboardingReturnDependencies {
  getEnv: (name: string) => string | undefined;
}

export function createConnectOnboardingReturnHandler(
  deps: ConnectOnboardingReturnDependencies,
) {
  return (req: Request): Response => {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const redirect = resolveConnectOnboardingRedirect({
      requestUrl: req.url,
      env: {
        SELENE_CONNECT_ONBOARDING_APP_URL: deps.getEnv(
          'SELENE_CONNECT_ONBOARDING_APP_URL',
        ),
        SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK: deps.getEnv(
          'SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK',
        ),
        SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK: deps.getEnv(
          'SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK',
        ),
      },
    });

    if (!redirect.ok) {
      return new Response(JSON.stringify({ error: redirect.error }), {
        status: redirect.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirect.url,
        'Cache-Control': 'no-store',
      },
    });
  };
}
