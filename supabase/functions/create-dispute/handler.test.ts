import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createCreateDisputeHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;

const orderId = '11111111-1111-4111-8111-111111111111';
const buyerId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const shipmentId = '44444444-4444-4444-8444-444444444444';
const disputeId = '55555555-5555-4555-8555-555555555555';
const BUYER_TOKEN = 'buyer-session-token';
const ownPath = (file: string) => `disputes/${orderId}/${buyerId}/${file}`;

const validBody = (overrides: Row = {}): Row => ({
  orderId,
  shipmentId,
  reason: '  not_as_described ',
  description: '  The component does not match the listing.  ',
  evidence: {
    images: [ownPath('slot_0_1.jpg')],
    tech_checklist: { powers_on: false },
    video_url: ownPath('unboxing_1.mp4'),
  },
  ...overrides,
});

// A Supabase client whose only door is fn_open_shipment_dispute. `auth.getUser` knows one
// session token; any `.from(...)` call (a direct insert into disputes or notifications) is
// recorded and throws, so the tests can assert that the RPC is the only write.
function fakeSupabase(
  rpcResult: { data: unknown; error: { message: string } | null } = {
    data: [{ dispute_id: disputeId, error_code: null }],
    error: null,
  },
) {
  const tokens: string[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const fromCalls: string[] = [];
  let clientsCreated = 0;

  const client = {
    auth: {
      getUser: async (token: string) => {
        tokens.push(token);
        return token === BUYER_TOKEN
          ? { data: { user: { id: buyerId } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
    from: (table: string) => {
      fromCalls.push(table);
      throw new Error(`create-dispute must not query ${table} directly`);
    },
  };

  return {
    createSupabaseAdmin: () => {
      clientsCreated += 1;
      return client as unknown as SupabaseAdminClient;
    },
    tokens,
    rpcCalls,
    fromCalls,
    clientsCreated: () => clientsCreated,
  };
}

const disputeRequest = (
  body: unknown = validBody(),
  headers: Record<string, string> = { Authorization: `Bearer ${BUYER_TOKEN}` },
  method = 'POST',
) =>
  new Request('https://example.com/functions/v1/create-dispute', {
    method,
    headers,
    ...(method === 'POST'
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });

const handlerFor = (supabase: ReturnType<typeof fakeSupabase>) =>
  createCreateDisputeHandler({
    createSupabaseAdmin: supabase.createSupabaseAdmin,
  });

let consoleLog: ReturnType<typeof spyOn>;
beforeEach(() => {
  consoleLog = spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleLog.mockRestore();
});

const logLines = () =>
  consoleLog.mock.calls.map(([line]) => JSON.parse(String(line)) as Row);

const logLine = (level: string, msg: string, data: Row = {}) => ({
  timestamp: expect.any(String),
  function: 'create-dispute',
  level,
  msg,
  ...data,
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type',
};

const expectJsonResponse = async (
  response: Response,
  status: number,
  body: unknown,
) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json');
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(await response.json()).toEqual(body);
};

const startLog = logLine('INFO', 'Iniciando creación de disputa', {
  orderId,
  shipmentId,
  reason: 'not_as_described',
});

const failureLog = (error: string) =>
  logLine('ERROR', 'Fallo al crear disputa', { error });

describe('create-dispute handler: CORS preflight', () => {
  it('answers OPTIONS with the CORS headers and never builds a client', async () => {
    const supabase = fakeSupabase();

    const response = await handlerFor(supabase)(
      disputeRequest(undefined, {}, 'OPTIONS'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(supabase.clientsCreated()).toBe(0);
    expect(logLines()).toEqual([]);
  });
});

describe('create-dispute handler: authentication', () => {
  for (const [name, headers, token] of [
    ['a request without Authorization', {}, ''],
    [
      'a token that is not a user session',
      { Authorization: 'Bearer anon-key' },
      'anon-key',
    ],
  ] as const) {
    it(`refuses ${name} with 401 AUTH_REQUIRED before checking evidence or calling the RPC`, async () => {
      const supabase = fakeSupabase();
      // Foreign evidence: an evidence check before authentication would answer 400 instead.
      const body = validBody({
        evidence: {
          images: [`disputes/${orderId}/${otherId}/slot_0_1.jpg`],
          tech_checklist: { powers_on: false },
        },
      });

      const response = await handlerFor(supabase)(
        disputeRequest(body, headers),
      );

      await expectJsonResponse(response, 401, { error: 'AUTH_REQUIRED' });
      expect(supabase.tokens).toEqual([token]);
      expect(supabase.rpcCalls).toEqual([]);
      expect(supabase.fromCalls).toEqual([]);
      expect(logLines()).toEqual([startLog, failureLog('AUTH_REQUIRED')]);
    });
  }
});

describe('create-dispute handler: evidence ownership', () => {
  it('refuses images outside the caller folder for the order before calling the RPC', async () => {
    const supabase = fakeSupabase();

    const response = await handlerFor(supabase)(
      disputeRequest(
        validBody({
          evidence: {
            images: [`disputes/${orderId}/${otherId}/slot_0_1.jpg`],
            tech_checklist: { powers_on: false },
          },
        }),
      ),
    );

    const error = 'Evidence images must be your uploads for this order';
    await expectJsonResponse(response, 400, { error });
    expect(supabase.tokens).toEqual([BUYER_TOKEN]);
    expect(supabase.rpcCalls).toEqual([]);
    expect(supabase.fromCalls).toEqual([]);
    expect(logLines()).toEqual([startLog, failureLog(error)]);
  });

  it('refuses a video outside the caller folder for the order before calling the RPC', async () => {
    const supabase = fakeSupabase();

    const response = await handlerFor(supabase)(
      disputeRequest(
        validBody({
          evidence: {
            images: [ownPath('slot_0_1.jpg')],
            tech_checklist: { powers_on: false },
            video_url: `disputes/${orderId}/${otherId}/unboxing_1.mp4`,
          },
        }),
      ),
    );

    const error = 'Evidence video must be your upload for this order';
    await expectJsonResponse(response, 400, { error });
    expect(supabase.rpcCalls).toEqual([]);
    expect(supabase.fromCalls).toEqual([]);
  });
});

describe('create-dispute handler: opening the dispute', () => {
  it('opens the dispute only through fn_open_shipment_dispute with the parsed body and the caller id', async () => {
    const supabase = fakeSupabase();

    const response = await handlerFor(supabase)(disputeRequest());

    await expectJsonResponse(response, 200, { success: true, disputeId });
    expect(supabase.tokens).toEqual([BUYER_TOKEN]);
    expect(supabase.rpcCalls).toEqual([
      {
        name: 'fn_open_shipment_dispute',
        args: {
          p_buyer_id: buyerId,
          p_order_id: orderId,
          p_shipment_id: shipmentId,
          p_reason: 'not_as_described',
          p_description: 'The component does not match the listing.',
          p_evidence: {
            images: [ownPath('slot_0_1.jpg')],
            tech_checklist: { powers_on: false },
            video_url: ownPath('unboxing_1.mp4'),
          },
        },
      },
    ]);
    expect(supabase.fromCalls).toEqual([]);
    expect(logLines()).toEqual([
      startLog,
      logLine('INFO', 'Disputa creada exitosamente', {
        disputeId,
        orderId,
        shipmentId,
      }),
    ]);
  });

  it('accepts an RPC answer that is a single row instead of a list', async () => {
    const supabase = fakeSupabase({
      data: { dispute_id: disputeId, error_code: null },
      error: null,
    });

    const response = await handlerFor(supabase)(disputeRequest());

    await expectJsonResponse(response, 200, { success: true, disputeId });
    expect(supabase.rpcCalls).toHaveLength(1);
  });
});

describe('create-dispute handler: RPC failures', () => {
  it('answers 500 with the RPC error message', async () => {
    const supabase = fakeSupabase({
      data: null,
      error: { message: 'connection reset' },
    });

    const response = await handlerFor(supabase)(disputeRequest());

    const error = 'Error al crear disputa: connection reset';
    await expectJsonResponse(response, 500, { error });
    expect(supabase.rpcCalls).toHaveLength(1);
    expect(supabase.fromCalls).toEqual([]);
    expect(logLines()).toEqual([startLog, failureLog(error)]);
  });

  for (const data of [[], null]) {
    it(`answers 500 when the RPC returns ${JSON.stringify(data)}`, async () => {
      const supabase = fakeSupabase({ data, error: null });

      const response = await handlerFor(supabase)(disputeRequest());

      await expectJsonResponse(response, 500, {
        error: 'Error al crear disputa: sin respuesta',
      });
    });
  }

  for (const [code, status, error] of [
    [
      'DISPUTE_ALREADY_EXISTS',
      409,
      'Ya existe una disputa abierta para este paquete.',
    ],
    ['SHIPMENT_NOT_FOUND', 404, 'Envío no encontrado'],
    ['ORDER_BUYER_MISMATCH', 403, 'ORDER_BUYER_MISMATCH'],
    [
      'DISPUTE_STATUS_NOT_ALLOWED:completed',
      422,
      'DISPUTE_STATUS_NOT_ALLOWED:completed',
    ],
    ['SOMETHING_ELSE', 500, 'Error al crear disputa: SOMETHING_ELSE'],
  ] as const) {
    it(`maps the refusal ${code} to HTTP ${status} and logs it`, async () => {
      const supabase = fakeSupabase({
        data: [{ dispute_id: null, error_code: code }],
        error: null,
      });

      const response = await handlerFor(supabase)(disputeRequest());

      await expectJsonResponse(response, status, { error });
      expect(supabase.fromCalls).toEqual([]);
      expect(logLines()).toEqual([
        startLog,
        logLine('WARN', 'Disputa rechazada', {
          orderId,
          shipmentId,
          errorCode: code,
        }),
        failureLog(error),
      ]);
    });
  }
});

describe('create-dispute handler: invalid bodies', () => {
  for (const [name, body, error] of [
    ['a body that is not JSON', 'not json', 'Order ID is required'],
    [
      'a body without shipmentId',
      validBody({ shipmentId: undefined }),
      'Required',
    ],
    [
      'an invalid order id',
      validBody({ orderId: 'order-1' }),
      'Invalid order ID',
    ],
    [
      'a short description',
      validBody({ description: 'too short' }),
      'Description must be more detailed',
    ],
    [
      'evidence without images',
      validBody({ evidence: { images: [], tech_checklist: {} } }),
      'At least one evidence image is required',
    ],
  ] as const) {
    it(`refuses ${name} with 400 before authenticating or calling the RPC`, async () => {
      const supabase = fakeSupabase();

      const response = await handlerFor(supabase)(disputeRequest(body));

      await expectJsonResponse(response, 400, { error });
      expect(supabase.clientsCreated()).toBe(0);
      expect(supabase.tokens).toEqual([]);
      expect(supabase.rpcCalls).toEqual([]);
      expect(logLines()).toEqual([failureLog(error)]);
    });
  }
});
