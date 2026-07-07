export type ConnectOnboardingReturnState = 'return' | 'refresh';

export type ConnectOnboardingReturnEnv = Record<string, string | undefined>;

const DEFAULT_ONBOARDING_APP_URL = 'selene://sell/onboarding';

function parseState(url: string): ConnectOnboardingReturnState | null {
  const requestUrl = new URL(url);
  // `state` is the documented parameter. `type` is accepted as a compatibility
  // alias so old links or manual tests still resolve to the same bridge logic.
  const state =
    requestUrl.searchParams.get('state') ??
    requestUrl.searchParams.get('type') ??
    'return';

  if (state === 'return' || state === 'refresh') return state;
  return null;
}

function buildTargetUrl(
  baseUrl: string | undefined,
  state: ConnectOnboardingReturnState,
) {
  const configured = baseUrl?.trim() || DEFAULT_ONBOARDING_APP_URL;
  const url = new URL(configured);
  url.searchParams.set(state, '1');
  return url.toString();
}

function resolveStateOverride(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return new URL(trimmed).toString();
}

export function resolveConnectOnboardingRedirect(input: {
  requestUrl: string;
  env: ConnectOnboardingReturnEnv;
}):
  | { ok: true; url: string; state: ConnectOnboardingReturnState }
  | { ok: false; status: number; error: string } {
  const state = parseState(input.requestUrl);
  if (!state) {
    return { ok: false, status: 400, error: 'INVALID_ONBOARDING_RETURN_STATE' };
  }

  try {
    const stateOverride =
      state === 'return'
        ? input.env.SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK
        : input.env.SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK;

    return {
      ok: true,
      state,
      // Future production domain swap: set SELENE_CONNECT_ONBOARDING_APP_URL to
      // `https://your-domain.example/sell/onboarding` and keep this bridge URL
      // stable, or replace Stripe-facing URLs in create-connect-account directly.
      url:
        resolveStateOverride(stateOverride) ||
        buildTargetUrl(input.env.SELENE_CONNECT_ONBOARDING_APP_URL, state),
    };
  } catch {
    return { ok: false, status: 500, error: 'INVALID_ONBOARDING_APP_URL' };
  }
}
