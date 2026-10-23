import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AuthUnavailableError,
  createDeleteAccountHandler,
  isTransientAuthError,
  latestSignInSeconds,
  type ClosureCleanupUpdate,
  type DeleteAccountDeps,
} from './handler.ts';

const USER = '00000000-0000-4000-8000-0000000000aa';
const CUSTOMER = 'cus_test_123';
const ACCOUNT = 'acct_test_123';
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const RAW_DB_MESSAGE = 'duplicate key value violates constraint "secret_table_pkey"';
const RAW_STRIPE_MESSAGE = 'You cannot delete acct_test_123 for jane@example.com: balance is 500';

type Amr = { method: string; timestamp: number }[] | undefined;
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };

const closedPayload = (overrides: Record<string, unknown> = {}) => ({
  status: 'closed',
  closed_at: '2026-10-22T10:00:00Z',
  stripe_customer_id: CUSTOMER,
  stripe_account_id: ACCOUNT,
  stripe_customer_cleanup: 'pending',
  stripe_account_cleanup: 'pending',
  storage_cleanup: 'pending',
  ...overrides,
});

function tokenWith(amr: Amr): string {
  const payload = Buffer.from(JSON.stringify(amr === undefined ? { sub: USER } : { sub: USER, amr })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

const freshAmr: Amr = [{ method: 'password', timestamp: NOW_S - 60 }];

function stripeError(code: string, message = RAW_STRIPE_MESSAGE) {
  return Object.assign(new Error(message), { code, type: 'invalid_request_error' });
}

function harness(
  overrides: {
    userId?: string | null;
    userIdError?: Error;
    warnThrows?: boolean;
    rpc?: RpcResult | Error;
    customer?: Error;
    account?: Error;
    storage?: Error;
    record?: Error;
  } = {},
) {
  const closeCalls: string[] = [];
  const customerCalls: string[] = [];
  const accountCalls: string[] = [];
  const storageCalls: string[] = [];
  const records: { userId: string; update: ClosureCleanupUpdate }[] = [];
  const logs: LogEntry[] = [];
  const tokens: string[] = [];
  const deps: DeleteAccountDeps = {
    getUserId: async (token) => {
      tokens.push(token);
      if (overrides.userIdError) throw overrides.userIdError;
      return overrides.userId === undefined ? USER : overrides.userId;
    },
    now: () => NOW_MS,
    closeAccount: async (userId) => {
      closeCalls.push(userId);
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: closedPayload(), error: null };
    },
    deleteStripeCustomer: async (id) => {
      customerCalls.push(id);
      if (overrides.customer) throw overrides.customer;
    },
    deleteStripeAccount: async (id) => {
      accountCalls.push(id);
      if (overrides.account) throw overrides.account;
    },
    removeStorageFiles: async (userId) => {
      storageCalls.push(userId);
      if (overrides.storage) throw overrides.storage;
    },
    recordCleanup: async (userId, update) => {
      records.push({ userId, update });
      if (overrides.record) throw overrides.record;
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
      if (overrides.warnThrows && level === 'WARN') throw new Error('log sink down');
    },
  };
  return {
    handler: createDeleteAccountHandler(deps),
    closeCalls,
    customerCalls,
    accountCalls,
    storageCalls,
    records,
    logs,
    tokens,
  };
}

function post(token: string | null = tokenWith(freshAmr), method = 'POST') {
  return new Request('http://localhost/functions/v1/delete-account', {
    method,
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

async function send(h: ReturnType<typeof harness>, request: Request) {
  const response = await h.handler(request);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

const nothingHappened = (h: ReturnType<typeof harness>) => {
  expect(h.closeCalls).toEqual([]);
  expect(h.customerCalls).toEqual([]);
  expect(h.accountCalls).toEqual([]);
  expect(h.storageCalls).toEqual([]);
  expect(h.records).toEqual([]);
};

describe('delete-account handler: request and auth', () => {
  it('answers CORS preflight without authenticating', async () => {
    const h = harness();
    const response = await h.handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(h.tokens).toEqual([]);
  });

  it('rejects methods other than POST', async () => {
    const h = harness();
    const { response, body } = await send(h, post(tokenWith(freshAmr), 'GET'));
    expect(response.status).toBe(405);
    expect(body).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    nothingHappened(h);
  });

  it('401 AUTH_REQUIRED without an Authorization header', async () => {
    const h = harness();
    const { response, body } = await send(h, post(null));
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(h.tokens).toEqual([]);
    nothingHappened(h);
  });

  it('401 AUTH_REQUIRED when the token does not resolve to a user', async () => {
    const h = harness({ userId: null });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'AUTH_REQUIRED' });
    nothingHappened(h);
  });

  it('passes the bare bearer token to the validator', async () => {
    const h = harness();
    const token = tokenWith(freshAmr);
    await send(h, post(token));
    expect(h.tokens).toEqual([token]);
  });
});

describe('delete-account handler: recent sign-in (REAUTH_REQUIRED)', () => {
  it('403 when the token carries no amr claim', async () => {
    const h = harness();
    const { response, body } = await send(h, post(tokenWith(undefined)));
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'REAUTH_REQUIRED' });
    nothingHappened(h);
  });

  it('403 when amr is empty or malformed', async () => {
    for (const amr of [[], [{ method: 'password' }], [{ method: 'password', timestamp: 'now' }]]) {
      const h = harness();
      const { response, body } = await send(h, post(tokenWith(amr as Amr)));
      expect(response.status).toBe(403);
      expect(body).toEqual({ error: 'REAUTH_REQUIRED' });
      nothingHappened(h);
    }
  });

  it('403 when the token is not a decodable JWT', async () => {
    const h = harness();
    const { response, body } = await send(h, post('not-a-jwt'));
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'REAUTH_REQUIRED' });
    nothingHappened(h);
  });

  it('403 when the newest sign-in is older than 10 minutes', async () => {
    const h = harness();
    const stale: Amr = [{ method: 'password', timestamp: NOW_S - 601 }];
    const { response, body } = await send(h, post(tokenWith(stale)));
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'REAUTH_REQUIRED' });
    nothingHappened(h);
  });

  it('accepts a sign-in exactly 10 minutes old', async () => {
    const h = harness();
    const edge: Amr = [{ method: 'password', timestamp: NOW_S - 600 }];
    const { response } = await send(h, post(tokenWith(edge)));
    expect(response.status).toBe(200);
  });

  it('uses the newest amr entry, not the first', async () => {
    const h = harness();
    const mixed: Amr = [
      { method: 'password', timestamp: NOW_S - 86_400 },
      { method: 'otp', timestamp: NOW_S - 30 },
    ];
    const { response } = await send(h, post(tokenWith(mixed)));
    expect(response.status).toBe(200);
  });

  it('accepts a Google sign-in (oauth method) the same way', async () => {
    const h = harness();
    const google: Amr = [{ method: 'oauth', timestamp: NOW_S - 5 }];
    const { response } = await send(h, post(tokenWith(google)));
    expect(response.status).toBe(200);
  });
});

describe('delete-account handler: RPC outcomes', () => {
  it('calls the RPC with the validated user id, never one from the request', async () => {
    const h = harness();
    await send(h, post());
    expect(h.closeCalls).toEqual([USER]);
  });

  for (const reason of [
    'account_restricted',
    'active_shipments',
    'active_orders',
    'open_disputes',
    'pending_payouts',
    'pending_refunds',
  ]) {
    it(`409 DELETE_BLOCKED with ${reason} and no cleanup`, async () => {
      const h = harness({ rpc: { data: { status: 'blocked', reason }, error: null } });
      const { response, body } = await send(h, post());
      expect(response.status).toBe(409);
      expect(body).toEqual({ error: 'DELETE_BLOCKED', blocked_reason: reason });
      expect(h.customerCalls).toEqual([]);
      expect(h.accountCalls).toEqual([]);
      expect(h.storageCalls).toEqual([]);
      expect(h.records).toEqual([]);
    });
  }

  it('500 INTERNAL for a blocked reason the app does not know', async () => {
    const h = harness({ rpc: { data: { status: 'blocked', reason: 'something_new' }, error: null } });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL' });
  });

  it('404 NOT_FOUND when the user has no private profile', async () => {
    const h = harness({ rpc: { data: { status: 'not_found' }, error: null } });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'NOT_FOUND' });
    expect(h.records).toEqual([]);
  });

  it('500 INTERNAL on an RPC error without the database message in body or log', async () => {
    const h = harness({ rpc: { data: null, error: { code: '23505', message: RAW_DB_MESSAGE } } });
    const { response, text, body } = await send(h, post());
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL' });
    expect(text).not.toContain('secret_table');
    expect(JSON.stringify(h.logs)).not.toContain('secret_table');
    expect(h.logs.some((l) => l.level === 'ERROR' && l.data?.userId === USER)).toBe(true);
    expect(h.customerCalls).toEqual([]);
  });

  it('500 INTERNAL when the RPC returns an unusable payload', async () => {
    for (const data of [null, 'closed', { status: 'weird' }, []]) {
      const h = harness({ rpc: { data, error: null } });
      const { response, body } = await send(h, post());
      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'INTERNAL' });
      expect(h.customerCalls).toEqual([]);
    }
  });

  it('500 INTERNAL when a dependency throws, without its message', async () => {
    const h = harness({ rpc: new Error(RAW_DB_MESSAGE) });
    const { response, text, body } = await send(h, post());
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL' });
    expect(text).not.toContain('secret_table');
    expect(JSON.stringify(h.logs)).not.toContain('secret_table');
  });
});

describe('delete-account handler: cleanup after closure', () => {
  it('closed with every step ok: removes customer, account and files, records each as done', async () => {
    const h = harness();
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.customerCalls).toEqual([CUSTOMER]);
    expect(h.accountCalls).toEqual([ACCOUNT]);
    expect(h.storageCalls).toEqual([USER]);
    expect(h.records.map((r) => r.userId)).toEqual([USER, USER, USER, USER]);
    expect(h.records.map((r) => r.update)).toEqual([
      { stripe_customer_cleanup: 'done' },
      { stripe_account_cleanup: 'done' },
      { storage_cleanup: 'done' },
      { attempt: true, last_error: null },
    ]);
  });

  it('skips Stripe steps with no id (not_needed) and still cleans storage', async () => {
    const h = harness({
      rpc: {
        data: closedPayload({
          stripe_customer_id: null,
          stripe_account_id: null,
          stripe_customer_cleanup: 'not_needed',
          stripe_account_cleanup: 'not_needed',
        }),
        error: null,
      },
    });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.customerCalls).toEqual([]);
    expect(h.accountCalls).toEqual([]);
    expect(h.storageCalls).toEqual([USER]);
    expect(h.records.map((r) => r.update)).toEqual([
      { storage_cleanup: 'done' },
      { attempt: true, last_error: null },
    ]);
  });

  it('a Stripe refusal still answers 200, marks the step failed with a sanitized reason and runs the rest', async () => {
    const h = harness({ account: stripeError('balance_insufficient') });
    const { response, text, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.customerCalls).toEqual([CUSTOMER]);
    expect(h.storageCalls).toEqual([USER]);
    expect(h.records.map((r) => r.update)).toEqual([
      { stripe_customer_cleanup: 'done' },
      { stripe_account_cleanup: 'failed' },
      { storage_cleanup: 'done' },
      { attempt: true, last_error: 'stripe_account:balance_insufficient' },
    ]);
    const everything = text + JSON.stringify(h.records) + JSON.stringify(h.logs);
    expect(everything).not.toContain('jane@example.com');
    expect(everything).not.toContain('balance is 500');
  });

  it('a Stripe error without a usable code is recorded as a generic reason', async () => {
    const h = harness({ customer: new Error(RAW_STRIPE_MESSAGE) });
    const { response } = await send(h, post());
    expect(response.status).toBe(200);
    expect(h.records.map((r) => r.update)).toContainEqual({ stripe_customer_cleanup: 'failed' });
    expect(h.records.at(-1)?.update).toEqual({ attempt: true, last_error: 'stripe_customer:error' });
    expect(JSON.stringify(h.records)).not.toContain('jane@example.com');
  });

  it('resource_missing counts as done for the customer and the account', async () => {
    const h = harness({ customer: stripeError('resource_missing'), account: stripeError('resource_missing') });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.records.map((r) => r.update)).toEqual([
      { stripe_customer_cleanup: 'done' },
      { stripe_account_cleanup: 'done' },
      { storage_cleanup: 'done' },
      { attempt: true, last_error: null },
    ]);
  });

  it('account_invalid counts as done for the Connect account only (Stripe answers it for an account it already deleted)', async () => {
    const gone = harness({ account: stripeError('account_invalid') });
    const { response } = await send(gone, post());
    expect(response.status).toBe(200);
    expect(gone.records.map((r) => r.update)).toContainEqual({ stripe_account_cleanup: 'done' });
    expect(gone.records.at(-1)?.update).toEqual({ attempt: true, last_error: null });

    const customer = harness({ customer: stripeError('account_invalid') });
    await send(customer, post());
    expect(customer.records.map((r) => r.update)).toContainEqual({ stripe_customer_cleanup: 'failed' });
  });

  it('a storage failure still answers 200 and is recorded as failed', async () => {
    const h = harness({ storage: new Error('bucket exploded for jane@example.com') });
    const { response, text, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.records.map((r) => r.update)).toEqual([
      { stripe_customer_cleanup: 'done' },
      { stripe_account_cleanup: 'done' },
      { storage_cleanup: 'failed' },
      { attempt: true, last_error: 'storage:error' },
    ]);
    expect(text + JSON.stringify(h.records) + JSON.stringify(h.logs)).not.toContain('jane@example.com');
  });

  it('joins every failed step in last_error', async () => {
    const h = harness({
      customer: stripeError('api_connection_error'),
      account: stripeError('balance_insufficient'),
      storage: new Error('x'),
    });
    await send(h, post());
    expect(h.records.at(-1)?.update).toEqual({
      attempt: true,
      last_error: 'stripe_customer:api_connection_error;stripe_account:balance_insufficient;storage:error',
    });
  });

  it('still answers 200 when recording the cleanup result fails', async () => {
    const h = harness({ record: new Error(RAW_DB_MESSAGE) });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(JSON.stringify(h.logs)).not.toContain('secret_table');
  });

  it('already_closed retries only the steps still pending or failed', async () => {
    const h = harness({
      rpc: {
        data: closedPayload({
          status: 'already_closed',
          stripe_customer_cleanup: 'done',
          stripe_account_cleanup: 'failed',
          storage_cleanup: 'pending',
        }),
        error: null,
      },
    });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.customerCalls).toEqual([]);
    expect(h.accountCalls).toEqual([ACCOUNT]);
    expect(h.storageCalls).toEqual([USER]);
    expect(h.records.map((r) => r.update)).toEqual([
      { stripe_account_cleanup: 'done' },
      { storage_cleanup: 'done' },
      { attempt: true, last_error: null },
    ]);
  });

  it('marks a pending Stripe step not_needed when the closure holds no id for it', async () => {
    const h = harness({
      rpc: {
        data: closedPayload({ status: 'already_closed', stripe_customer_id: null, stripe_account_id: null }),
        error: null,
      },
    });
    const { response } = await send(h, post());
    expect(response.status).toBe(200);
    expect(h.customerCalls).toEqual([]);
    expect(h.accountCalls).toEqual([]);
    expect(h.records.slice(0, 2).map((r) => r.update)).toEqual([
      { stripe_customer_cleanup: 'not_needed' },
      { stripe_account_cleanup: 'not_needed' },
    ]);
  });

  it('already_closed with nothing left does no work and writes nothing', async () => {
    const h = harness({
      rpc: {
        data: closedPayload({
          status: 'already_closed',
          stripe_customer_cleanup: 'done',
          stripe_account_cleanup: 'not_needed',
          storage_cleanup: 'done',
        }),
        error: null,
      },
    });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(h.customerCalls).toEqual([]);
    expect(h.accountCalls).toEqual([]);
    expect(h.storageCalls).toEqual([]);
    expect(h.records).toEqual([]);
  });

  it('never logs the token, emails or raw messages', async () => {
    const token = tokenWith(freshAmr);
    const h = harness({ account: stripeError('balance_insufficient'), storage: new Error(RAW_DB_MESSAGE) });
    await send(h, post(token));
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('jane@example.com');
    expect(logged).not.toContain('secret_table');
    expect(logged).not.toContain('balance is 500');
  });
});

describe('delete-account handler: transient auth failures', () => {
  it('503 TEMPORARILY_UNAVAILABLE when the token check is unavailable, with no side effects', async () => {
    const h = harness({ userIdError: new AuthUnavailableError() });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'TEMPORARILY_UNAVAILABLE' });
    nothingHappened(h);
  });

  it('keeps 401 AUTH_REQUIRED for a token the auth server rejects', async () => {
    const h = harness({ userId: null });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'AUTH_REQUIRED' });
  });

  it('classifies the auth error status: 4xx is an invalid token, the rest is transient', () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isTransientAuthError({ status })).toBe(false);
    for (const status of [0, 429, 500, 502, 503]) expect(isTransientAuthError({ status })).toBe(true);
    expect(isTransientAuthError({})).toBe(true);
    expect(isTransientAuthError(new Error('fetch failed'))).toBe(true);
    expect(isTransientAuthError(null)).toBe(true);
  });
});

describe('delete-account handler: malformed token payload', () => {
  it('latestSignInSeconds returns null instead of throwing on a broken payload', () => {
    const payloads = [
      '%%%',
      'bm90IGpzb24',
      'W10',
      'bnVsbA',
      Buffer.from('{"amr":[null,1,{"timestamp":"x"}]}').toString('base64url'),
    ];
    for (const payload of payloads) {
      expect(() => latestSignInSeconds(`h.${payload}.s`)).not.toThrow();
      expect(latestSignInSeconds(`h.${payload}.s`)).toBeNull();
    }
  });
});

describe('delete-account handler: crash logs', () => {
  it('logs a sanitized code, never the message, when the request crashes', async () => {
    const h = harness({
      userIdError: Object.assign(new Error('boom for jane@example.com'), { code: 'upstream_down' }),
    });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL' });
    const crash = h.logs.find((entry) => entry.msg === 'Account closure crashed');
    expect(crash?.data).toEqual({ code: 'upstream_down' });
    expect(JSON.stringify(h.logs)).not.toContain('jane@example.com');
  });

  it('falls back to a generic code when the error has none', async () => {
    const h = harness({ userIdError: new Error('x') });
    await send(h, post());
    expect(h.logs.find((entry) => entry.msg === 'Account closure crashed')?.data).toEqual({ code: 'error' });
  });

  it('logs the code when the cleanup itself crashes and still answers 200', async () => {
    const h = harness({ warnThrows: true, customer: stripeError('api_connection_error') });
    const { response, body } = await send(h, post());
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    const crash = h.logs.find((entry) => entry.msg === 'Account closure cleanup crashed');
    expect(crash?.data).toEqual({ userId: USER, code: 'error' });
  });
});

describe('delete-account wiring (source contract)', () => {
  const root = join(import.meta.dir, '..', '..', '..');
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('is wrapped in withSentry under its folder name and serves the handler', () => {
    expect(index).toContain("serve(withSentry('delete-account',");
    expect(index).toContain("from '../_shared/sentry.ts'");
  });

  it('calls the service-only RPC with server credentials and a typed client', () => {
    expect(index).toContain('fn_close_account');
    expect(index).toContain('p_user_id');
    expect(index).toContain('createClient<Database>');
    expect(index).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('shares the cleanup with the retry worker instead of carrying its own copy', () => {
    expect(index).toContain("from '../_shared/account-closure-cleanup.ts'");
    expect(index).toContain('createSupabaseClosurePorts');
    expect(index).not.toContain('customers.del');
    expect(readFileSync(join(import.meta.dir, 'handler.ts'), 'utf8')).toContain(
      "from '../_shared/account-closure-cleanup.ts'",
    );
  });

  it('answers a transient auth.getUser failure as unavailable, keeping 401 for an invalid token', () => {
    expect(index).toContain('isTransientAuthError');
    expect(index).toContain('AuthUnavailableError');
  });

  it('is declared in config.toml with JWT verification on', () => {
    const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8').replace(/\r\n/g, '\n');
    expect(config).toMatch(/\[functions\.delete-account\]\nverify_jwt = true/);
  });

  it('keeps the canonical fn_close_account.sql grants in line with the migration', () => {
    const sql = readFileSync(join(root, 'supabase/queries/auth/fn_close_account.sql'), 'utf8');
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_close_account(uuid) FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_close_account(uuid) TO service_role;');
  });
});
