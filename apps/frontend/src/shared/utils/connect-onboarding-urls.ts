export interface ConnectOnboardingDeepLinks {
  returnUrl: string;
  refreshUrl: string;
}

export type CreateExpoUrl = (
  path: string,
  options: { queryParams: Record<string, string> },
) => string;

export function buildConnectOnboardingDeepLinks(
  createURL: CreateExpoUrl,
): ConnectOnboardingDeepLinks {
  return {
    returnUrl: createURL('/sell/onboarding', {
      queryParams: { return: '1' },
    }),
    refreshUrl: createURL('/sell/onboarding', {
      queryParams: { refresh: '1' },
    }),
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
