import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createResolveShipmentRefundHandler,
  type ResolveShipmentRefundDeps,
} from './handler.ts';

const SHIPMENT = '7b310000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const REFERENCE = 'SPEI-2026-10-21-0001';

type RpcResult = { data: unknown; error: { message: string } | null };
type Call = { shipmentId: string; adminId: string; reference: string };
type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };

function harness(
  overrides: {
    userId?: string | null;
    admin?: boolean | Error;
    rpc?: RpcResult | Error;
  } = {},
) {
  const calls: Call[] = [];
  const adminChecks: string[] = [];
  const tokens: string[] = [];
  const logs: LogEntry[] = [];
  const deps: ResolveShipmentRefundDeps = {
    getUserId: async (token) => {
      tokens.push(token);
      return overrides.userId === undefined ? ADMIN : overrides.userId;
    },
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    resolveRefund: async (input) => {
      calls.push(input);
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return (
        overrides.rpc ?? {
          data: {
            resolved: true,
            shipment_cancelled: true,
            amount_owed_cents: 11000,
            reference: input.reference,
          },
          error: null,
        }
      );
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return { handler: createResolveShipmentRefundHandler(deps), calls, adminChecks, tokens, logs };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }) {
  return new Request('http://localhost/functions/v1/resolve-shipment-refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const valid = { shipment_id: SHIPMENT, reference: REFERENCE };

async function send(h: ReturnType<typeof harness>, request: Request) {
  const response = await h.handler(request);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

describe('resolve-shipment-refund handler', () => {
  it('answers CORS preflight without authenticating', async () => {
    const h = harness();
    const response = await h.handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(h.tokens).toEqual([]);
  });

  it('rejects anything but POST with 405 METHOD_NOT_ALLOWED before authenticating', async () => {
    const h = harness();
    const { response, body } = await send(
      h,
      new Request('http://localhost/x', { method: 'GET', headers: { Authorization: 'Bearer t' } }),
    );
    expect(response.status).toBe(405);
    expect(body).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.tokens).toEqual([]);
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-Bearer scheme', { Authorization: 'Basic abc' }],
    ['an empty bearer token', { Authorization: 'Bearer ' }],
  ])('401 AUTH_REQUIRED for %s, before any lookup or RPC', async (_name, headers) => {
    const h = harness();
    const { response, body } = await send(h, post(valid, headers));
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(h.tokens).toEqual([]);
    expect(h.adminChecks).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('401 AUTH_REQUIRED when the JWT does not resolve to a user, without checking admin or resolving', async () => {
    const h = harness({ userId: null });
    const { response, body } = await send(h, post(valid));
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(h.tokens).toEqual(['user-jwt']);
    expect(h.adminChecks).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('403 ADMIN_ONLY for a signed-in non-admin, without resolving or validating the body', async () => {
    const h = harness({ admin: false });
    const { response, body } = await send(h, post({ shipment_id: 'nope' }));
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'ADMIN_ONLY' });
    expect(h.adminChecks).toEqual([ADMIN]);
    expect(h.calls).toEqual([]);
  });

  it('500 INTERNAL_ERROR when the admin lookup fails; the raw error goes to the log only', async () => {
    const h = harness({ admin: new Error('relation profiles_private timeout 10.0.0.5') });
    const { response, text, body } = await send(h, post(valid));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(text).not.toContain('profiles_private');
    expect(h.calls).toEqual([]);
    expect(JSON.stringify(h.logs)).toContain('profiles_private timeout');
    expect(h.logs.some((entry) => entry.level === 'ERROR')).toBe(true);
  });

  it.each([
    ['an unparsable body', 'not json'],
    ['an empty object', {}],
    ['a missing shipment_id', { reference: REFERENCE }],
    ['a numeric shipment_id', { shipment_id: 12, reference: REFERENCE }],
    ['a non-uuid shipment_id', { shipment_id: 'abc', reference: REFERENCE }],
    ['an array body', [SHIPMENT]],
  ])('422 INVALID_SHIPMENT_ID for %s', async (_name, payload) => {
    const h = harness();
    const { response, body } = await send(h, post(payload));
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: 'INVALID_SHIPMENT_ID' });
    expect(h.calls).toEqual([]);
  });

  it.each([
    ['a missing reference', { shipment_id: SHIPMENT }],
    ['a null reference', { shipment_id: SHIPMENT, reference: null }],
    ['a numeric reference', { shipment_id: SHIPMENT, reference: 42 }],
    ['an empty reference', { shipment_id: SHIPMENT, reference: '' }],
    ['a blank reference', { shipment_id: SHIPMENT, reference: '   \n\t ' }],
    ['a 201 character reference', { shipment_id: SHIPMENT, reference: 'x'.repeat(201) }],
    ['a padded 201 character reference', { shipment_id: SHIPMENT, reference: ` ${'x'.repeat(201)} ` }],
  ])('422 INVALID_RESOLUTION_REFERENCE for %s', async (_name, payload) => {
    const h = harness();
    const { response, body } = await send(h, post(payload));
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: 'INVALID_RESOLUTION_REFERENCE' });
    expect(h.calls).toEqual([]);
  });

  it('resolves for an admin: trims the reference, passes the caller id and returns the exact result', async () => {
    const h = harness();
    const { response, body } = await send(
      h,
      post({ shipment_id: SHIPMENT, reference: `  ${'x'.repeat(200)}  ` }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(body).toEqual({
      resolved: true,
      shipment_cancelled: true,
      amount_owed_cents: 11000,
      reference: 'x'.repeat(200),
    });
    expect(h.calls).toEqual([{ shipmentId: SHIPMENT, adminId: ADMIN, reference: 'x'.repeat(200) }]);
    expect(h.logs.some((entry) => entry.level === 'INFO')).toBe(true);
  });

  it('never takes the admin id or an amount from the body', async () => {
    const h = harness();
    await send(h, post({ ...valid, admin_id: 'forged', amount_owed_cents: 1, adminId: 'forged' }));
    expect(h.calls).toEqual([{ shipmentId: SHIPMENT, adminId: ADMIN, reference: REFERENCE }]);
  });

  it('returns the idempotent result of an already resolved refund as 200', async () => {
    const h = harness({
      rpc: {
        data: { resolved: false, shipment_cancelled: false, amount_owed_cents: 11000, reference: 'FIRST' },
        error: null,
      },
    });
    const { response, body } = await send(h, post(valid));
    expect(response.status).toBe(200);
    expect(body).toEqual({
      resolved: false,
      shipment_cancelled: false,
      amount_owed_cents: 11000,
      reference: 'FIRST',
    });
  });

  it.each([
    ['REFUND_NOT_RESOLVABLE', 'REFUND_NOT_RESOLVABLE', 409],
    ['SHIPMENT_STATUS_UNEXPECTED: shipped', 'SHIPMENT_STATUS_UNEXPECTED', 409],
    ['INVALID_RESOLUTION_REFERENCE', 'INVALID_RESOLUTION_REFERENCE', 422],
  ])('maps the RPC error %s to a stable %s / %d without echoing the database text', async (message, code, status) => {
    const h = harness({ rpc: { data: null, error: { message } } });
    const { response, text, body } = await send(h, post(valid));
    expect(response.status).toBe(status);
    expect(body).toEqual({ error: code });
    expect(text).not.toContain('shipped');
    expect(JSON.stringify(h.logs)).toContain(message);
  });

  it.each([
    'CANCELLATION_COMPLETE_FAILED: INTERNAL_SERVER_ERROR',
    'UNAUTHORIZED',
    'ADMIN_REQUIRED',
    'insert or update on table "admin_audit_logs" violates foreign key constraint',
  ])('500 INTERNAL_ERROR for the unexpected RPC error %s; raw text only in the log', async (message) => {
    const h = harness({ rpc: { data: null, error: { message } } });
    const { response, text, body } = await send(h, post(valid));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(text).not.toContain(message);
    expect(h.logs.some((entry) => entry.data?.error === message)).toBe(true);
  });

  it('500 INTERNAL_ERROR when the RPC throws', async () => {
    const h = harness({ rpc: new Error('socket hang up') });
    const { response, text, body } = await send(h, post(valid));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(text).not.toContain('socket');
    expect(JSON.stringify(h.logs)).toContain('socket hang up');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['missing resolved', { shipment_cancelled: true, amount_owed_cents: 1, reference: 'r' }],
    ['a string amount', { resolved: true, shipment_cancelled: true, amount_owed_cents: '1', reference: 'r' }],
    ['a missing reference', { resolved: true, shipment_cancelled: false, amount_owed_cents: 1 }],
  ])('500 INTERNAL_ERROR for a malformed RPC result (%s) instead of reporting success', async (_name, data) => {
    const h = harness({ rpc: { data, error: null } });
    const { response, body } = await send(h, post(valid));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR' });
  });
});

describe('resolve-shipment-refund wiring (source contract)', () => {
  const root = join(import.meta.dir, '..', '..', '..');
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('is wrapped in withSentry under its folder name and serves the handler', () => {
    expect(index).toContain("serve(withSentry('resolve-shipment-refund',");
    expect(index).toContain("from '../_shared/sentry.ts'");
  });

  it('checks an active admin in profiles_private and calls the service-only RPC with server credentials', () => {
    expect(index).toContain(".from('profiles_private')");
    expect(index).toContain(".select('role, status')");
    expect(index).toContain('return isActiveAdmin(data);');
    expect(index).toContain('fn_resolve_shipment_cancellation_refund');
    expect(index).toContain('p_admin_id');
    expect(index).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(index).toContain("from '../../../packages/types/src/database.types.ts'");
  });

  it('is declared in config.toml with JWT verification on', () => {
    const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8').replace(/\r\n/g, '\n');
    expect(config).toMatch(/\[functions\.resolve-shipment-refund\]\nverify_jwt = true/);
  });
});

describe('isActiveAdmin', () => {
  it('accepts only an admin role whose account is active (a NULL status counts as active, like is_admin())', async () => {
    const { isActiveAdmin } = await import('./handler.ts');
    expect(isActiveAdmin({ role: 'admin', status: 'active' })).toBe(true);
    expect(isActiveAdmin({ role: 'admin', status: null })).toBe(true);
    expect(isActiveAdmin({ role: 'admin', status: 'suspended' })).toBe(false);
    expect(isActiveAdmin({ role: 'admin', status: 'banned' })).toBe(false);
    expect(isActiveAdmin({ role: 'user', status: 'active' })).toBe(false);
    expect(isActiveAdmin(null)).toBe(false);
  });
});
