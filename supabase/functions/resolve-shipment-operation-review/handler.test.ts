import { describe, expect, it } from 'bun:test';

import {
  createResolveShipmentOperationReviewHandler,
  createSupabaseResolveShipmentOperationReviewPorts,
  type ResolveShipmentOperationReviewDeps,
} from './handler.ts';

const SHIPMENT = '7b310000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000099';
const NOTE = 'Carrier confirmed by phone the label was never used';

type RpcResult = { data: unknown; error: { message: string } | null };
type Call = {
  shipmentId: string;
  adminId: string;
  resolution: string;
  note: string;
};
type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };

const rpcData = (overrides: Record<string, unknown> = {}) => ({
  review_resolution: 'refund_approved',
  review_resolved_at: '2026-10-22T11:00:00.123+00:00',
  review_resolved_by: ADMIN,
  review_resolution_note: NOTE,
  label_cost_loss_cents: 15000,
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
  const deps: ResolveShipmentOperationReviewDeps = {
    getUserId: async () =>
      overrides.userId === undefined ? ADMIN : overrides.userId,
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    resolveReview: async (input) => {
      calls.push(input);
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: rpcData(), error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createResolveShipmentOperationReviewHandler(deps),
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
    'http://localhost/functions/v1/resolve-shipment-operation-review',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

const valid = {
  shipment_id: SHIPMENT,
  resolution: 'refund_approved',
  note: NOTE,
};

async function send(h: ReturnType<typeof harness>, request: Request) {
  const response = await h.handler(request);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

describe('resolve-shipment-operation-review handler', () => {
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
      [{ resolution: valid.resolution, note: NOTE }, 'INVALID_SHIPMENT_ID'],
      [{ ...valid, resolution: 'refund_failed' }, 'INVALID_REVIEW_RESOLUTION'],
      [{ ...valid, resolution: undefined }, 'INVALID_REVIEW_RESOLUTION'],
      [{ ...valid, note: '' }, 'INVALID_REVIEW_NOTE'],
      [{ ...valid, note: '   ' }, 'INVALID_REVIEW_NOTE'],
      [{ ...valid, note: 'x'.repeat(501) }, 'INVALID_REVIEW_NOTE'],
      [{ ...valid, note: 7 }, 'INVALID_REVIEW_NOTE'],
      [
        { shipment_id: SHIPMENT, resolution: valid.resolution },
        'INVALID_REVIEW_NOTE',
      ],
    ];
    for (const [body, code] of cases) {
      const h = harness();
      const res = await send(h, post(body));
      expect(res.response.status).toBe(422);
      expect(res.body).toEqual({ error: code });
      expect(h.calls).toEqual([]);
    }
  });

  it('accepts both resolutions and a note of exactly 500 characters, trimmed', async () => {
    for (const resolution of ['refund_approved', 'closed_no_refund']) {
      const h = harness();
      const res = await send(
        h,
        post({ ...valid, resolution, note: `  ${'x'.repeat(500)}  ` }),
      );
      expect(res.response.status).toBe(200);
      expect(h.calls).toEqual([
        {
          shipmentId: SHIPMENT,
          adminId: ADMIN,
          resolution,
          note: 'x'.repeat(500),
        },
      ]);
    }
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

  it('returns the resolution fields on success', async () => {
    const h = harness();
    const res = await send(h, post(valid));
    expect(res.response.status).toBe(200);
    expect(res.body).toEqual(rpcData());
  });

  it('keeps a NULL label cost loss null and converts a bigint string', async () => {
    const nul = await send(
      harness({
        rpc: { data: rpcData({ label_cost_loss_cents: null }), error: null },
      }),
      post(valid),
    );
    expect(nul.body.label_cost_loss_cents).toBeNull();
    const str = await send(
      harness({
        rpc: { data: rpcData({ label_cost_loss_cents: '15000' }), error: null },
      }),
      post(valid),
    );
    expect(str.body.label_cost_loss_cents).toBe(15000);
  });

  it('maps each actionable SQL error to a stable code', async () => {
    const mapped: [string, number, string][] = [
      ['ADMIN_REQUIRED', 403, 'ADMIN_ONLY'],
      ['SHIPMENT_NOT_FOUND', 404, 'SHIPMENT_NOT_FOUND'],
      ['CARRIER_REVIEW_NOT_PENDING', 409, 'CARRIER_REVIEW_NOT_PENDING'],
      [
        'CARRIER_REVIEW_ALREADY_RESOLVED',
        409,
        'CARRIER_REVIEW_ALREADY_RESOLVED',
      ],
      [
        'CANCELLATION_EXTERNAL_ALREADY_STARTED',
        409,
        'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      ],
      ['SHIPMENT_NOT_CANCELABLE', 409, 'SHIPMENT_NOT_CANCELABLE'],
      ['INVALID_REVIEW_RESOLUTION', 422, 'INVALID_REVIEW_RESOLUTION'],
      ['INVALID_REVIEW_NOTE', 422, 'INVALID_REVIEW_NOTE'],
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
      rpcData({ review_resolution: 'other' }),
      rpcData({ label_cost_loss_cents: 1.5 }),
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
  const handler = createResolveShipmentOperationReviewHandler({
    ...createSupabaseResolveShipmentOperationReviewPorts(() => client as never),
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

describe('resolve-shipment-operation-review Supabase ports', () => {
  it('resolves the token, checks the profiles_private role and status, then calls fn_resolve_shipment_cancellation_review', async () => {
    const client = fakeServiceClient();
    const res = await client.handler(post(valid));
    expect(res.status).toBe(200);
    expect(client.calls).toEqual([
      ['auth.getUser', 'user-jwt'],
      ...ADMIN_LOOKUP,
      [
        'rpc',
        'fn_resolve_shipment_cancellation_review',
        {
          p_shipment_id: SHIPMENT,
          p_admin_id: ADMIN,
          p_resolution: 'refund_approved',
          p_note: NOTE,
        },
      ],
    ]);
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
