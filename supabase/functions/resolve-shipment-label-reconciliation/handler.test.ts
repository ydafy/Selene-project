import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createResolveShipmentLabelReconciliationHandler,
  type ResolveShipmentLabelReconciliationDeps,
  type ResolveShipmentLabelReconciliationInput,
} from './handler.ts';

const SHIPMENT = '7b580000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000099';
const NOTE = 'Checked the Envia panel; label exists';
const LABEL_URL = 'https://files.example.com/label-secret-token.pdf';

type RpcResult = { data: unknown; error: { message: string } | null };
type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };

const resolved = (overrides: Record<string, unknown> = {}) => ({
  result: 'resolved',
  resolution: 'no_label',
  shipment_id: SHIPMENT,
  status: 'paid',
  label_generation_state: 'unclaimed',
  ...overrides,
});

function harness(
  overrides: { userId?: string | null; admin?: boolean | Error; rpc?: RpcResult | Error } = {},
) {
  const calls: ResolveShipmentLabelReconciliationInput[] = [];
  const adminChecks: string[] = [];
  const logs: LogEntry[] = [];
  const deps: ResolveShipmentLabelReconciliationDeps = {
    getUserId: async () => (overrides.userId === undefined ? ADMIN : overrides.userId),
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    resolve: async (input) => {
      calls.push(input);
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: resolved(), error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createResolveShipmentLabelReconciliationHandler(deps),
    calls,
    adminChecks,
    logs,
  };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }) {
  return new Request('http://localhost/functions/v1/resolve-shipment-label-reconciliation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const noLabel = { shipment_id: SHIPMENT, resolution: 'no_label', note: NOTE };
const labelFound = {
  shipment_id: SHIPMENT,
  resolution: 'label_found',
  note: NOTE,
  envia_shipment_id: '98765',
  tracking_number: '1234567890',
  label_url: LABEL_URL,
  provider_cost_cents: 15050,
};

async function send(h: ReturnType<typeof harness>, request: Request) {
  const response = await h.handler(request);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

describe('resolve-shipment-label-reconciliation handler', () => {
  it('answers CORS preflight without authenticating', async () => {
    const h = harness();
    const res = await h.handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(h.adminChecks).toEqual([]);
  });

  it('rejects other methods with 405', async () => {
    const h = harness();
    const res = await h.handler(new Request('http://localhost/x', { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.calls).toEqual([]);
  });

  it('requires a bearer token that resolves to a user (401 AUTH_REQUIRED)', async () => {
    const a = await send(harness(), post(noLabel, {}));
    expect(a.response.status).toBe(401);
    expect(a.body).toEqual({ error: 'AUTH_REQUIRED' });

    const unknown = harness({ userId: null });
    const b = await send(unknown, post(noLabel));
    expect(b.response.status).toBe(401);
    expect(b.body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(unknown.adminChecks).toEqual([]);
    expect(unknown.calls).toEqual([]);
  });

  it('refuses non-admins with 403 ADMIN_ONLY before the body is read or the RPC called', async () => {
    const h = harness({ admin: false });
    const res = await send(h, post('not json at all'));
    expect(res.response.status).toBe(403);
    expect(res.body).toEqual({ error: 'ADMIN_ONLY' });
    expect(h.calls).toEqual([]);
  });

  it('fails closed when the admin lookup throws', async () => {
    const h = harness({ admin: new Error('db down') });
    const res = await send(h, post(noLabel));
    expect(res.response.status).toBe(500);
    expect(res.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(h.calls).toEqual([]);
  });

  it('validates the body with stable 422 codes and never calls the RPC', async () => {
    const cases: [unknown, string][] = [
      ['not json', 'INVALID_SHIPMENT_ID'],
      [null, 'INVALID_SHIPMENT_ID'],
      [{ ...noLabel, shipment_id: 'not-a-uuid' }, 'INVALID_SHIPMENT_ID'],
      [{ ...noLabel, shipment_id: 5 }, 'INVALID_SHIPMENT_ID'],
      [{ resolution: 'no_label', note: NOTE }, 'INVALID_SHIPMENT_ID'],
      [{ ...noLabel, resolution: 'maybe' }, 'INVALID_RESOLUTION'],
      [{ ...noLabel, resolution: undefined }, 'INVALID_RESOLUTION'],
      [{ ...noLabel, note: '' }, 'INVALID_RESOLUTION_NOTE'],
      [{ ...noLabel, note: '   ' }, 'INVALID_RESOLUTION_NOTE'],
      [{ ...noLabel, note: 'x'.repeat(201) }, 'INVALID_RESOLUTION_NOTE'],
      [{ ...noLabel, note: 7 }, 'INVALID_RESOLUTION_NOTE'],
      [{ shipment_id: SHIPMENT, resolution: 'no_label' }, 'INVALID_RESOLUTION_NOTE'],
      // label_found needs the whole provider result
      [{ ...labelFound, envia_shipment_id: undefined }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, envia_shipment_id: '  ' }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, tracking_number: undefined }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, tracking_number: 5 }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, label_url: undefined }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, label_url: 'not a url' }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, label_url: 'javascript:alert(1)' }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, provider_cost_cents: undefined }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, provider_cost_cents: 150.5 }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, provider_cost_cents: -1 }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, provider_cost_cents: '15050' }, 'INVALID_PROVIDER_RESULT'],
      [{ ...labelFound, provider_cost_cents: 1e21 }, 'INVALID_PROVIDER_RESULT'],
      // no_label takes no provider result
      [{ ...noLabel, tracking_number: '123' }, 'UNEXPECTED_PROVIDER_FIELDS'],
      [{ ...noLabel, envia_shipment_id: '123' }, 'UNEXPECTED_PROVIDER_FIELDS'],
      [{ ...noLabel, label_url: LABEL_URL }, 'UNEXPECTED_PROVIDER_FIELDS'],
      [{ ...noLabel, provider_cost_cents: 0 }, 'UNEXPECTED_PROVIDER_FIELDS'],
    ];
    for (const [body, code] of cases) {
      const h = harness();
      const res = await send(h, post(body));
      expect(res.response.status).toBe(422);
      expect(res.body).toEqual({ error: code });
      expect(h.calls).toEqual([]);
    }
  });

  it('accepts null provider fields for no_label and a zero cost for label_found', async () => {
    const a = harness();
    const nulls = await send(
      a,
      post({ ...noLabel, envia_shipment_id: null, tracking_number: null, label_url: null, provider_cost_cents: null }),
    );
    expect(nulls.response.status).toBe(200);
    expect(a.calls).toHaveLength(1);

    const b = harness();
    const free = await send(b, post({ ...labelFound, provider_cost_cents: 0 }));
    expect(free.response.status).toBe(200);
    expect(b.calls[0].providerCostCents).toBe(0);
  });

  it('passes a trimmed no_label request with null provider fields', async () => {
    const h = harness();
    await send(h, post({ ...noLabel, note: `  ${'x'.repeat(200)}  ` }));
    expect(h.calls).toEqual([
      {
        shipmentId: SHIPMENT,
        adminId: ADMIN,
        resolution: 'no_label',
        note: 'x'.repeat(200),
        enviaShipmentId: null,
        trackingNumber: null,
        labelUrl: null,
        providerCostCents: null,
      },
    ]);
  });

  it('passes a trimmed label_found request with the provider result', async () => {
    const h = harness({
      rpc: {
        data: resolved({ resolution: 'label_found', status: 'preparing', label_generation_state: 'generated' }),
        error: null,
      },
    });
    const res = await send(
      h,
      post({ ...labelFound, envia_shipment_id: ' 98765 ', tracking_number: ' 1234567890 ', label_url: ` ${LABEL_URL} ` }),
    );
    expect(res.response.status).toBe(200);
    expect(h.calls).toEqual([
      {
        shipmentId: SHIPMENT,
        adminId: ADMIN,
        resolution: 'label_found',
        note: NOTE,
        enviaShipmentId: '98765',
        trackingNumber: '1234567890',
        labelUrl: LABEL_URL,
        providerCostCents: 15050,
      },
    ]);
  });

  it('takes the admin id from the verified user, never from the body', async () => {
    const h = harness();
    await send(h, post({ ...noLabel, admin_id: OTHER, adminId: OTHER, actor_id: OTHER, p_actor_id: OTHER }));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].adminId).toBe(ADMIN);
    expect(h.adminChecks).toEqual([ADMIN]);
  });

  it('returns the resolution fields on success', async () => {
    const res = await send(harness(), post(noLabel));
    expect(res.response.status).toBe(200);
    expect(res.body).toEqual(resolved());
  });

  it('answers 409 ALREADY_RESOLVED when the shipment is no longer stuck', async () => {
    const h = harness({
      rpc: {
        data: { result: 'already_resolved', shipment_id: SHIPMENT, status: 'paid', label_generation_state: 'generated' },
        error: null,
      },
    });
    const res = await send(h, post(noLabel));
    expect(res.response.status).toBe(409);
    expect(res.body).toEqual({
      error: 'ALREADY_RESOLVED',
      shipment_id: SHIPMENT,
      status: 'paid',
      label_generation_state: 'generated',
    });
  });

  it('maps each actionable SQL error to a stable code', async () => {
    const mapped: [string, number, string][] = [
      ['ADMIN_REQUIRED', 403, 'ADMIN_ONLY'],
      ['INVALID_RESOLUTION', 422, 'INVALID_RESOLUTION'],
      ['INVALID_RESOLUTION_NOTE', 422, 'INVALID_RESOLUTION_NOTE'],
      ['SHIPMENT_NOT_FOUND', 404, 'SHIPMENT_NOT_FOUND'],
      ['INVALID_PROVIDER_RESULT', 422, 'INVALID_PROVIDER_RESULT'],
      ['UNEXPECTED_PROVIDER_FIELDS', 422, 'UNEXPECTED_PROVIDER_FIELDS'],
      ['LABEL_SETTINGS_MISSING', 500, 'LABEL_SETTINGS_MISSING'],
    ];
    for (const [message, status, code] of mapped) {
      const h = harness({ rpc: { data: null, error: { message: `${message}: detail` } } });
      const res = await send(h, post(labelFound));
      expect(res.response.status).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });

  it('maps unknown RPC errors, crashes and unusable results to 500 without leaking text', async () => {
    const unknown = harness({ rpc: { data: null, error: { message: 'secret db detail' } } });
    const a = await send(unknown, post(noLabel));
    expect(a.response.status).toBe(500);
    expect(a.text).toBe('{"error":"INTERNAL_ERROR"}');
    expect(JSON.stringify(unknown.logs)).toContain('secret db detail');

    const crash = harness({ rpc: new Error('boom detail') });
    const b = await send(crash, post(noLabel));
    expect(b.response.status).toBe(500);
    expect(b.text).toBe('{"error":"INTERNAL_ERROR"}');

    const unusable = [
      null,
      'x',
      resolved({ result: 'other' }),
      resolved({ resolution: 'maybe' }),
      resolved({ shipment_id: null }),
      resolved({ status: 5 }),
      resolved({ label_generation_state: null }),
      { result: 'already_resolved', shipment_id: SHIPMENT, status: 'paid' },
    ];
    for (const data of unusable) {
      const h = harness({ rpc: { data, error: null } });
      const c = await send(h, post(noLabel));
      expect(c.response.status).toBe(500);
      expect(c.text).toBe('{"error":"INTERNAL_ERROR"}');
    }
  });

  it('never logs the note, the label URL, the tracking number or the bearer token', async () => {
    const ok = harness();
    await send(ok, post(labelFound));
    const failing = harness({ rpc: { data: null, error: { message: 'ADMIN_REQUIRED' } } });
    await send(failing, post(labelFound));
    for (const logs of [ok.logs, failing.logs]) {
      const dump = JSON.stringify(logs);
      expect(dump).not.toContain(NOTE);
      expect(dump).not.toContain(LABEL_URL);
      expect(dump).not.toContain('label-secret-token');
      expect(dump).not.toContain('1234567890');
      expect(dump).not.toContain('user-jwt');
    }
  });
});

describe('resolve-shipment-label-reconciliation wiring', () => {
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('wraps the handler with Sentry, checks role and status, and calls the service-only RPC', () => {
    expect(index).toContain("serve(withSentry('resolve-shipment-label-reconciliation', handler))");
    expect(index).toContain(".select('role, status')");
    expect(index).toContain("from '../_shared/admin-auth.ts'");
    expect(index).toContain('fn_resolve_shipment_label_reconciliation');
  });

  it('only calls the resolve RPC: no refund, Stripe or HTTP call', () => {
    expect(index).not.toMatch(/stripe|refund|fetch\(/i);
  });

  it('declares verify_jwt = true in config.toml', () => {
    const config = readFileSync(join(import.meta.dir, '../../config.toml'), 'utf8');
    expect(config).toMatch(/\[functions\.resolve-shipment-label-reconciliation\]\r?\nverify_jwt = true/);
  });
});
