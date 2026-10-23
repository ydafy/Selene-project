/**
 * @file supabase/functions/delete-account/handler.ts
 *
 * Self-service account closure (auth-hardening S8, "anonymize and close").
 * Pure decision logic: index.ts wires Supabase auth, the service-only RPC
 * `fn_close_account`, Stripe and Storage into these ports. Raw database, Stripe
 * and Storage text never reaches the response or the log.
 *
 * Response codes (the app depends on them, keep them stable):
 *   200 { success: true }                         closed or already closed; cleanup failures
 *                                                 do not change it (the account is closed,
 *                                                 the cleanup retry finishes the job)
 *   401 { error: 'AUTH_REQUIRED' }                missing or invalid access token
 *   403 { error: 'REAUTH_REQUIRED' }              last sign-in older than 10 minutes
 *   404 { error: 'NOT_FOUND' }                    no profile for the user
 *   405 { error: 'METHOD_NOT_ALLOWED' }           anything but POST
 *   409 { error: 'DELETE_BLOCKED', blocked_reason }  nothing was changed; reasons:
 *       account_restricted | active_shipments | active_orders | open_disputes
 *       | pending_payouts | pending_refunds
 *   500 { error: 'INTERNAL' }                     RPC error or unexpected failure
 *   503 { error: 'TEMPORARILY_UNAVAILABLE' }      the auth server could not check the token (5xx,
 *                                                 429 or network failure); nothing was changed, retry
 */
import {
  asRecord,
  parseClosureCleanup,
  runClosureCleanup,
  safeErrorCode,
  type ClosureCleanupPorts,
  type ClosureCleanupUpdate,
} from '../_shared/account-closure-cleanup.ts';

export type { ClosureCleanupUpdate };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

/** A sign-in older than this no longer proves who is at the keyboard (S8). */
const MAX_SIGN_IN_AGE_SECONDS = 10 * 60;

const BLOCKED_REASONS = [
  'account_restricted',
  'active_shipments',
  'active_orders',
  'open_disputes',
  'pending_payouts',
  'pending_refunds',
] as const;
type BlockedReason = (typeof BLOCKED_REASONS)[number];

/** Thrown by `getUserId` when the token could not be checked (not when it is invalid). */
export class AuthUnavailableError extends Error {
  constructor() {
    super('AUTH_UNAVAILABLE');
    this.name = 'AuthUnavailableError';
  }
}

/**
 * Whether an `auth.getUser` error says the auth server failed rather than the token being
 * bad: a 4xx (except 429) is a verdict on the token; 5xx, 429, status 0 or no status is not.
 */
export function isTransientAuthError(error: unknown): boolean {
  const status = asRecord(error)?.status;
  if (typeof status !== 'number') return true;
  return status === 0 || status === 429 || status >= 500;
}

export type DeleteAccountDeps = {
  /**
   * The user id behind the access token, or null when it does not resolve to a user.
   * Throws `AuthUnavailableError` when the check itself could not be made.
   */
  getUserId: (accessToken: string) => Promise<string | null>;
  now: () => number;
  closeAccount: (
    userId: string,
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
} & ClosureCleanupPorts;

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response => respond(status, { error: code });

/** Newest `amr` timestamp (seconds) of an already validated access token, or null. */
export function latestSignInSeconds(accessToken: string): number | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = asRecord(JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))));
    const amr = claims?.amr;
    if (!Array.isArray(amr)) return null;
    let newest: number | null = null;
    for (const entry of amr) {
      const timestamp = asRecord(entry)?.timestamp;
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        newest = newest === null ? timestamp : Math.max(newest, timestamp);
      }
    }
    return newest;
  } catch {
    return null;
  }
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      let userId: string | null;
      try {
        userId = await deps.getUserId(token);
      } catch (error: unknown) {
        if (!(error instanceof AuthUnavailableError)) throw error;
        deps.log('WARN', 'Account closure could not check the token');
        return fail(503, 'TEMPORARILY_UNAVAILABLE');
      }
      if (!userId) return fail(401, 'AUTH_REQUIRED');

      // The token is validated, so its claims can be read: a missing or stale
      // sign-in proof stops everything before any data is touched.
      const signedInAt = latestSignInSeconds(token);
      if (signedInAt === null || deps.now() / 1000 - signedInAt > MAX_SIGN_IN_AGE_SECONDS) {
        deps.log('WARN', 'Account closure needs a recent sign-in', { userId });
        return fail(403, 'REAUTH_REQUIRED');
      }

      const { data, error } = await deps.closeAccount(userId);
      if (error) {
        deps.log('ERROR', 'Account closure failed', { userId, code: error.code });
        return fail(500, 'INTERNAL');
      }

      const result = asRecord(data);
      switch (result?.status) {
        case 'not_found':
          return fail(404, 'NOT_FOUND');
        case 'blocked': {
          const reason = result.reason;
          if (!BLOCKED_REASONS.includes(reason as BlockedReason)) break;
          deps.log('WARN', 'Account closure blocked', { userId, reason });
          return respond(409, { error: 'DELETE_BLOCKED', blocked_reason: reason });
        }
        case 'closed':
        case 'already_closed': {
          const closure = parseClosureCleanup(result);
          if (!closure) break;
          deps.log('INFO', 'Account closed', { userId, status: result.status });
          try {
            await runClosureCleanup(userId, closure, deps);
          } catch (error: unknown) {
            // The account is already closed: the retry worker finishes the cleanup.
            deps.log('ERROR', 'Account closure cleanup crashed', { userId, code: safeErrorCode(error) });
          }
          return respond(200, { success: true });
        }
      }

      deps.log('ERROR', 'Account closure returned an unusable result', { userId });
      return fail(500, 'INTERNAL');
    } catch (error: unknown) {
      deps.log('ERROR', 'Account closure crashed', { code: safeErrorCode(error) });
      return fail(500, 'INTERNAL');
    }
  };
}
