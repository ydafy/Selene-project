/**
 * Authenticates the caller before any quote work. The function runs with verify_jwt = false
 * (#399), so a missing or non-bearer header, an invalid token, or the anon key stops here with
 * 401 AUTH_REQUIRED, before the body is read and before any database or Envia call.
 */
export interface GetShippingQuoteDependencies {
  /** The signed-in user behind an access token, or null when the token is not a user session. */
  getUser: (accessToken: string) => Promise<{ id: string } | null>;
  quote: (req: Request) => Promise<Response>;
}

const bearerToken = (req: Request): string | null => {
  const match = /^Bearer\s+(\S+)$/i.exec(
    req.headers.get('Authorization') ?? '',
  );
  return match?.[1] ?? null;
};

export function createGetShippingQuoteHandler(
  deps: GetShippingQuoteDependencies,
) {
  return async (req: Request): Promise<Response> => {
    const token = bearerToken(req);
    const user = token ? await deps.getUser(token) : null;
    if (!user) {
      return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return deps.quote(req);
  };
}
