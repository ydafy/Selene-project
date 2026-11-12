import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createGenerateReturnLabelHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Result = { data?: unknown; error?: unknown };

const BUYER_ID = '00000000-0000-4000-8000-0000000000b1';
const SELLER_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000a2';
const DISPUTE_ID = '00000000-0000-4000-8000-0000000000f1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000d1';
const SHIPMENT_ID = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'buyer-access-token';

const disputeRow = (overrides: Row = {}): Row => ({
  id: DISPUTE_ID,
  seller_id: SELLER_ID,
  status: 'waiting_return',
  order_id: ORDER_ID,
  buyer_id: BUYER_ID,
  shipment_id: SHIPMENT_ID,
  return_payout_status: 'paid',
  return_tracking_number: null,
  ...overrides,
});

const buyerAddress = {
  full_name: 'Buyer Name',
  phone: '+52 (55) 1234-5678',
  street_line1: 'Calle Uno',
  district: 'Centro',
  city: 'Ciudad de México',
  state_code: 'cmx',
  zip_code: '06000',
};

const sellerOrigin = {
  full_name: 'Seller Name',
  phone: '33 1234 5678',
  street_line1: 'Avenida Dos',
  district: 'Americana',
  city: 'Guadalajara',
  state: 'Jalisco',
  zip_code: '44100',
};

const ENV = {
  ENVIA_MODE: 'sandbox',
  ENVIA_API_KEY_SANDBOX: 'envia-sandbox-key',
  ENVIA_API_URL_SANDBOX: 'https://envia.test/',
};

type Call =
  | { kind: 'auth'; token: string }
  | { kind: 'from'; table: string; ops: unknown[][] };

interface FakeInput {
  users?: Record<string, string>;
  authError?: boolean;
  dispute?: Row | null;
  order?: Row | null;
  shipment?: Row | null;
  disputeUpdate?: Result;
}

// A recording Supabase fake: each `from(...)` chain records its operations, and the result is
// chosen from the table when the chain settles, so a test asserts the exact filters and writes.
function fakeDatabase(input: FakeInput = {}) {
  const users = input.users ?? { [TOKEN]: BUYER_ID };
  const calls: Call[] = [];

  const row = (value: Row | null | undefined, fallback: Row): Result =>
    value === null
      ? { data: null, error: { message: 'missing' } }
      : { data: value ?? fallback, error: null };

  const respond = (table: string, ops: unknown[][]): Result => {
    if (table === 'disputes') {
      if (ops.some((op) => op[0] === 'update')) {
        return input.disputeUpdate ?? { data: null, error: null };
      }
      return row(input.dispute, disputeRow());
    }
    if (table === 'orders') {
      return row(input.order, { id: ORDER_ID, shipping_address: buyerAddress });
    }
    if (table === 'shipments') {
      return row(input.shipment, {
        id: SHIPMENT_ID,
        seller_id: SELLER_ID,
        origin_address: sellerOrigin,
      });
    }
    throw new Error(`fake database: unexpected table ${table}`);
  };

  const query = (table: string) => {
    const ops: unknown[][] = [];
    calls.push({ kind: 'from', table, ops });
    const settle = () => Promise.resolve(respond(table, ops));
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'update']) {
      chain[name] = (...args: unknown[]) => {
        ops.push([name, ...args]);
        return chain;
      };
    }
    chain.single = () => {
      ops.push(['single']);
      return settle();
    };
    chain.then = (
      resolve: (value: Result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => settle().then(resolve, reject);
    return chain;
  };

  const client = {
    auth: {
      getUser: async (token: string) => {
        calls.push({ kind: 'auth', token });
        const id = users[token];
        if (input.authError) {
          return {
            data: { user: id ? { id } : null },
            error: { message: 'invalid token' },
          };
        }
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
    from: (table: string) => query(table),
    rpc: async (name: string) => {
      throw new Error(`fake database: unexpected rpc ${name}`);
    },
  };

  const tables = () =>
    calls.flatMap((call) => (call.kind === 'from' ? [call.table] : []));
  const fromCalls = (table: string) =>
    calls.flatMap((call) =>
      call.kind === 'from' && call.table === table ? [call.ops] : [],
    );

  return {
    client: client as unknown as SupabaseAdminClient,
    calls,
    tables,
    fromCalls,
  };
}

const labelBody = {
  meta: 'generate',
  data: [
    { trackingNumber: 'RETURN-TRACK-1', label: 'https://envia.test/r.pdf' },
  ],
};

function fakeEnvia(
  reply: { status?: number; body: unknown } = { body: labelBody },
) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchFake = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fetchFake, requests };
}

const setup = (
  input: FakeInput = {},
  options: {
    env?: Record<string, string>;
    envia?: Parameters<typeof fakeEnvia>[0];
  } = {},
) => {
  const database = fakeDatabase(input);
  const envia = fakeEnvia(options.envia);
  let clientsCreated = 0;
  const handler = createGenerateReturnLabelHandler({
    createSupabaseAdmin: () => {
      clientsCreated += 1;
      return database.client;
    },
    getEnv: (name) => (options.env ?? ENV)[name],
    fetch: envia.fetchFake,
  });
  return { handler, database, envia, clientsCreated: () => clientsCreated };
};

const request = (
  body: unknown = { disputeId: DISPUTE_ID },
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
) =>
  new Request('https://example.com/functions/v1/generate-return-label', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

let logSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('generate-return-label request validation and authentication', () => {
  it('rejects a malformed dispute id with 400 before creating a client', async () => {
    const { handler, database, envia, clientsCreated } = setup();

    const response = await handler(request({ disputeId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(String((await response.json()).error)).toContain(
      'ID de disputa inválido',
    );
    expect(clientsCreated()).toBe(0);
    expect(database.calls).toEqual([]);
    expect(envia.requests).toEqual([]);
  });

  it.each([
    ['no Authorization header', {}, {}],
    ['an unknown token', { Authorization: 'Bearer anon-key' }, {}],
    [
      'an auth error that still carries a user',
      { Authorization: `Bearer ${TOKEN}` },
      { authError: true },
    ],
  ])(
    'answers 401 AUTH_REQUIRED for %s before any table or Envia call',
    async (_case, headers, input) => {
      const { handler, database, envia } = setup(input);

      const response = await handler(
        request({ disputeId: DISPUTE_ID }, headers),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
      expect(database.calls.every((call) => call.kind === 'auth')).toBe(true);
      expect(envia.requests).toEqual([]);
    },
  );

  it('verifies the bearer token without its prefix', async () => {
    const { handler, database } = setup();

    await handler(request());

    expect(database.calls[0]).toEqual({ kind: 'auth', token: TOKEN });
  });
});

describe('generate-return-label dispute checks', () => {
  it('loads the requested dispute by its id', async () => {
    const { handler, database } = setup();

    await handler(request());

    expect(database.fromCalls('disputes')[0]).toEqual([
      [
        'select',
        'id, seller_id, status, order_id, buyer_id, shipment_id, return_payout_status, return_tracking_number',
      ],
      ['eq', 'id', DISPUTE_ID],
      ['single'],
    ]);
  });

  it('refuses a user who is not the buyer of the dispute with 403', async () => {
    const { handler, database, envia } = setup({
      users: { [TOKEN]: OTHER_ID },
    });

    const response = await handler(
      request({ disputeId: DISPUTE_ID, buyerId: OTHER_ID }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Solo el comprador puede generar la guía de retorno',
    });
    expect(database.tables()).toEqual(['disputes']);
    expect(envia.requests).toEqual([]);
  });

  it.each([
    ['a missing dispute', { dispute: null }, 404, 'Disputa no encontrada'],
    [
      'a dispute that is not waiting for the return',
      { dispute: disputeRow({ status: 'open' }) },
      422,
      'La disputa no está en fase de retorno',
    ],
    [
      'an unpaid return label',
      { dispute: disputeRow({ return_payout_status: 'pending' }) },
      422,
      'El vendedor aún no ha pagado la guía de retorno',
    ],
    [
      'an existing return label',
      { dispute: disputeRow({ return_tracking_number: 'RETURN-OLD' }) },
      409,
      'Ya existe una guía de retorno generada',
    ],
    [
      'an order without a shipping address',
      { order: { id: ORDER_ID, shipping_address: null } },
      404,
      'Dirección de envío del comprador no encontrada',
    ],
    [
      'a shipment without an origin address',
      {
        shipment: {
          id: SHIPMENT_ID,
          seller_id: SELLER_ID,
          origin_address: null,
        },
      },
      404,
      'Dirección de origen del vendedor no encontrada',
    ],
  ])(
    'answers %s without calling Envia or writing',
    async (_case, input, status, error) => {
      const { handler, database, envia } = setup(input as FakeInput);

      const response = await handler(request());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(envia.requests).toEqual([]);
      expect(
        database.calls.some(
          (call) =>
            call.kind === 'from' && call.ops.some((op) => op[0] === 'update'),
        ),
      ).toBe(false);
    },
  );

  it('loads the order and shipment the dispute names', async () => {
    const { handler, database } = setup();

    await handler(request());

    expect(database.fromCalls('orders')).toEqual([
      [['select', 'id, shipping_address'], ['eq', 'id', ORDER_ID], ['single']],
    ]);
    expect(database.fromCalls('shipments')).toEqual([
      [
        ['select', 'id, seller_id, origin_address'],
        ['eq', 'id', SHIPMENT_ID],
        ['single'],
      ],
    ]);
  });

  it.each([
    [
      'no Envia key',
      { ENVIA_MODE: 'sandbox', ENVIA_API_URL_SANDBOX: 'https://envia.test/' },
    ],
    [
      'no production URL in production mode',
      { ENVIA_MODE: 'production', ENVIA_API_KEY_PROD: 'envia-prod-key' },
    ],
  ])('answers 500 with %s without calling Envia', async (_case, env) => {
    const { handler, envia } = setup({}, { env });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Configuración de Envia.com no encontrada',
    });
    expect(envia.requests).toEqual([]);
  });
});

describe('generate-return-label Envia request and persistence', () => {
  it('generates the label from the buyer to the seller and stores it on the dispute', async () => {
    const { handler, database, envia } = setup();

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      trackingNumber: 'RETURN-TRACK-1',
      labelUrl: 'https://envia.test/r.pdf',
    });
    expect(envia.requests).toHaveLength(1);
    expect(envia.requests[0]?.url).toBe('https://envia.test/ship/generate/');
    expect(envia.requests[0]?.init?.method).toBe('POST');
    expect(
      new Headers(envia.requests[0]?.init?.headers).get('Authorization'),
    ).toBe('Bearer envia-sandbox-key');
    expect(JSON.parse(String(envia.requests[0]?.init?.body))).toEqual({
      origin: {
        name: 'Buyer Name',
        phone: '5512345678',
        street: 'Calle Uno',
        number: 'SN',
        district: 'Centro',
        city: 'Ciudad de México',
        state: 'CM',
        country: 'MX',
        postalCode: '06000',
      },
      destination: {
        name: 'Seller Name',
        phone: '3312345678',
        street: 'Avenida Dos',
        number: 'SN',
        district: 'Americana',
        city: 'Guadalajara',
        state: 'JA',
        country: 'MX',
        postalCode: '44100',
      },
      packages: [
        {
          type: 'box',
          content: 'Hardware — Devolución',
          amount: 1,
          declaredValue: 0,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: 3,
          dimensions: { length: 30, width: 30, height: 15 },
        },
      ],
      shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 },
      settings: {
        currency: 'MXN',
        printFormat: 'PDF',
        printSize: 'STOCK_4X6',
      },
    });

    const writes = database
      .fromCalls('disputes')
      .filter((ops) => ops.some((op) => op[0] === 'update'));
    expect(writes).toEqual([
      [
        [
          'update',
          {
            return_tracking_number: 'RETURN-TRACK-1',
            return_label_url: 'https://envia.test/r.pdf',
            status: 'return_shipped',
            updated_at: expect.any(String),
          },
        ],
        ['eq', 'id', DISPUTE_ID],
      ],
    ]);
    expect(database.tables()).toEqual([
      'disputes',
      'orders',
      'shipments',
      'disputes',
    ]);
  });

  it('uses the production key and URL in production mode', async () => {
    const { handler, envia } = setup(
      {},
      {
        env: {
          ENVIA_MODE: 'production',
          ENVIA_API_KEY_PROD: 'envia-prod-key',
          ENVIA_API_URL_PROD: 'https://api.envia.test',
          ENVIA_API_KEY_SANDBOX: 'envia-sandbox-key',
          ENVIA_API_URL_SANDBOX: 'https://envia.test/',
        },
      },
    );

    await handler(request());

    expect(envia.requests[0]?.url).toBe(
      'https://api.envia.test/ship/generate/',
    );
    expect(
      new Headers(envia.requests[0]?.init?.headers).get('Authorization'),
    ).toBe('Bearer envia-prod-key');
  });

  it('uses the sandbox when no Envia mode is set', async () => {
    const { handler, envia } = setup(
      {},
      {
        env: {
          ENVIA_API_KEY_SANDBOX: 'envia-sandbox-key',
          ENVIA_API_URL_SANDBOX: 'https://envia.test/',
        },
      },
    );

    await handler(request());

    expect(envia.requests[0]?.url).toBe('https://envia.test/ship/generate/');
  });

  it('answers 422 with the Envia message and writes nothing when Envia rejects the label', async () => {
    const { handler, database } = setup(
      {},
      {
        envia: {
          status: 400,
          body: { meta: 'error', description: 'Código postal inválido' },
        },
      },
    );

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'Código postal inválido',
    });
    expect(database.tables()).toEqual(['disputes', 'orders', 'shipments']);
  });

  it('still returns the generated label with a warning when the dispute update fails', async () => {
    const { handler } = setup({
      disputeUpdate: { data: null, error: { message: 'db down' } },
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      trackingNumber: 'RETURN-TRACK-1',
      labelUrl: 'https://envia.test/r.pdf',
      warning:
        'La guía se generó pero no se pudo actualizar en Selene. Contactá a soporte.',
    });
  });
});
