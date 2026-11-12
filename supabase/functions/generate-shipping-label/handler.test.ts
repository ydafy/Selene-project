import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createGenerateShippingLabelHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Result = { data?: unknown; error?: unknown; count?: number | null };

const SELLER_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000a2';
const ORDER_ID = '00000000-0000-4000-8000-0000000000d1';
const SHIPMENT_ID = '00000000-0000-4000-8000-0000000000c1';
const ORIGIN_ADDRESS_ID = '00000000-0000-4000-8000-0000000000e1';
const TOKEN = 'seller-access-token';
const ENVIA_URL = 'https://envia.test/';

const photo = (slot: number, owner = SELLER_ID) =>
  `shipments/${ORDER_ID}/${owner}/slot_${slot}_1700000000000.jpg`;
const IMAGES = [photo(0), photo(1), photo(2)];

const validBody = {
  shipmentId: SHIPMENT_ID,
  originAddressId: ORIGIN_ADDRESS_ID,
  shippingEvidence: { images: IMAGES },
};

const buyerSnapshot = {
  full_name: 'Buyer Name',
  phone: '5512345678',
  street_line1: 'Calle Uno',
  street_number: '10',
  district: 'Centro',
  city: 'Ciudad de México',
  state: 'CMX',
  country: 'MX',
  zip_code: '06000',
};

const sellerAddress = {
  full_name: 'Seller Name',
  phone: '3312345678',
  street_line1: 'Avenida Dos',
  street_number: '20',
  district: 'Americana',
  city: 'Guadalajara',
  state: 'JAL',
  country: 'MX',
  zip_code: '44100',
};

const shipmentRow = (overrides: Row = {}): Row => ({
  id: SHIPMENT_ID,
  seller_id: SELLER_ID,
  status: 'paid',
  tracking_number: null,
  label_url: null,
  label_quote_carrier: null,
  label_quote_service: null,
  label_quote_cost_cents: null,
  label_quote_reference: null,
  label_quote_input_hash: null,
  origin_address: null,
  order: {
    id: ORDER_ID,
    total_amount: 1500,
    shipping_address: buyerSnapshot,
  },
  items: [
    {
      price_at_purchase: 1500,
      product: { package_preset: 'gpu_1', category: 'GPU' },
    },
  ],
  ...overrides,
});

const settingsRow = (overrides: Row = {}): Row => ({
  package_presets: {
    gpu_1: { length: 40, width: 30, height: 15, weight: 2 },
    mobo_1: { length: 50, width: 40, height: 20, weight: 4 },
  },
  novice_completed_threshold: 3,
  novice_active_limit: 3,
  trusted_active_limit: 10,
  envia_carrier: 'paquetexpress',
  envia_service: 'ground',
  envia_print_format: 'PDF',
  envia_print_size: 'STOCK_4X6',
  ...overrides,
});

const ENV = {
  ENVIA_MODE: 'sandbox',
  ENVIA_API_KEY_SANDBOX: 'envia-sandbox-key',
  ENVIA_API_URL_SANDBOX: ENVIA_URL,
};

type Call =
  | { kind: 'auth'; token: string }
  | { kind: 'from'; table: string; ops: unknown[][] }
  | { kind: 'rpc'; name: string; args: Row };

interface FakeInput {
  users?: Record<string, string>;
  authError?: boolean;
  shipment?: Row | null;
  settings?: Row | null;
  address?: Row | null;
  completedCount?: number;
  activeCount?: number;
  evidenceUpdate?: Result;
  finalizedLabel?: Row | null;
  rpc?: Record<string, Result>;
}

const DEFAULT_RPC: Record<string, Result> = {
  fn_claim_shipment_label: {
    data: { status: 'claimed', claim_token: 'claim-1' },
  },
  fn_persist_shipment_label_quote: { data: true },
  fn_mark_shipment_label_sent: { data: true },
  fn_finalize_shipment_label: { data: true },
  fn_mark_shipment_label_rejected: { data: true },
  fn_mark_shipment_label_orphan: { data: true },
};

// A recording Supabase fake. Each `from(...)` chain records its operations; the result is chosen
// from the table and those operations when the chain is awaited, so a test asserts the exact
// filters, writes and RPC arguments that reached the database.
function fakeDatabase(input: FakeInput = {}) {
  const users = input.users ?? { [TOKEN]: SELLER_ID };
  const rpcResults = { ...DEFAULT_RPC, ...input.rpc };
  const calls: Call[] = [];

  const respond = (table: string, ops: unknown[][]): Result => {
    const op = (name: string) => ops.find((entry) => entry[0] === name);
    if (table === 'system_settings') {
      return input.settings === null
        ? { data: null, error: { message: 'missing' } }
        : { data: input.settings ?? settingsRow(), error: null };
    }
    if (table === 'addresses') {
      return input.address === null
        ? { data: null, error: { message: 'missing' } }
        : { data: input.address ?? sellerAddress, error: null };
    }
    if (table === 'shipments') {
      if (op('update')) {
        return input.evidenceUpdate ?? { data: [{ id: SHIPMENT_ID }] };
      }
      const columns = String(op('select')?.[1] ?? '');
      if (columns.includes('label_quote_carrier')) {
        return input.shipment === null
          ? { data: null, error: { message: 'missing' } }
          : { data: input.shipment ?? shipmentRow(), error: null };
      }
      if (columns === 'id') {
        return op('in')
          ? { count: input.activeCount ?? 0, error: null }
          : { count: input.completedCount ?? 0, error: null };
      }
      if (columns === 'label_url, tracking_number') {
        return input.finalizedLabel === null ||
          input.finalizedLabel === undefined
          ? { data: null, error: { message: 'missing' } }
          : { data: input.finalizedLabel, error: null };
      }
    }
    throw new Error(
      `fake database: unexpected ${table} ${JSON.stringify(ops)}`,
    );
  };

  const query = (table: string) => {
    const ops: unknown[][] = [];
    calls.push({ kind: 'from', table, ops });
    const settle = () => Promise.resolve(respond(table, ops));
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'is', 'update']) {
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
    rpc: async (name: string, args: Row) => {
      calls.push({ kind: 'rpc', name, args });
      const result = rpcResults[name];
      if (!result) throw new Error(`fake database: unexpected rpc ${name}`);
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };

  const rpcCalls = () =>
    calls.flatMap((call) =>
      call.kind === 'rpc' ? [{ name: call.name, args: call.args }] : [],
    );
  const tables = () =>
    calls.flatMap((call) => (call.kind === 'from' ? [call.table] : []));
  const fromCalls = (table: string) =>
    calls.flatMap((call) =>
      call.kind === 'from' && call.table === table ? [call.ops] : [],
    );

  return {
    client: client as unknown as SupabaseAdminClient,
    calls,
    rpcCalls,
    tables,
    fromCalls,
  };
}

const rateBody = {
  meta: 'rate',
  data: [
    {
      carrier: 'paquetexpress',
      service: 'ground',
      currency: 'MXN',
      totalPrice: 150.5,
      quoteId: 'quote-1',
    },
  ],
};

const generateBody = {
  meta: 'generate',
  data: [
    {
      trackingNumber: 'TRACK-1',
      label: 'https://envia.test/label.pdf',
      shipmentId: 777,
      totalPrice: 162.25,
    },
  ],
};

type EnviaReply = { status?: number; body: unknown } | 'throw';

// Records every Envia request; replies by endpoint.
function fakeEnvia(replies: { rate?: EnviaReply; generate?: EnviaReply } = {}) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchFake = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const reply = String(url).endsWith('ship/rate/')
      ? (replies.rate ?? { body: rateBody })
      : (replies.generate ?? { body: generateBody });
    if (reply === 'throw') throw new Error('connection reset');
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
    });
  }) as unknown as typeof fetch;
  const bodies = () =>
    requests.map((request) => JSON.parse(String(request.init?.body)));
  return { fetchFake, requests, bodies };
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
  const handler = createGenerateShippingLabelHandler({
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
  body: unknown = validBody,
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
) =>
  new Request('https://example.com/functions/v1/generate-shipping-label', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const SHIPMENT_SELECT_FILTERS = [['eq', 'id', SHIPMENT_ID], ['single']];

let logSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('generate-shipping-label request validation and authentication', () => {
  it.each([
    ['a non-JSON body', 'not json'],
    ['a missing evidence list', { ...validBody, shippingEvidence: undefined }],
    ['an invalid shipment id', { ...validBody, shipmentId: 'not-a-uuid' }],
    [
      'two evidence photos',
      { ...validBody, shippingEvidence: { images: [photo(0), photo(1)] } },
    ],
  ])(
    'rejects %s with 400 before creating a client or calling Envia',
    async (_case, body) => {
      const { handler, database, envia, clientsCreated } = setup();

      const response = await handler(request(body));

      expect(response.status).toBe(400);
      expect(String((await response.json()).error)).toStartWith(
        'Datos inválidos: ',
      );
      expect(clientsCreated()).toBe(0);
      expect(database.calls).toEqual([]);
      expect(envia.requests).toEqual([]);
    },
  );

  it('names the failing field in the 400 message', async () => {
    const { handler } = setup();

    const response = await handler(
      request({ ...validBody, originAddressId: 'nope' }),
    );

    expect(await response.json()).toEqual({
      error: 'Datos inválidos: originAddressId: ID de origen inválido',
    });
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
    'answers 401 AUTH_REQUIRED for %s before any table, RPC or Envia call',
    async (_case, headers, input) => {
      const { handler, database, envia } = setup(input);

      const response = await handler(request(validBody, headers));

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

  it('answers 500 without detail when the client cannot be built', async () => {
    const handler = createGenerateShippingLabelHandler({
      createSupabaseAdmin: () => {
        throw new Error('missing secret key');
      },
      getEnv: (name) => (ENV as Record<string, string>)[name],
      fetch: fakeEnvia().fetchFake,
    });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Error interno del servidor',
    });
  });
});

describe('generate-shipping-label ownership and preconditions', () => {
  it('loads the shipment by its id and the settings row', async () => {
    const { handler, database } = setup();

    await handler(request());

    const [shipmentRead] = database.fromCalls('shipments');
    expect(shipmentRead?.[0]?.[0]).toBe('select');
    expect(String(shipmentRead?.[0]?.[1])).toContain(
      'product:products(package_preset, category)',
    );
    expect(shipmentRead?.slice(1)).toEqual(SHIPMENT_SELECT_FILTERS);
    expect(database.fromCalls('system_settings')).toHaveLength(1);
  });

  it('refuses another seller with 403 even when the label already exists', async () => {
    const { handler, database, envia } = setup({
      shipment: shipmentRow({
        seller_id: OTHER_ID,
        tracking_number: 'TRACK-OLD',
        label_url: 'https://envia.test/old.pdf',
      }),
    });

    const response = await handler(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'No tienes permiso para gestionar este envío',
    });
    expect(database.rpcCalls()).toEqual([]);
    expect(database.tables()).toEqual(['shipments', 'system_settings']);
    expect(envia.requests).toEqual([]);
  });

  it('refuses evidence outside the seller folder for this order, even when the label already exists', async () => {
    const { handler, database, envia } = setup({
      shipment: shipmentRow({
        tracking_number: 'TRACK-OLD',
        label_url: 'https://envia.test/old.pdf',
      }),
    });

    const response = await handler(
      request({
        ...validBody,
        shippingEvidence: { images: [photo(0), photo(1), photo(2, OTHER_ID)] },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Las fotos de evidencia deben ser tuyas y de este pedido',
    });
    expect(database.rpcCalls()).toEqual([]);
    expect(envia.requests).toEqual([]);
  });

  it('replays an existing label for its seller without claiming or calling Envia', async () => {
    const { handler, database, envia } = setup({
      shipment: shipmentRow({
        status: 'preparing',
        tracking_number: 'TRACK-OLD',
        label_url: 'https://envia.test/old.pdf',
      }),
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      labelUrl: 'https://envia.test/old.pdf',
      trackingNumber: 'TRACK-OLD',
    });
    expect(database.rpcCalls()).toEqual([]);
    expect(database.tables()).toEqual(['shipments', 'system_settings']);
    expect(envia.requests).toEqual([]);
  });

  it.each([
    ['a missing shipment', { shipment: null }, 404, 'Envío no encontrado'],
    [
      'missing settings',
      { settings: null },
      500,
      'Error cargando configuración del sistema',
    ],
    [
      'a zero declared value',
      {
        shipment: shipmentRow({
          items: [
            {
              price_at_purchase: 0,
              product: { package_preset: 'gpu_1', category: 'GPU' },
            },
          ],
        }),
      },
      422,
      'El envío no tiene un valor asegurable válido.',
    ],
    [
      'a carrier other than Paquetexpress in the settings',
      { settings: settingsRow({ envia_carrier: 'dhl' }) },
      503,
      'ENVIA_CONFIGURATION_INVALID',
    ],
    [
      'a shipment that is not paid',
      { shipment: shipmentRow({ status: 'preparing' }) },
      422,
      'Solo se pueden generar guías de envíos pagados.',
    ],
  ])(
    'answers %s without claiming or calling Envia',
    async (_case, input, status, error) => {
      const { handler, database, envia } = setup(input as FakeInput);

      const response = await handler(request());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(database.rpcCalls()).toEqual([]);
      expect(envia.requests).toEqual([]);
    },
  );

  it("loads the origin address only among the seller's live addresses", async () => {
    const { handler, database } = setup();

    await handler(request({ ...validBody, sellerId: OTHER_ID }));

    expect(database.fromCalls('addresses')).toEqual([
      [
        [
          'select',
          'full_name, phone, street_line1, street_number, district, city, state, country, zip_code',
        ],
        ['eq', 'id', ORIGIN_ADDRESS_ID],
        ['eq', 'user_id', SELLER_ID],
        ['is', 'deleted_at', null],
        ['single'],
      ],
    ]);
  });

  it('asks for a buyer address correction before the active-shipment limit can mask it', async () => {
    const { handler, database, envia } = setup({
      shipment: shipmentRow({
        order: {
          id: ORDER_ID,
          total_amount: 1500,
          shipping_address: { ...buyerSnapshot, street_number: undefined },
        },
      }),
      activeCount: 99,
    });

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'BUYER_DESTINATION_CORRECTION_REQUIRED',
    });
    expect(database.tables()).toEqual([
      'shipments',
      'system_settings',
      'addresses',
    ]);
    expect(database.rpcCalls()).toEqual([]);
    expect(envia.requests).toEqual([]);
  });

  it('asks for a seller address correction when the origin address is not found', async () => {
    const { handler, database } = setup({ address: null });

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'SELLER_ORIGIN_CORRECTION_REQUIRED',
    });
    expect(database.rpcCalls()).toEqual([]);
  });

  it('uses the origin address frozen on the shipment over the requested one', async () => {
    const { handler, envia } = setup({
      shipment: shipmentRow({
        origin_address: { ...sellerAddress, city: 'Zapopan' },
      }),
    });

    await handler(request());

    expect(envia.bodies()[0].origin.city).toBe('Zapopan');
  });

  it.each([
    [
      'a novice seller at the novice limit',
      2,
      3,
      'Límite de envíos activos alcanzado (3/3).',
    ],
    [
      'a trusted seller at the trusted limit',
      3,
      10,
      'Límite de envíos activos alcanzado (10/10).',
    ],
  ])(
    'answers 429 for %s without claiming or calling Envia',
    async (_case, completedCount, activeCount, message) => {
      const { handler, database, envia } = setup({
        completedCount,
        activeCount,
      });

      const response = await handler(request());

      expect(response.status).toBe(429);
      expect(String((await response.json()).error)).toStartWith(message);
      expect(database.rpcCalls()).toEqual([]);
      expect(envia.requests).toEqual([]);
    },
  );

  it("counts only the verified seller's completed and active shipments", async () => {
    const { handler, database } = setup({ completedCount: 3, activeCount: 9 });

    const response = await handler(request());

    expect(response.status).toBe(200);
    const counts = database
      .fromCalls('shipments')
      .filter((ops) => ops[0]?.[1] === 'id');
    expect(counts).toEqual([
      [
        ['select', 'id', { count: 'exact', head: true }],
        ['eq', 'seller_id', SELLER_ID],
        ['eq', 'status', 'completed'],
      ],
      [
        ['select', 'id', { count: 'exact', head: true }],
        ['eq', 'seller_id', SELLER_ID],
        [
          'in',
          'status',
          [
            'preparing',
            'shipped',
            'delivered',
            'dispute',
            'waiting_return',
            'return_shipped',
          ],
        ],
      ],
    ]);
  });

  it('blocks the label before claiming when no package preset is usable', async () => {
    const { handler, database, envia } = setup({
      settings: settingsRow({ package_presets: {} }),
    });

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'PACKAGE_PRESET_UNAVAILABLE',
    });
    expect(database.rpcCalls()).toEqual([]);
    expect(envia.requests).toEqual([]);
  });

  it.each([
    ['no Envia mode', {}],
    [
      'an http Envia URL',
      { ...ENV, ENVIA_API_URL_SANDBOX: 'http://envia.test/' },
    ],
    ['no key for the active mode', { ...ENV, ENVIA_MODE: 'production' }],
  ])(
    'answers 503 ENVIA_CONFIGURATION_INVALID with %s before claiming',
    async (_case, env) => {
      const { handler, database, envia } = setup({}, { env });

      const response = await handler(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'ENVIA_CONFIGURATION_INVALID',
      });
      expect(database.rpcCalls()).toEqual([]);
      expect(envia.requests).toEqual([]);
    },
  );
});

describe('generate-shipping-label claim, Envia and persistence', () => {
  it('claims, stores the evidence, rates, generates and finalizes the label for the verified seller', async () => {
    const { handler, database } = setup();

    const response = await handler(
      request({ ...validBody, sellerId: OTHER_ID }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      labelUrl: 'https://envia.test/label.pdf',
      trackingNumber: 'TRACK-1',
    });

    const rpcCalls = database.rpcCalls();
    const inputHash = rpcCalls[1]?.args.p_input_hash;
    expect(inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpcCalls).toEqual([
      {
        name: 'fn_claim_shipment_label',
        args: {
          p_shipment_id: SHIPMENT_ID,
          p_seller_id: SELLER_ID,
          p_origin_address_id: ORIGIN_ADDRESS_ID,
        },
      },
      {
        name: 'fn_persist_shipment_label_quote',
        args: {
          p_shipment_id: SHIPMENT_ID,
          p_claim_token: 'claim-1',
          p_carrier: 'paquetexpress',
          p_service: 'ground',
          p_quote_cost_cents: 15_050,
          p_quote_reference: 'quote-1',
          p_input_hash: inputHash,
        },
      },
      {
        name: 'fn_mark_shipment_label_sent',
        args: { p_shipment_id: SHIPMENT_ID, p_claim_token: 'claim-1' },
      },
      {
        name: 'fn_finalize_shipment_label',
        args: {
          p_shipment_id: SHIPMENT_ID,
          p_claim_token: 'claim-1',
          p_envia_shipment_id: '777',
          p_tracking_number: 'TRACK-1',
          p_label_url: 'https://envia.test/label.pdf',
          p_carrier: 'paquetexpress',
          p_service: 'ground',
          p_print_format: 'PDF',
          p_print_size: 'STOCK_4X6',
          p_provider_cost_cents: 16_225,
        },
      },
    ]);
  });

  it('writes the shipment row only to store the evidence, guarded by the claim token', async () => {
    const { handler, database } = setup();

    await handler(request());

    const writes = database
      .fromCalls('shipments')
      .filter((ops) => ops.some((op) => op[0] === 'update'));
    expect(writes).toEqual([
      [
        ['update', { shipping_evidence: { images: IMAGES } }],
        ['eq', 'id', SHIPMENT_ID],
        ['eq', 'claim_token', 'claim-1'],
        ['eq', 'label_generation_state', 'claimed'],
        ['select', 'id'],
      ],
    ]);
    const claimAt = database.calls.findIndex(
      (call) => call.kind === 'rpc' && call.name === 'fn_claim_shipment_label',
    );
    const writeAt = database.calls.findIndex(
      (call) =>
        call.kind === 'from' && call.ops.some((op) => op[0] === 'update'),
    );
    expect(writeAt).toBeGreaterThan(claimAt);
  });

  it('sends the rate and label requests to the active Envia environment with the seller, buyer and package', async () => {
    const { handler, envia } = setup();

    await handler(request());

    expect(envia.requests.map((entry) => entry.url)).toEqual([
      'https://envia.test/ship/rate/',
      'https://envia.test/ship/generate/',
    ]);
    for (const entry of envia.requests) {
      expect(entry.init?.method).toBe('POST');
      expect(new Headers(entry.init?.headers).get('Authorization')).toBe(
        'Bearer envia-sandbox-key',
      );
    }
    const [rate, generate] = envia.bodies();
    expect(rate).toEqual({
      origin: {
        name: 'Seller Name',
        phone: '3312345678',
        street: 'Avenida Dos',
        number: '20',
        district: 'Americana',
        city: 'Guadalajara',
        state: 'JA',
        country: 'MX',
        postalCode: '44100',
      },
      destination: {
        name: 'Buyer Name',
        phone: '5512345678',
        street: 'Calle Uno',
        number: '10',
        district: 'Centro',
        city: 'Ciudad de México',
        state: 'CX',
        country: 'MX',
        postalCode: '06000',
      },
      packages: [
        {
          type: 'box',
          content: 'Tarjeta de video',
          amount: 1,
          declaredValue: 1500,
          lengthUnit: 'CM',
          weightUnit: 'KG',
          weight: 2,
          dimensions: { length: 40, width: 30, height: 15 },
          additionalServices: [
            { data: { amount: 1500 }, service: 'envia_insurance' },
          ],
        },
      ],
      shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 },
      settings: {
        currency: 'MXN',
        printFormat: 'PDF',
        printSize: 'STOCK_4X6',
      },
    });
    expect(generate).toEqual(rate);
  });

  it('uses the production key and URL when Envia runs in production', async () => {
    const { handler, envia } = setup(
      {},
      {
        env: {
          ENVIA_MODE: 'production',
          ENVIA_API_KEY_PROD: 'envia-prod-key',
          ENVIA_API_URL_PROD: 'https://api.envia.test',
          ENVIA_API_KEY_SANDBOX: 'envia-sandbox-key',
          ENVIA_API_URL_SANDBOX: ENVIA_URL,
        },
      },
    );

    await handler(request());

    expect(envia.requests[0]?.url).toBe('https://api.envia.test/ship/rate/');
    expect(
      new Headers(envia.requests[0]?.init?.headers).get('Authorization'),
    ).toBe('Bearer envia-prod-key');
  });

  it('reuses a stored Paquetexpress quote for the same inputs without asking Envia for a rate', async () => {
    const first = setup();
    await first.handler(request());
    const inputHash = first.database.rpcCalls()[1]?.args.p_input_hash;

    const { handler, database, envia } = setup({
      shipment: shipmentRow({
        label_quote_carrier: 'paquetexpress',
        label_quote_service: 'ground',
        label_quote_cost_cents: 14_000,
        label_quote_reference: 'quote-old',
        label_quote_input_hash: inputHash,
      }),
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(envia.requests.map((entry) => entry.url)).toEqual([
      'https://envia.test/ship/generate/',
    ]);
    expect(database.rpcCalls()[1]).toEqual({
      name: 'fn_persist_shipment_label_quote',
      args: expect.objectContaining({
        p_quote_cost_cents: 14_000,
        p_quote_reference: 'quote-old',
      }),
    });
  });

  it('stops before Envia when this request does not win the claim', async () => {
    const { handler, database, envia } = setup({
      rpc: { fn_claim_shipment_label: { data: null, error: { message: 'x' } } },
    });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'LABEL_GENERATION_CONFLICT',
    });
    expect(database.rpcCalls().map((call) => call.name)).toEqual([
      'fn_claim_shipment_label',
    ]);
    expect(envia.requests).toEqual([]);
  });

  it('replays a label another request finalized concurrently', async () => {
    const { handler, database, envia } = setup({
      rpc: { fn_claim_shipment_label: { data: { status: 'generated' } } },
      finalizedLabel: {
        label_url: 'https://envia.test/concurrent.pdf',
        tracking_number: 'TRACK-CONCURRENT',
      },
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      labelUrl: 'https://envia.test/concurrent.pdf',
      trackingNumber: 'TRACK-CONCURRENT',
    });
    expect(database.fromCalls('shipments').at(-1)).toEqual([
      ['select', 'label_url, tracking_number'],
      ['eq', 'id', SHIPMENT_ID],
      ['single'],
    ]);
    expect(envia.requests).toEqual([]);
  });

  it('answers 409 when a generated claim has no stored label yet', async () => {
    const { handler } = setup({
      rpc: { fn_claim_shipment_label: { data: { status: 'generated' } } },
      finalizedLabel: null,
    });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'LABEL_GENERATION_CONFLICT',
    });
  });

  it.each([
    ['releases the claim', { data: true }],
    ['cannot release the claim', { data: false }],
  ])(
    'answers 500 without calling Envia when the evidence write fails and it %s',
    async (_case, rejected) => {
      const { handler, database, envia } = setup({
        evidenceUpdate: { data: [] },
        rpc: { fn_mark_shipment_label_rejected: rejected },
      });

      const response = await handler(request());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'No se pudo guardar la evidencia de envío',
      });
      expect(database.rpcCalls()).toEqual([
        expect.objectContaining({ name: 'fn_claim_shipment_label' }),
        {
          name: 'fn_mark_shipment_label_rejected',
          args: {
            p_shipment_id: SHIPMENT_ID,
            p_claim_token: 'claim-1',
            p_error_class: 'evidence_persistence_failed',
          },
        },
      ]);
      expect(envia.requests).toEqual([]);
    },
  );

  it('releases the claim and answers 422 when Envia offers no single Paquetexpress ground rate', async () => {
    const { handler, database, envia } = setup(
      {},
      { envia: { rate: { body: { data: [] } } } },
    );

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'PAQUETEXPRESS_GROUND_UNAVAILABLE',
    });
    expect(database.rpcCalls().at(-1)).toEqual({
      name: 'fn_mark_shipment_label_rejected',
      args: {
        p_shipment_id: SHIPMENT_ID,
        p_claim_token: 'claim-1',
        p_error_class: 'deterministic_provider_rejection',
      },
    });
    expect(envia.requests.map((entry) => entry.url)).toEqual([
      'https://envia.test/ship/rate/',
    ]);
  });

  it('answers 500 and releases the claim when the label cannot be marked sent', async () => {
    const { handler, database, envia } = setup({
      rpc: { fn_mark_shipment_label_sent: { data: false } },
    });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'LABEL_GENERATION_CONFLICT',
    });
    expect(database.rpcCalls().at(-1)?.name).toBe(
      'fn_mark_shipment_label_rejected',
    );
    expect(envia.requests.map((entry) => entry.url)).toEqual([
      'https://envia.test/ship/rate/',
    ]);
  });

  it('releases the claim and answers 422 when Envia deterministically rejects the label', async () => {
    const { handler, database } = setup(
      {},
      {
        envia: {
          generate: {
            status: 400,
            body: {
              meta: 'error',
              error: 'Invalid address',
              code: 'INVALID_ADDRESS',
            },
          },
        },
      },
    );

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'PAQUETEXPRESS_GROUND_UNAVAILABLE',
    });
    expect(database.rpcCalls().at(-1)).toEqual({
      name: 'fn_mark_shipment_label_rejected',
      args: {
        p_shipment_id: SHIPMENT_ID,
        p_claim_token: 'claim-1',
        p_error_class: 'deterministic_provider_rejection',
      },
    });
  });

  it.each([
    ['the Envia request fails', { generate: 'throw' as const }],
    [
      'Envia answers 500',
      { generate: { status: 500, body: { meta: 'error' } } },
    ],
    [
      'Envia accepts without a label cost',
      {
        generate: {
          body: {
            data: [
              {
                trackingNumber: 'TRACK-1',
                label: 'https://envia.test/label.pdf',
                shipmentId: 777,
              },
            ],
          },
        },
      },
    ],
  ])('marks the label for reconciliation when %s', async (_case, replies) => {
    const { handler, database } = setup({}, { envia: replies });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'LABEL_RECONCILIATION_REQUIRED',
    });
    expect(database.rpcCalls().at(-1)).toEqual({
      name: 'fn_mark_shipment_label_orphan',
      args: {
        p_shipment_id: SHIPMENT_ID,
        p_claim_token: 'claim-1',
        p_error_class: 'provider_outcome_unproven',
      },
    });
  });

  it('marks an accepted label for reconciliation when finalization fails', async () => {
    const { handler, database } = setup({
      rpc: { fn_finalize_shipment_label: { data: false } },
    });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'LABEL_RECONCILIATION_REQUIRED',
    });
    expect(
      database
        .rpcCalls()
        .map((call) => call.name)
        .slice(-2),
    ).toEqual(['fn_finalize_shipment_label', 'fn_mark_shipment_label_orphan']);
  });

  it('answers 500 LABEL_STATE_PERSISTENCE_FAILED when the orphan state cannot be stored', async () => {
    const { handler } = setup(
      { rpc: { fn_mark_shipment_label_orphan: { data: false } } },
      { envia: { generate: 'throw' } },
    );

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'LABEL_STATE_PERSISTENCE_FAILED',
    });
  });
});
