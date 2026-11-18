/** Where the guide was opened; `create-connect-account` accepts only these. */
export type ConnectOnboardingSource = 'listing';

export interface ConnectOnboardingDeepLinks {
  returnUrl: string;
  refreshUrl: string;
  source?: ConnectOnboardingSource;
}

export type CreateExpoUrl = (
  path: string,
  options: { queryParams: Record<string, string> },
) => string;

/**
 * Request body for `create-connect-account`. With a source, the server adds
 * `from=<source>` to Stripe's return URLs, so the guide that Stripe's return
 * opens keeps the exits of the guide that started it (#690).
 */
export function buildConnectOnboardingDeepLinks(
  createURL: CreateExpoUrl,
  source?: ConnectOnboardingSource,
): ConnectOnboardingDeepLinks {
  const from: Record<string, string> = source ? { from: source } : {};
  return {
    returnUrl: createURL('/sell/onboarding', {
      queryParams: { return: '1', ...from },
    }),
    refreshUrl: createURL('/sell/onboarding', {
      queryParams: { refresh: '1', ...from },
    }),
    ...(source ? { source } : {}),
  };
}

export function isConnectOnboardingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === 'sell' && parsed.pathname === '/onboarding') ||
      parsed.pathname === '/sell/onboarding'
    );
  } catch {
    return url.includes('/sell/onboarding');
  }
}

export function shouldAttemptConnectStatusRefresh(input: {
  hasUser: boolean;
  hasCachedAccount: boolean;
  skipCachedAccountCheck?: boolean;
}): boolean {
  if (!input.hasUser) return false;
  return input.skipCachedAccountCheck === true || input.hasCachedAccount;
}
