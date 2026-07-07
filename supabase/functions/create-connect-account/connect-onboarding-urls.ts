/**
 * @file supabase/functions/create-connect-account/connect-onboarding-urls.ts
 * @description Pure utility logic for resolving dynamic Stripe Connect onboarding redirect URLs.
 *
 * Implements:
 * 1. Schema enforcement: Ensures Stripe-facing URLs are strictly HTTPS (rejects raw HTTP and custom mobile schemes).
 * 2. Zero-Configuration Fallback: Automatically resolves the intermediate Supabase bridge URL using the SUPABASE_URL system env.
 * 3. Dynamic Tunnel Overrides: Detects SELENE_CONNECT_ONBOARDING_BRIDGE_URL for local testing with Ngrok/Localtunnel.
 *
 * Facilitates the Gateway Redirect Pattern, allowing custom mobile protocols (selene://, exp://) to coexist.
 *
 * @version 1.0
 * @domain connect-onboarding-routing
 */

export interface ConnectOnboardingUrlInput {
  returnUrl?: string;
  refreshUrl?: string;
}

export type ConnectOnboardingUrlEnv = Record<string, string | undefined>;

const CONNECT_ONBOARDING_RETURN_FUNCTION = 'connect-onboarding-return';
const CONNECT_ONBOARDING_RETURN_PATH = `/functions/v1/${CONNECT_ONBOARDING_RETURN_FUNCTION}`;

type ConnectOnboardingState = 'return' | 'refresh';

export function isHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function buildBridgeBaseUrl(env: ConnectOnboardingUrlEnv): string | null {
  if (isHttpsUrl(env.SELENE_CONNECT_ONBOARDING_BRIDGE_URL)) {
    return env.SELENE_CONNECT_ONBOARDING_BRIDGE_URL;
  }

  if (!isHttpsUrl(env.SUPABASE_URL)) return null;

  return new URL(CONNECT_ONBOARDING_RETURN_PATH, env.SUPABASE_URL).toString();
}

function buildBridgeUrl(
  env: ConnectOnboardingUrlEnv,
  state: ConnectOnboardingState,
): string | null {
  const bridgeBaseUrl = buildBridgeBaseUrl(env);
  if (!bridgeBaseUrl) return null;

  const url = new URL(bridgeBaseUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

function resolveStripeFacingUrl(
  configuredUrl: string | undefined,
  env: ConnectOnboardingUrlEnv,
  state: ConnectOnboardingState,
) {
  if (isHttpsUrl(configuredUrl)) return configuredUrl;

  const bridgeUrl = buildBridgeUrl(env, state);
  if (bridgeUrl) return bridgeUrl;

  // Stripe Account Links reject custom schemes (`selene://...`) and plain HTTP.
  // For local Stripe testing, set SELENE_CONNECT_ONBOARDING_BRIDGE_URL to a
  // deployed Supabase function URL or an HTTPS tunnel that points at the bridge.
  throw new Error('CONNECT_ONBOARDING_BRIDGE_URL_REQUIRED');
}

export function resolveConnectOnboardingUrls(
  _input: ConnectOnboardingUrlInput,
  env: ConnectOnboardingUrlEnv,
) {
  // Client-provided URLs are accepted only as request context. They are never
  // forwarded to Stripe because arbitrary HTTPS URLs would be an open redirect.
  // Stripe-facing URLs must be HTTPS. The bridge is intentionally the default
  // fallback: Stripe receives HTTPS, then the bridge redirects back into the app
  // deep link. When Selene owns a production web/universal-link domain, replace
  // the bridge with SELENE_CONNECT_ONBOARDING_RETURN_URL/REFRESH_URL in one env
  // place, or keep the bridge and change its app target URL.
  return {
    returnUrl: resolveStripeFacingUrl(
      env.SELENE_CONNECT_ONBOARDING_RETURN_URL,
      env,
      'return',
    ),
    refreshUrl: resolveStripeFacingUrl(
      env.SELENE_CONNECT_ONBOARDING_REFRESH_URL,
      env,
      'refresh',
    ),
  };
}
