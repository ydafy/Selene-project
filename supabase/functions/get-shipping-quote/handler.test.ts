import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { createGetShippingQuoteHandler, createShippingQuote } from './handler';

const QUOTE_BODY = JSON.stringify({
  originZip: '06500',
  packageId: 'gpu-medium',
  price: 4500,
});

const harness = (users: Record<string, string> = {}) => {
  const tokensChecked: string[] = [];
  const quoted: Request[] = [];
  const handler = createGetShippingQuoteHandler({
    getUser: async (accessToken) => {
      tokensChecked.push(accessToken);
      const id = users[accessToken];
      return id ? { id } : null;
    },
    quote: async (req) => {
      quoted.push(req);
      return new Response(JSON.stringify({ rates: [] }), { status: 200 });
    },
  });
  return { handler, tokensChecked, quoted };
};

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/functions/v1/get-shipping-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: QUOTE_BODY,
  });

describe('get-shipping-quote authentication', () => {
  it('answers 401 AUTH_REQUIRED without an Authorization header and checks no token', async () => {
    const { handler, tokensChecked, quoted } = harness();
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
    expect(tokensChecked).toEqual([]);
    expect(quoted).toHaveLength(0);
  });

  it('answers 401 AUTH_REQUIRED for a header that is not a bearer token', async () => {
    const { handler, tokensChecked, quoted } = harness({ abc: 'user-1' });
    const response = await handler(request({ Authorization: 'Basic abc' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
    expect(tokensChecked).toEqual([]);
    expect(quoted).toHaveLength(0);
  });

  it('answers 401 AUTH_REQUIRED for a bearer header with an empty token', async () => {
    const { handler, tokensChecked, quoted } = harness();
    const response = await handler(request({ Authorization: 'Bearer ' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
    expect(tokensChecked).toEqual([]);
    expect(quoted).toHaveLength(0);
  });

  it('answers 401 AUTH_REQUIRED when the bearer is not a signed-in user (anon key or invalid token)', async () => {
    const { handler, tokensChecked, quoted } = harness();
    const response = await handler(
      request({ Authorization: 'Bearer anon-key' }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
    expect(tokensChecked).toEqual(['anon-key']);
    expect(quoted).toHaveLength(0);
  });

  it('quotes for a signed-in user', async () => {
    const { handler, tokensChecked, quoted } = harness({
      'user-token': 'user-1',
    });
    const response = await handler(
      request({ Authorization: 'Bearer user-token' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
    expect(tokensChecked).toEqual(['user-token']);
    expect(quoted).toHaveLength(1);
    expect(await quoted[0]?.text()).toBe(QUOTE_BODY);
  });
});

// The quote itself, behind the same authentication, with fake Envia, Supabase and environment.
const PRODUCTION_ENV: Record<string, string> = {
  ENVIA_API_KEY_PROD: 'production-key',
  ENVIA_API_URL_PROD: 'https://api.envia.example',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

const PRESETS = {
  'gpu-medium': { weight: '1.5', length: '30', width: '20', height: '15' },
};

const ENVIA_RATE = {
  carrier: 'Paquetexpress',
  service: 'ground',
  currency: 'MXN',
  totalPrice: '168.75',
  basePrice: 150,
  additionalCharges: 18.75,
};

const quoteHarness = (
  options: {
    env?: Record<string, string>;
    packagePresets?: unknown;
  } = {},
) => {
  const env = options.env ?? PRODUCTION_ENV;
  const clients: string[][] = [];
  const providerCalls: string[] = [];
  const handler = createGetShippingQuoteHandler({
    getUser: async (accessToken) =>
      accessToken === 'user-token' ? { id: 'user-1' } : null,
    quote: createShippingQuote({
      getEnv: (name) => env[name],
      readSupabaseSecretKey: () => env.SUPABASE_SECRET_KEY,
      createSupabaseAdmin: (supabaseUrl, supabaseSecretKey) => {
        clients.push([supabaseUrl, supabaseSecretKey]);
        const rows =
          options.packagePresets === undefined
            ? [{ id: 1, package_presets: PRESETS }]
            : [{ id: 1, package_presets: options.packagePresets }];
        const chain = {
          select: () => chain,
          eq: () => chain,
          single: async () =>
            rows[0]
              ? { data: rows[0], error: null }
              : { data: null, error: { message: 'no rows' } },
        };
        return {
          from: (table: string) => {
            if (table !== 'system_settings') {
              throw new Error(`unexpected table ${table}`);
            }
            return chain;
          },
        } as unknown as ReturnType<
          Parameters<typeof createShippingQuote>[0]['createSupabaseAdmin']
        >;
      },
      fetch: (async (input: URL | RequestInfo) => {
        providerCalls.push(String(input));
        return new Response(JSON.stringify({ data: [ENVIA_RATE] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    }),
  });
  return { handler, clients, providerCalls };
};

const quoteRequest = (
  body: unknown,
  authorization: string | null = 'Bearer user-token',
) =>
  new Request('http://localhost/functions/v1/get-shipping-quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('get-shipping-quote quote', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('quotes the requested preset through the production Envia pair', async () => {
    const { handler, clients, providerCalls } = quoteHarness();

    const response = await handler(quoteRequest(JSON.parse(QUOTE_BODY)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rates: [
        {
          carrier: 'Paquetexpress',
          service: 'ground',
          price: 168.75,
          estimated_days: 3,
        },
      ],
    });
    expect(clients).toEqual([['http://supabase.test', 'sb_secret_test']]);
    expect(providerCalls).toEqual(['https://api.envia.example/ship/rate/']);
  });

  it('answers 401 AUTH_REQUIRED before any database or Envia call', async () => {
    const { handler, clients, providerCalls } = quoteHarness();

    const response = await handler(quoteRequest(JSON.parse(QUOTE_BODY), null));

    expect(response.status).toBe(401);
    expect(clients).toEqual([]);
    expect(providerCalls).toEqual([]);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a malformed origin zip', { ...JSON.parse(QUOTE_BODY), originZip: '065' }],
    [
      'a malformed destination zip',
      { ...JSON.parse(QUOTE_BODY), destinationZip: 'abcde' },
    ],
    ['a price of zero', { ...JSON.parse(QUOTE_BODY), price: 0 }],
    ['a blank package id', { ...JSON.parse(QUOTE_BODY), packageId: '   ' }],
  ])(
    'answers 422 INVALID_INPUT for %s before any database or Envia call',
    async (_case, body) => {
      const { handler, clients, providerCalls } = quoteHarness();

      const response = await handler(quoteRequest(body));

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'INVALID_INPUT' });
      expect(clients).toEqual([]);
      expect(providerCalls).toEqual([]);
    },
  );

  it('answers 500 MISSING_SERVER_CONFIG without the production Envia pair, ignoring sandbox secrets', async () => {
    const { handler, clients } = quoteHarness({
      env: {
        SUPABASE_URL: 'http://supabase.test',
        SUPABASE_SECRET_KEY: 'sb_secret_test',
        ENVIA_MODE: 'sandbox',
        ENVIA_API_KEY_SANDBOX: 'sandbox-key',
        ENVIA_API_URL_SANDBOX: 'https://api-test.envia.example',
      },
    });

    const response = await handler(quoteRequest(JSON.parse(QUOTE_BODY)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'MISSING_SERVER_CONFIG' });
    expect(clients).toEqual([]);
  });

  it('answers 500 SYSTEM_CONFIG_NOT_FOUND when no package presets are configured', async () => {
    const { handler, providerCalls } = quoteHarness({ packagePresets: null });

    const response = await handler(quoteRequest(JSON.parse(QUOTE_BODY)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'SYSTEM_CONFIG_NOT_FOUND',
    });
    expect(providerCalls).toEqual([]);
  });

  it('answers 422 UNKNOWN_PACKAGE_PRESET for a preset the server does not define', async () => {
    const { handler, providerCalls } = quoteHarness();

    const response = await handler(
      quoteRequest({ ...JSON.parse(QUOTE_BODY), packageId: 'cpu-small' }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'UNKNOWN_PACKAGE_PRESET' });
    expect(providerCalls).toEqual([]);
  });
});
