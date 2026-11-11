import { describe, expect, it } from 'bun:test';

import { createGetShippingQuoteHandler } from './handler';

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
