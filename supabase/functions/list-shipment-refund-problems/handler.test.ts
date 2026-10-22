import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createListShipmentRefundProblemsHandler,
  type ListShipmentRefundProblemsDeps,
} from './handler.ts';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const BUYER = '7b310000-0000-4000-8000-000000000013';

type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };
type RpcResult = { data: unknown; error: { message: string } | null };
type Body = { problems: Record<string, unknown>[] };

const row = (overrides: Record<string, unknown> = {}) => ({
  shipment_id: '7b310000-0000-4000-8000-000000000011',
  order_id: '7b310000-0000-4000-8000-000000000012',
  buyer_id: BUYER,
  shipment_status: 'paid',
  kind: 'refund_failed',
  refund_id: 're_123',
  refund_failure_reason: 'expired_or_canceled_card',
  amount_owed_cents: 11000,
  payment_intent_id: 'pi_123',
  since: '2026-10-22T10:00:00.123+00:00',
  ...overrides,
});

function harness(
  overrides: { userId?: string | null; admin?: boolean | Error; rpc?: RpcResult | Error } = {},
) {
  const adminChecks: string[] = [];
  const logs: LogEntry[] = [];
  let rpcCalls = 0;
  const deps: ListShipmentRefundProblemsDeps = {
    getUserId: async () => (overrides.userId === undefined ? ADMIN : overrides.userId),
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    listProblems: async () => {
      rpcCalls += 1;
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: [row()], error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createListShipmentRefundProblemsHandler(deps),
    adminChecks,
    logs,
    rpcCalls: () => rpcCalls,
  };
}

const request = (token: string | null = 'jwt', method = 'GET') =>
  new Request('http://localhost/list-shipment-refund-problems', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe('list-shipment-refund-problems handler', () => {
  it('answers CORS preflight', async () => {
    const res = await harness().handler(request(null, 'OPTIONS'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects other methods with 405 before any lookup', async () => {
    const h = harness();
    const res = await h.handler(request('jwt', 'POST'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.adminChecks).toEqual([]);
    expect(h.rpcCalls()).toBe(0);
  });

  it('requires a bearer token that resolves to a user (401 AUTH_REQUIRED)', async () => {
    const none = await harness().handler(request(null));
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'AUTH_REQUIRED' });

    const unknown = harness({ userId: null });
    const res = await unknown.handler(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'AUTH_REQUIRED' });
    expect(unknown.adminChecks).toEqual([]);
    expect(unknown.rpcCalls()).toBe(0);
  });

  it('refuses non-admins with 403 ADMIN_ONLY and never calls the RPC', async () => {
    const h = harness({ admin: false });
    const res = await h.handler(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ADMIN_ONLY' });
    expect(h.adminChecks).toEqual([ADMIN]);
    expect(h.rpcCalls()).toBe(0);
  });

  it('fails closed when the admin lookup throws', async () => {
    const h = harness({ admin: new Error('db down') });
    const res = await h.handler(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL_ERROR' });
    expect(h.rpcCalls()).toBe(0);
  });

  it('returns camelCase problems with integer cents and ISO timestamps', async () => {
    const res = await harness().handler(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      problems: [
        {
          shipmentId: '7b310000-0000-4000-8000-000000000011',
          orderId: '7b310000-0000-4000-8000-000000000012',
          buyerId: BUYER,
          shipmentStatus: 'paid',
          kind: 'refund_failed',
          refundId: 're_123',
          refundFailureReason: 'expired_or_canceled_card',
          amountOwedCents: 11000,
          paymentIntentId: 'pi_123',
          since: '2026-10-22T10:00:00.123Z',
        },
      ],
    });
  });

  it('returns an empty list and keeps nullable refund fields null', async () => {
    const empty = await harness({ rpc: { data: [], error: null } }).handler(request());
    expect(await empty.json()).toEqual({ problems: [] });

    const escalated = await harness({
      rpc: {
        data: [row({ kind: 'refund_not_found', refund_id: null, refund_failure_reason: null })],
        error: null,
      },
    }).handler(request());
    const body = (await escalated.json()) as Body;
    expect(body.problems[0].refundId).toBeNull();
    expect(body.problems[0].refundFailureReason).toBeNull();
  });

  it('accepts every kind the RPC can emit', async () => {
    const kinds = ['refund_failed', 'refund_canceled', 'refund_not_found', 'refund_ambiguous'];
    const res = await harness({
      rpc: { data: kinds.map((kind) => row({ kind })), error: null },
    }).handler(request());
    const body = (await res.json()) as Body;
    expect(body.problems.map((p) => p.kind)).toEqual(kinds);
  });

  it('converts a bigint string to a number', async () => {
    const res = await harness({
      rpc: { data: [row({ amount_owed_cents: '11000' })], error: null },
    }).handler(request());
    expect(((await res.json()) as Body).problems[0].amountOwedCents).toBe(11000);
  });

  it('rejects amounts that are not positive safe integers', async () => {
    const bad = ['9007199254740993', 9007199254740993, 1.5, '1.5', 'abc', '', null, -1, 0];
    for (const amount of bad) {
      const h = harness({ rpc: { data: [row(), row({ amount_owed_cents: amount })], error: null } });
      const res = await h.handler(request());
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('{"error":"INTERNAL_ERROR"}');
    }
  });

  it('fails closed on an unusable row instead of returning partial money data', async () => {
    const bad: Record<string, unknown>[] = [
      { shipment_id: null },
      { order_id: 5 },
      { buyer_id: undefined },
      { kind: 'something_else' },
      { shipment_status: 7 },
      { refund_id: 5 },
      { refund_failure_reason: 5 },
      { payment_intent_id: null },
      { since: 'not a date' },
      { since: null },
    ];
    for (const overrides of bad) {
      const h = harness({ rpc: { data: [row(), row(overrides)], error: null } });
      const res = await h.handler(request());
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('{"error":"INTERNAL_ERROR"}');
      expect(h.logs.some((l) => l.level === 'ERROR')).toBe(true);
    }
  });

  it('fails closed when the RPC data is not an array of objects', async () => {
    for (const data of [null, {}, 'x', [null], ['x']]) {
      const res = await harness({ rpc: { data, error: null } }).handler(request());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'INTERNAL_ERROR' });
    }
  });

  it('keeps raw RPC and crash text out of the response and in the log', async () => {
    const rpc = harness({ rpc: { data: null, error: { message: 'secret db detail' } } });
    const res = await rpc.handler(request());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"INTERNAL_ERROR"}');
    expect(JSON.stringify(rpc.logs)).toContain('secret db detail');

    const crash = harness({ rpc: new Error('boom detail') });
    const res2 = await crash.handler(request());
    expect(res2.status).toBe(500);
    expect(await res2.text()).toBe('{"error":"INTERNAL_ERROR"}');
    expect(JSON.stringify(crash.logs)).toContain('boom detail');
  });

  it('does not log buyer ids on success', async () => {
    const h = harness();
    await h.handler(request());
    expect(JSON.stringify(h.logs)).not.toContain(BUYER);
  });
});

describe('list-shipment-refund-problems wiring', () => {
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('wraps the handler with Sentry, checks role and status, and calls the service-only RPC', () => {
    expect(index).toContain("serve(withSentry('list-shipment-refund-problems', handler))");
    expect(index).toContain(".select('role, status')");
    expect(index).toContain("from '../_shared/admin-auth.ts'");
    expect(index).toContain('fn_list_shipment_refund_problems');
  });

  it('declares verify_jwt = true in config.toml', () => {
    const config = readFileSync(join(import.meta.dir, '../../config.toml'), 'utf8');
    expect(config).toMatch(/\[functions\.list-shipment-refund-problems\]\r?\nverify_jwt = true/);
  });
});
