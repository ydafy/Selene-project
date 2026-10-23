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
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

/** A sign-in older than this no longer proves who is at the keyboard (S8). */
const MAX_SIGN_IN_AGE_SECONDS = 10 * 60;

/** Stripe codes that mean the object is already deleted, so the step is done. */
const GONE_CUSTOMER_CODES = ['resource_missing'] as const;
// Stripe answers a deleted connected account with `account_invalid` (observed in the
// sandbox), not `resource_missing`.
const GONE_ACCOUNT_CODES = ['resource_missing', 'account_invalid'] as const;

const BLOCKED_REASONS = [
  'account_restricted',
  'active_shipments',
  'active_orders',
  'open_disputes',
  'pending_payouts',
  'pending_refunds',
] as const;
type BlockedReason = (typeof BLOCKED_REASONS)[number];

type CleanupState = 'pending' | 'done' | 'failed' | 'not_needed';
const CLEANUP_STATES: readonly string[] = ['pending', 'done', 'failed', 'not_needed'];

/** One write to `account_closures`; `attempt` adds one to `attempts` and stamps `last_error`. */
export type ClosureCleanupUpdate =
  | { stripe_customer_cleanup: 'done' | 'failed' | 'not_needed' }
  | { stripe_account_cleanup: 'done' | 'failed' | 'not_needed' }
  | { storage_cleanup: 'done' | 'failed' }
  | { attempt: true; last_error: string | null };

export type DeleteAccountDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  now: () => number;
  closeAccount: (
    userId: string,
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  /** Throws on failure; an error with `code: 'resource_missing'` means it is already gone. */
  deleteStripeCustomer: (customerId: string) => Promise<void>;
  deleteStripeAccount: (accountId: string) => Promise<void>;
  /** Removes the avatar folder and the images of the listings the closure soft-deleted. */
  removeStorageFiles: (userId: string) => Promise<void>;
  recordCleanup: (userId: string, update: ClosureCleanupUpdate) => Promise<void>;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => unknown;
};

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response => respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

/** A short machine code that is safe to store and log; never the provider message. */
function safeErrorCode(error: unknown): string {
  const code = asRecord(error)?.code;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'error';
}

const isCleanupState = (value: unknown): value is CleanupState =>
  typeof value === 'string' && CLEANUP_STATES.includes(value);

const needsWork = (state: CleanupState): boolean => state === 'pending' || state === 'failed';

type Closure = {
  customerId: string | null;
  accountId: string | null;
  customerCleanup: CleanupState;
  accountCleanup: CleanupState;
  storageCleanup: CleanupState;
};

function parseClosure(result: Record<string, unknown>): Closure | null {
  const { stripe_customer_id: customerId, stripe_account_id: accountId } = result;
  const { stripe_customer_cleanup: customerCleanup, stripe_account_cleanup: accountCleanup } = result;
  const storageCleanup = result.storage_cleanup;
  if (
    (customerId !== null && typeof customerId !== 'string') ||
    (accountId !== null && typeof accountId !== 'string') ||
    !isCleanupState(customerCleanup) ||
    !isCleanupState(accountCleanup) ||
    !isCleanupState(storageCleanup)
  ) {
    return null;
  }
  return { customerId, accountId, customerCleanup, accountCleanup, storageCleanup };
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps) {
  /** Records one step result; a failed write is logged and never changes the answer. */
  async function record(userId: string, update: ClosureCleanupUpdate): Promise<void> {
    try {
      await deps.recordCleanup(userId, update);
    } catch {
      deps.log('ERROR', 'Account closure cleanup state not saved', { userId });
    }
  }

  async function cleanup(userId: string, closure: Closure): Promise<void> {
    const failures: string[] = [];
    let worked = false;

    const stripeStep = async (
      label: 'stripe_customer' | 'stripe_account',
      id: string | null,
      remove: (id: string) => Promise<void>,
      column: 'stripe_customer_cleanup' | 'stripe_account_cleanup',
      goneCodes: readonly string[],
    ) => {
      worked = true;
      if (id === null) return record(userId, { [column]: 'not_needed' } as ClosureCleanupUpdate);
      try {
        await remove(id);
      } catch (error: unknown) {
        const code = safeErrorCode(error);
        if (!goneCodes.includes(code)) {
          failures.push(`${label}:${code}`);
          deps.log('WARN', 'Account closure cleanup step failed', { userId, step: label, code });
          return record(userId, { [column]: 'failed' } as ClosureCleanupUpdate);
        }
      }
      return record(userId, { [column]: 'done' } as ClosureCleanupUpdate);
    };

    if (needsWork(closure.customerCleanup)) {
      await stripeStep(
        'stripe_customer',
        closure.customerId,
        deps.deleteStripeCustomer,
        'stripe_customer_cleanup',
        GONE_CUSTOMER_CODES,
      );
    }
    if (needsWork(closure.accountCleanup)) {
      await stripeStep(
        'stripe_account',
        closure.accountId,
        deps.deleteStripeAccount,
        'stripe_account_cleanup',
        GONE_ACCOUNT_CODES,
      );
    }
    if (needsWork(closure.storageCleanup)) {
      worked = true;
      try {
        await deps.removeStorageFiles(userId);
        await record(userId, { storage_cleanup: 'done' });
      } catch (error: unknown) {
        const code = safeErrorCode(error);
        failures.push(`storage:${code}`);
        deps.log('WARN', 'Account closure cleanup step failed', { userId, step: 'storage', code });
        await record(userId, { storage_cleanup: 'failed' });
      }
    }

    if (worked) {
      await record(userId, {
        attempt: true,
        last_error: failures.length > 0 ? failures.join(';') : null,
      });
    }
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      const userId = await deps.getUserId(token);
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
          const closure = parseClosure(result);
          if (!closure) break;
          deps.log('INFO', 'Account closed', { userId, status: result.status });
          try {
            await cleanup(userId, closure);
          } catch {
            // The account is already closed: the retry finishes the cleanup.
            deps.log('ERROR', 'Account closure cleanup crashed', { userId });
          }
          return respond(200, { success: true });
        }
      }

      deps.log('ERROR', 'Account closure returned an unusable result', { userId });
      return fail(500, 'INTERNAL');
    } catch {
      deps.log('ERROR', 'Account closure crashed');
      return fail(500, 'INTERNAL');
    }
  };
}
