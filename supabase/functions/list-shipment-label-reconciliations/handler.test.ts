import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createListShipmentLabelReconciliationsHandler,
  type ListShipmentLabelReconciliationsDeps,
} from './handler.ts';

const ADMIN = '00000000-0000-4000-8000-000000000001';

type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };
type RpcResult = { data: unknown; error: { message: string } | null };
type Body = { label_reconciliations: Record<string, unknown>[] };

const row = (overrides: Record<string, unknown> = {}) => ({
  shipment_id: '7b580000-0000-4000-8000-000000000011',
  order_id: '7b580000-0000-4000-8000-000000000012',
  seller_id: '7b580000-0000-4000-8000-000000000013',
  seller_name: 'seller_one',
  buyer_id: '7b580000-0000-4000-8000-000000000014',
  buyer_name: 'buyer_one',
  shipment_created_at: '2026-10-20T10:00:00.123+00:00',
  label_generation_state: 'orphan_pending',
  stuck_at: '2026-10-21T10:00:00.123+00:00',
  claim_expires_at: null,
  last_label_event_at: '2026-10-21T10:00:00.123+00:00',
  quote_carrier: 'paquetexpress',
  quote_service: 'ground',
  quote_cost_cents: 15000,
  quote_rated_at: '2026-10-20T10:00:00.123+00:00',
  origin_postal_code: '64000',
  origin_city: 'Monterrey',
  destination_postal_code: '06600',
  destination_city: 'Ciudad de Mexico',
  ...overrides,
});

function harness(
  overrides: { userId?: string | null; admin?: boolean | Error; rpc?: RpcResult | Error } = {},
) {
  const adminChecks: string[] = [];
  const logs: LogEntry[] = [];
  let rpcCalls = 0;
  const deps: ListShipmentLabelReconciliationsDeps = {
    getUserId: async () => (overrides.userId === undefined ? ADMIN : overrides.userId),
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    listLabelReconciliations: async () => {
      rpcCalls += 1;
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: [row()], error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createListShipmentLabelReconciliationsHandler(deps),
    adminChecks,
    logs,
    rpcCalls: () => rpcCalls,
  };
}

const request = (token: string | null = 'jwt', method = 'GET') =>
  new Request('http://localhost/list-shipment-label-reconciliations', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe('list-shipment-label-reconciliations handler', () => {
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

  it('returns the stuck shipments with snake_case fields for GET and POST', async () => {
    for (const method of ['GET', 'POST']) {
      const res = await harness().handler(request('jwt', method));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ label_reconciliations: [row()] });
    }
  });

  it('returns an empty list and keeps nullable fields null', async () => {
    const empty = await harness({ rpc: { data: [], error: null } }).handler(request());
    expect(await empty.json()).toEqual({ label_reconciliations: [] });

    const nulls = {
      seller_name: null,
      buyer_name: null,
      label_generation_state: 'claimed',
      claim_expires_at: '2026-10-21T10:00:00.123+00:00',
      last_label_event_at: null,
      quote_carrier: null,
      quote_service: null,
      quote_cost_cents: null,
      quote_rated_at: null,
      origin_postal_code: null,
      origin_city: null,
      destination_postal_code: null,
      destination_city: null,
    };
    const res = await harness({ rpc: { data: [row(nulls)], error: null } }).handler(request());
    expect(((await res.json()) as Body).label_reconciliations[0]).toEqual(row(nulls));
  });

  it('fails closed on an unusable row instead of returning partial data', async () => {
    const bad: Record<string, unknown>[] = [
      { shipment_id: null },
      { order_id: 5 },
      { seller_id: undefined },
      { buyer_id: '' },
      { seller_name: 5 },
      { buyer_name: undefined },
      { shipment_created_at: 'not a date' },
      { label_generation_state: 'generated' },
      { label_generation_state: null },
      { stuck_at: null },
      { stuck_at: 'not a date' },
      { claim_expires_at: 'not a date' },
      { claim_expires_at: undefined },
      { last_label_event_at: 5 },
      { quote_carrier: 5 },
      { quote_service: 5 },
      { quote_cost_cents: 1.5 },
      { quote_cost_cents: -1 },
      { quote_cost_cents: '15000' },
      { quote_rated_at: 'not a date' },
      { origin_postal_code: 64000 },
      { origin_city: 5 },
      { destination_postal_code: 5 },
      { destination_city: 5 },
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

  it('does not log seller ids, user names or cities on success', async () => {
    const h = harness();
    await h.handler(request());
    const dump = JSON.stringify(h.logs);
    expect(dump).not.toContain('7b580000-0000-4000-8000-000000000013');
    expect(dump).not.toContain('seller_one');
    expect(dump).not.toContain('Monterrey');
  });
});

describe('list-shipment-label-reconciliations wiring', () => {
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('wraps the handler with Sentry, checks role and status, and calls the service-only RPC', () => {
    expect(index).toContain("serve(withSentry('list-shipment-label-reconciliations', handler))");
    expect(index).toContain(".select('role, status')");
    expect(index).toContain("from '../_shared/admin-auth.ts'");
    expect(index).toContain('fn_list_shipment_label_reconciliations');
  });

  it('declares verify_jwt = true in config.toml', () => {
    const config = readFileSync(join(import.meta.dir, '../../config.toml'), 'utf8');
    expect(config).toMatch(/\[functions\.list-shipment-label-reconciliations\]\r?\nverify_jwt = true/);
  });
});

