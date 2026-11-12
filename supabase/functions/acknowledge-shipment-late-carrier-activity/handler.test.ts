import { describe, expect, it } from 'bun:test';

import {
  createAcknowledgeShipmentLateCarrierActivityHandler,
  createSupabaseAcknowledgeShipmentLateCarrierActivityPorts,
  type AcknowledgeShipmentLateCarrierActivityDeps,
} from './handler.ts';

const SHIPMENT = '7b580000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000099';
const NOTE = 'Checked the package with the seller; buyer informed';

type RpcResult = { data: unknown; error: { message: string } | null };
type Call = { shipmentId: string; adminId: string; note: string };
type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };

const rpcData = (overrides: Record<string, unknown> = {}) => ({
  acknowledged_at: '2026-10-22T11:00:00.123+00:00',
  acknowledged_by: ADMIN,
  acknowledged_note: NOTE,
  already_acknowledged: false,
  ...overrides,
});

function harness(
  overrides: {
    userId?: string | null;
    admin?: boolean | Error;
    rpc?: RpcResult | Error;
  } = {},
) {
  const calls: Call[] = [];
  const adminChecks: string[] = [];
  const logs: LogEntry[] = [];
  const deps: AcknowledgeShipmentLateCarrierActivityDeps = {
    getUserId: async () =>
      overrides.userId === undefined ? ADMIN : overrides.userId,
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    acknowledge: async (input) => {
      calls.push(input);
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: rpcData(), error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createAcknowledgeShipmentLateCarrierActivityHandler(deps),
    calls,
    adminChecks,
    logs,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { Authorization: 'Bearer user-jwt' },
) {
  return new Request(
    'http://localhost/functions/v1/acknowledge-shipment-late-carrier-activity',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

const valid = { shipment_id: SHIPMENT, note: NOTE };

async function send(h: ReturnType<typeof harness>, request: Request) {
  const response = await h.handler(request);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

describe('acknowledge-shipment-late-carrier-activity handler', () => {
  it('rejects other methods with 405', async () => {
    const h = harness();
    const res = await h.handler(
      new Request('http://localhost/x', { method: 'GET' }),
    );
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.calls).toEqual([]);
  });

  it('requires a bearer token that resolves to a user (401 AUTH_REQUIRED)', async () => {
    const none = harness();
    const a = await send(none, post(valid, {}));
    expect(a.response.status).toBe(401);
    expect(a.body).toEqual({ error: 'AUTH_REQUIRED' });

    const unknown = harness({ userId: null });
    const b = await send(unknown, post(valid));
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
    const res = await send(h, post(valid));
    expect(res.response.status).toBe(500);
    expect(res.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(h.calls).toEqual([]);
  });

  it('validates the body with stable 422 codes and never calls the RPC', async () => {
    const cases: [unknown, string][] = [
      ['not json', 'INVALID_SHIPMENT_ID'],
      [null, 'INVALID_SHIPMENT_ID'],
      [{ ...valid, shipment_id: 'not-a-uuid' }, 'INVALID_SHIPMENT_ID'],
      [{ ...valid, shipment_id: 5 }, 'INVALID_SHIPMENT_ID'],
      [{ note: NOTE }, 'INVALID_SHIPMENT_ID'],
      [{ ...valid, note: '' }, 'INVALID_ACKNOWLEDGEMENT_NOTE'],
      [{ ...valid, note: '   ' }, 'INVALID_ACKNOWLEDGEMENT_NOTE'],
      [{ ...valid, note: 'x'.repeat(201) }, 'INVALID_ACKNOWLEDGEMENT_NOTE'],
      [{ ...valid, note: 7 }, 'INVALID_ACKNOWLEDGEMENT_NOTE'],
      [{ shipment_id: SHIPMENT }, 'INVALID_ACKNOWLEDGEMENT_NOTE'],
    ];
    for (const [body, code] of cases) {
      const h = harness();
      const res = await send(h, post(body));
      expect(res.response.status).toBe(422);
      expect(res.body).toEqual({ error: code });
      expect(h.calls).toEqual([]);
    }
  });

  it('accepts a note of exactly 200 characters, trimmed', async () => {
    const h = harness();
    const res = await send(
      h,
      post({ ...valid, note: `  ${'x'.repeat(200)}  ` }),
    );
    expect(res.response.status).toBe(200);
    expect(h.calls).toEqual([
      { shipmentId: SHIPMENT, adminId: ADMIN, note: 'x'.repeat(200) },
    ]);
  });

  it('takes the admin id from the verified user, never from the body', async () => {
    const h = harness();
    await send(
      h,
      post({ ...valid, admin_id: OTHER, adminId: OTHER, p_admin_id: OTHER }),
    );
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].adminId).toBe(ADMIN);
    expect(h.adminChecks).toEqual([ADMIN]);
  });

  it('returns the acknowledgement fields on success, including a repeat', async () => {
    const first = await send(harness(), post(valid));
    expect(first.response.status).toBe(200);
    expect(first.body).toEqual(rpcData());

    const repeat = await send(
      harness({
        rpc: { data: rpcData({ already_acknowledged: true }), error: null },
      }),
      post(valid),
    );
    expect(repeat.response.status).toBe(200);
    expect(repeat.body.already_acknowledged).toBe(true);
  });

  it('maps each actionable SQL error to a stable code', async () => {
    const mapped: [string, number, string][] = [
      ['ADMIN_REQUIRED', 403, 'ADMIN_ONLY'],
      ['SHIPMENT_NOT_FOUND', 404, 'SHIPMENT_NOT_FOUND'],
      [
        'LATE_CARRIER_ACTIVITY_NOT_FOUND',
        404,
        'LATE_CARRIER_ACTIVITY_NOT_FOUND',
      ],
      ['INVALID_ACKNOWLEDGEMENT_NOTE', 422, 'INVALID_ACKNOWLEDGEMENT_NOTE'],
    ];
    for (const [message, status, code] of mapped) {
      const h = harness({
        rpc: { data: null, error: { message: `${message}: detail` } },
      });
      const res = await send(h, post(valid));
      expect(res.response.status).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });

  it('maps unknown RPC errors, crashes and unusable results to 500 without leaking text', async () => {
    const unknown = harness({
      rpc: { data: null, error: { message: 'secret db detail' } },
    });
    const a = await send(unknown, post(valid));
    expect(a.response.status).toBe(500);
    expect(a.text).toBe('{"error":"INTERNAL_ERROR"}');
    expect(JSON.stringify(unknown.logs)).toContain('secret db detail');

    const crash = harness({ rpc: new Error('boom detail') });
    const b = await send(crash, post(valid));
    expect(b.response.status).toBe(500);
    expect(b.text).toBe('{"error":"INTERNAL_ERROR"}');

    const unusable = [
      null,
      'x',
      rpcData({ acknowledged_at: 'not a date' }),
      rpcData({ acknowledged_by: null }),
      rpcData({ acknowledged_note: 5 }),
      rpcData({ already_acknowledged: 'yes' }),
    ];
    for (const data of unusable) {
      const h = harness({ rpc: { data, error: null } });
      const c = await send(h, post(valid));
      expect(c.response.status).toBe(500);
      expect(c.text).toBe('{"error":"INTERNAL_ERROR"}');
    }
  });

  it('never logs the note text or the bearer token', async () => {
    const ok = harness();
    await send(ok, post(valid));
    const failing = harness({
      rpc: { data: null, error: { message: 'ADMIN_REQUIRED' } },
    });
    await send(failing, post(valid));
    for (const logs of [ok.logs, failing.logs]) {
      const dump = JSON.stringify(logs);
      expect(dump).not.toContain(NOTE);
      expect(dump).not.toContain('user-jwt');
    }
  });
});

// The service-role client behind the real ports; it records every call in order.
function fakeServiceClient(
  options: {
    user?: { id: string } | null;
    authError?: { message: string };
    profile?: { role: string; status: string | null } | null;
    profileError?: { message: string };
  } = {},
) {
  const calls: unknown[][] = [];
  const query = {
    select: (columns: string) => {
      calls.push(['select', columns]);
      return query;
    },
    eq: (column: string, value: string) => {
      calls.push(['eq', column, value]);
      return query;
    },
    maybeSingle: async () => {
      calls.push(['maybeSingle']);
      const profile =
        options.profile === undefined
          ? { role: 'admin', status: 'active' }
          : options.profile;
      return { data: profile, error: options.profileError ?? null };
    },
  };
  const client = {
    auth: {
      getUser: async (token: string) => {
        calls.push(['auth.getUser', token]);
        const user = options.user === undefined ? { id: ADMIN } : options.user;
        return { data: { user }, error: options.authError ?? null };
      },
    },
    from: (table: string) => {
      calls.push(['from', table]);
      return query;
    },
    rpc: async (name: string, args?: unknown) => {
      calls.push(['rpc', name, args]);
      return {
        data: rpcData(),
        error: null,
      };
    },
  };
  const handler = createAcknowledgeShipmentLateCarrierActivityHandler({
    ...createSupabaseAcknowledgeShipmentLateCarrierActivityPorts(
      () => client as never,
    ),
    log: () => {},
  });
  return { calls, handler };
}

const ADMIN_LOOKUP = [
  ['from', 'profiles_private'],
  ['select', 'role, status'],
  ['eq', 'id', ADMIN],
  ['maybeSingle'],
];

const calledRpc = (calls: unknown[][]) =>
  calls.some(([kind]) => kind === 'rpc');

describe('acknowledge-shipment-late-carrier-activity Supabase ports', () => {
  it('resolves the token, checks the profiles_private role and status, then calls fn_acknowledge_shipment_late_carrier_activity', async () => {
    // Any HTTP call (Stripe, Envia, a refund) would go through fetch; none may happen.
    const fetches: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fetches.push(input);
      return new Response('{}');
    }) as typeof fetch;
    try {
      const client = fakeServiceClient();
      const res = await client.handler(post(valid));
      expect(res.status).toBe(200);
      expect(client.calls).toEqual([
        ['auth.getUser', 'user-jwt'],
        ...ADMIN_LOOKUP,
        [
          'rpc',
          'fn_acknowledge_shipment_late_carrier_activity',
          { p_shipment_id: SHIPMENT, p_admin_id: ADMIN, p_note: NOTE },
        ],
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fetches).toEqual([]);
  });

  it('answers 401 or 403 before the RPC for an unknown token or anyone but an active admin', async () => {
    const cases: [Parameters<typeof fakeServiceClient>[0], number][] = [
      [{ user: null }, 401],
      [{ authError: { message: 'invalid JWT' } }, 401],
      [{ profile: null }, 403],
      [{ profile: { role: 'user', status: 'active' } }, 403],
      [{ profile: { role: 'admin', status: 'suspended' } }, 403],
    ];
    for (const [options, status] of cases) {
      const client = fakeServiceClient(options);
      expect((await client.handler(post(valid))).status).toBe(status);
      expect(calledRpc(client.calls)).toBe(false);
    }
  });

  it('fails closed with 500 when the profiles_private lookup errors', async () => {
    const client = fakeServiceClient({ profileError: { message: 'db down' } });
    expect((await client.handler(post(valid))).status).toBe(500);
    expect(calledRpc(client.calls)).toBe(false);
  });
});
