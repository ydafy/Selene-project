import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createListShipmentLateCarrierActivityHandler,
  type ListShipmentLateCarrierActivityDeps,
} from './handler.ts';

const ADMIN = '00000000-0000-4000-8000-000000000001';

type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };
type RpcResult = { data: unknown; error: { message: string } | null };
type Body = { late_carrier_activity: Record<string, unknown>[] };

const row = (overrides: Record<string, unknown> = {}) => ({
  shipment_id: '7b580000-0000-4000-8000-000000000011',
  order_id: '7b580000-0000-4000-8000-000000000012',
  seller_id: '7b580000-0000-4000-8000-000000000013',
  tracking_number: '1234567890',
  carrier: 'estafeta',
  shipment_status: 'preparing',
  source: 'preparing_timeout',
  refund_status: 'succeeded',
  late_carrier_activity_at: '2026-10-22T10:00:00.123+00:00',
  late_carrier_activity_event_type: 'delivered',
  ...overrides,
});

function harness(
  overrides: { userId?: string | null; admin?: boolean | Error; rpc?: RpcResult | Error } = {},
) {
  const adminChecks: string[] = [];
  const logs: LogEntry[] = [];
  let rpcCalls = 0;
  const deps: ListShipmentLateCarrierActivityDeps = {
    getUserId: async () => (overrides.userId === undefined ? ADMIN : overrides.userId),
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    listLateCarrierActivity: async () => {
      rpcCalls += 1;
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: [row()], error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createListShipmentLateCarrierActivityHandler(deps),
    adminChecks,
    logs,
    rpcCalls: () => rpcCalls,
  };
}

const request = (token: string | null = 'jwt', method = 'GET') =>
  new Request('http://localhost/list-shipment-late-carrier-activity', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe('list-shipment-late-carrier-activity handler', () => {
  it('answers CORS preflight', async () => {
    const res = await harness().handler(request(null, 'OPTIONS'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects methods other than GET and POST before any lookup', async () => {
    const h = harness();
    const res = await h.handler(request('jwt', 'DELETE'));
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

  it('returns the cases with snake_case fields for GET and POST', async () => {
    for (const method of ['GET', 'POST']) {
      const res = await harness().handler(request('jwt', method));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ late_carrier_activity: [row()] });
    }
  });

  it('returns an empty list and keeps a NULL tracking number or carrier null', async () => {
    const empty = await harness({ rpc: { data: [], error: null } }).handler(request());
    expect(await empty.json()).toEqual({ late_carrier_activity: [] });

    const res = await harness({
      rpc: { data: [row({ tracking_number: null, carrier: null, refund_status: null })], error: null },
    }).handler(request());
    const body = (await res.json()) as Body;
    expect(body.late_carrier_activity[0].tracking_number).toBeNull();
    expect(body.late_carrier_activity[0].carrier).toBeNull();
    expect(body.late_carrier_activity[0].refund_status).toBeNull();
  });

  it('fails closed on an unusable row instead of returning partial data', async () => {
    const bad: Record<string, unknown>[] = [
      { shipment_id: null },
      { order_id: 5 },
      { seller_id: undefined },
      { shipment_status: 'something_else' },
      { shipment_status: null },
      { source: 'other' },
      { refund_status: 'other' },
      { late_carrier_activity_event_type: 'other' },
      { late_carrier_activity_event_type: null },
      { late_carrier_activity_at: 'not a date' },
      { late_carrier_activity_at: null },
      { tracking_number: 5 },
      { carrier: 5 },
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

  it('does not log seller ids or tracking numbers on success', async () => {
    const h = harness();
    await h.handler(request());
    expect(JSON.stringify(h.logs)).not.toContain('7b580000-0000-4000-8000-000000000013');
    expect(JSON.stringify(h.logs)).not.toContain('1234567890');
  });
});

describe('list-shipment-late-carrier-activity wiring', () => {
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('wraps the handler with Sentry, checks role and status, and calls the service-only RPC', () => {
    expect(index).toContain("serve(withSentry('list-shipment-late-carrier-activity', handler))");
    expect(index).toContain(".select('role, status')");
    expect(index).toContain("from '../_shared/admin-auth.ts'");
    expect(index).toContain('fn_list_shipment_late_carrier_activity');
  });

  it('declares verify_jwt = true in config.toml', () => {
    const config = readFileSync(join(import.meta.dir, '../../config.toml'), 'utf8');
    expect(config).toMatch(/\[functions\.list-shipment-late-carrier-activity\]\r?\nverify_jwt = true/);
  });
});
