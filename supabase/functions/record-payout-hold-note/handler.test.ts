import { describe, expect, it } from 'bun:test';

import {
  createRecordPayoutHoldNoteHandler,
  createSupabaseRecordPayoutHoldNotePorts,
  type RecordPayoutHoldNoteDeps,
} from './handler.ts';

const SHIPMENT = '7b310000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOTE_ID = '9c000000-0000-4000-8000-000000000001';
const NOTED_AT = '2026-11-14T05:27:34.123456+00:00';
const NOTE = 'Stripe sigue revisando la cuenta; esperamos 15 días más.';

type RpcResult = { data: unknown; error: { message: string } | null };
type Call = { shipmentId: string; adminId: string; note: string };
type LogEntry = { level: string; msg: string; data?: Record<string, unknown> };

const storedRow = (note: string) => ({
  id: NOTE_ID,
  shipment_id: SHIPMENT,
  admin_id: ADMIN,
  note,
  created_at: NOTED_AT,
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
  const tokens: string[] = [];
  const logs: LogEntry[] = [];
  const deps: RecordPayoutHoldNoteDeps = {
    getUserId: async (token) => {
      tokens.push(token);
      return overrides.userId === undefined ? ADMIN : overrides.userId;
    },
    isAdmin: async (userId) => {
      adminChecks.push(userId);
      if (overrides.admin instanceof Error) throw overrides.admin;
      return overrides.admin ?? true;
    },
    recordHoldNote: async (input) => {
      calls.push(input);
      if (overrides.rpc instanceof Error) throw overrides.rpc;
      return overrides.rpc ?? { data: storedRow(input.note), error: null };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return {
    handler: createRecordPayoutHoldNoteHandler(deps),
    calls,
    adminChecks,
    tokens,
    logs,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { Authorization: 'Bearer user-jwt' },
) {
  return new Request('http://localhost/functions/v1/record-payout-hold-note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const valid = { shipment_id: SHIPMENT, note: NOTE };

async function send(h: ReturnType<typeof harness>, request: Request) {
  const response = await h.handler(request);
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

describe('record-payout-hold-note handler', () => {
  it('rejects anything but POST with 405 METHOD_NOT_ALLOWED before authenticating', async () => {
    const h = harness();
    const { response, body } = await send(
      h,
      new Request('http://localhost/x', {
        method: 'GET',
        headers: { Authorization: 'Bearer t' },
      }),
    );
    expect(response.status).toBe(405);
    expect(body).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.tokens).toEqual([]);
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-Bearer scheme', { Authorization: 'Basic abc' }],
    ['an empty bearer token', { Authorization: 'Bearer ' }],
  ])(
    '401 AUTH_REQUIRED for %s, before any lookup or RPC',
    async (_name, headers) => {
      const h = harness();
      const { response, body } = await send(h, post(valid, headers));
      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'AUTH_REQUIRED' });
      expect(h.tokens).toEqual([]);
      expect(h.adminChecks).toEqual([]);
      expect(h.calls).toEqual([]);
    },
  );

  it('401 AUTH_REQUIRED when the token does not resolve to a user, without checking admin', async () => {
    const h = harness({ userId: null });
    const { response, body } = await send(h, post(valid));
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(h.tokens).toEqual(['user-jwt']);
    expect(h.adminChecks).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('403 ADMIN_ONLY for a signed-in non-admin (or a suspended admin), before reading the body', async () => {
    const h = harness({ admin: false });
    const { response, body } = await send(h, post('{'.repeat(10_000)));
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'ADMIN_ONLY' });
    expect(h.adminChecks).toEqual([ADMIN]);
    expect(h.calls).toEqual([]);
  });

  it('500 INTERNAL_ERROR when the admin lookup fails; the raw error goes to the log only', async () => {
    const h = harness({
      admin: new Error('relation profiles_private timeout 10.0.0.5'),
    });
    const { response, text, body } = await send(h, post(valid));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(text).not.toContain('profiles_private');
    expect(h.calls).toEqual([]);
    expect(JSON.stringify(h.logs)).toContain('profiles_private timeout');
  });

  it('500 INTERNAL_ERROR when resolving the token throws, never the raw text', async () => {
    const handler = createRecordPayoutHoldNoteHandler({
      getUserId: async () => {
        throw new Error('gotrue 10.0.0.9 down');
      },
      isAdmin: async () => true,
      recordHoldNote: async () => ({ data: null, error: null }),
      log: () => undefined,
    });
    const response = await handler(post(valid));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"INTERNAL_ERROR"}');
  });

  it.each([
    ['an unparsable body', 'not json'],
    ['an empty object', {}],
    ['an array body', [SHIPMENT]],
    ['a missing shipment_id', { note: NOTE }],
    ['a numeric shipment_id', { shipment_id: 12, note: NOTE }],
    ['a non-uuid shipment_id', { shipment_id: 'abc', note: NOTE }],
  ])('422 INVALID_SHIPMENT_ID for %s', async (_name, payload) => {
    const h = harness();
    const { response, body } = await send(h, post(payload));
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: 'INVALID_SHIPMENT_ID' });
    expect(h.calls).toEqual([]);
  });

  it.each([
    ['a missing note', { shipment_id: SHIPMENT }],
    ['a null note', { shipment_id: SHIPMENT, note: null }],
    ['a numeric note', { shipment_id: SHIPMENT, note: 42 }],
    ['an empty note', { shipment_id: SHIPMENT, note: '' }],
    ['a blank note', { shipment_id: SHIPMENT, note: '  \n\t ' }],
    [
      'a 1001 character note',
      { shipment_id: SHIPMENT, note: 'x'.repeat(1001) },
    ],
    [
      'a padded 1001 character note',
      { shipment_id: SHIPMENT, note: ` ${'x'.repeat(1001)} ` },
    ],
    [
      'a note of 1001 characters outside the BMP',
      { shipment_id: SHIPMENT, note: '😀'.repeat(1001) },
    ],
  ])('422 INVALID_HOLD_NOTE for %s', async (_name, payload) => {
    const h = harness();
    const { response, body } = await send(h, post(payload));
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: 'INVALID_HOLD_NOTE' });
    expect(h.calls).toEqual([]);
  });

  it.each([
    ['one character', 'x'],
    ['1000 characters', 'x'.repeat(1000)],
    // char_length in SQL counts code points; 1000 emoji are 2000 UTF-16 units.
    ['1000 characters outside the BMP', '😀'.repeat(1000)],
  ])('accepts a note of %s', async (_name, note) => {
    const h = harness();
    const { response, body } = await send(
      h,
      post({ shipment_id: SHIPMENT, note }),
    );
    expect(response.status).toBe(200);
    expect(body.note).toBe(note);
    expect(h.calls).toEqual([{ shipmentId: SHIPMENT, adminId: ADMIN, note }]);
  });

  it('records the note for an admin: trims it, passes the caller id and returns the stored note', async () => {
    const h = harness();
    const { response, body } = await send(
      h,
      post({ shipment_id: SHIPMENT, note: `\t ${NOTE} \n` }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(body).toEqual({
      id: NOTE_ID,
      shipment_id: SHIPMENT,
      note: NOTE,
      noted_at: NOTED_AT,
      noted_by: ADMIN,
    });
    expect(h.calls).toEqual([
      { shipmentId: SHIPMENT, adminId: ADMIN, note: NOTE },
    ]);
    expect(h.logs.some((entry) => entry.level === 'INFO')).toBe(true);
  });

  it('never takes the admin id from the body and never logs the note text', async () => {
    const h = harness();
    await send(
      h,
      post({ ...valid, admin_id: 'forged', adminId: 'forged', noted_by: 'x' }),
    );
    expect(h.calls).toEqual([
      { shipmentId: SHIPMENT, adminId: ADMIN, note: NOTE },
    ]);
    expect(JSON.stringify(h.logs)).not.toContain('Stripe sigue');
  });

  it.each([
    ['ADMIN_REQUIRED', 'ADMIN_ONLY', 403],
    ['INVALID_HOLD_NOTE', 'INVALID_HOLD_NOTE', 422],
    ['SHIPMENT_NOT_FOUND', 'SHIPMENT_NOT_FOUND', 404],
    ['PAYOUT_NOT_OVERDUE', 'PAYOUT_NOT_OVERDUE', 409],
  ])(
    'maps the RPC error %s to a stable %s / %d; the raw text only reaches the log',
    async (message, code, status) => {
      const raw = `${message} (context: shipments row lock)`;
      const h = harness({ rpc: { data: null, error: { message: raw } } });
      const { response, text, body } = await send(h, post(valid));
      expect(response.status).toBe(status);
      expect(body).toEqual({ error: code });
      expect(text).not.toContain('row lock');
      expect(h.logs.some((entry) => entry.data?.error === raw)).toBe(true);
    },
  );

  it.each([
    'canceling statement due to statement timeout',
    'permission denied for function fn_admin_record_payout_hold_note',
    'insert or update on table "admin_audit_logs" violates foreign key constraint',
  ])(
    '500 INTERNAL_ERROR for the unexpected RPC error %s; raw text only in the log',
    async (message) => {
      const h = harness({ rpc: { data: null, error: { message } } });
      const { response, text, body } = await send(h, post(valid));
      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'INTERNAL_ERROR' });
      expect(text).not.toContain(message);
      expect(h.logs.some((entry) => entry.data?.error === message)).toBe(true);
    },
  );

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
    ['an array', [storedRow(NOTE)]],
    ['a missing id', { ...storedRow(NOTE), id: undefined }],
    ['a numeric note', { ...storedRow(NOTE), note: 5 }],
    ['an unparsable created_at', { ...storedRow(NOTE), created_at: 'now' }],
    ['a missing admin_id', { ...storedRow(NOTE), admin_id: undefined }],
    ['another shipment', { ...storedRow(NOTE), shipment_id: NOTE_ID }],
  ])(
    '500 INTERNAL_ERROR for a malformed RPC result (%s) instead of reporting success',
    async (_name, data) => {
      const h = harness({
        rpc: { data: JSON.parse(JSON.stringify(data)), error: null },
      });
      const { response, body } = await send(h, post(valid));
      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'INTERNAL_ERROR' });
    },
  );
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
      return { data: storedRow(NOTE), error: null };
    },
  };
  const handler = createRecordPayoutHoldNoteHandler({
    ...createSupabaseRecordPayoutHoldNotePorts(() => client as never),
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

describe('record-payout-hold-note Supabase ports', () => {
  it('resolves the token, checks the profiles_private role and status, then calls fn_admin_record_payout_hold_note', async () => {
    const client = fakeServiceClient();
    const response = await client.handler(post(valid));
    expect(response.status).toBe(200);
    expect(client.calls).toEqual([
      ['auth.getUser', 'user-jwt'],
      ...ADMIN_LOOKUP,
      [
        'rpc',
        'fn_admin_record_payout_hold_note',
        { p_admin_id: ADMIN, p_shipment_id: SHIPMENT, p_note: NOTE },
      ],
    ]);
  });

  it.each([
    ['a suspended admin', { role: 'admin', status: 'suspended' }],
    ['a banned admin', { role: 'admin', status: 'banned' }],
    ['a regular user', { role: 'user', status: 'active' }],
    ['a missing profile', null],
  ])('403 ADMIN_ONLY for %s, without calling the RPC', async (_n, profile) => {
    const client = fakeServiceClient({ profile });
    const response = await client.handler(post(valid));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ADMIN_ONLY' });
    expect(calledRpc(client.calls)).toBe(false);
  });

  it('401 AUTH_REQUIRED when Supabase Auth rejects the token', async () => {
    const client = fakeServiceClient({
      user: null,
      authError: { message: 'invalid JWT' },
    });
    const response = await client.handler(post(valid));
    expect(response.status).toBe(401);
    expect(client.calls).toEqual([['auth.getUser', 'user-jwt']]);
  });

  it('500 INTERNAL_ERROR when the profile lookup fails', async () => {
    const client = fakeServiceClient({
      profileError: { message: 'connection reset' },
    });
    const response = await client.handler(post(valid));
    expect(response.status).toBe(500);
    expect(calledRpc(client.calls)).toBe(false);
  });
});
