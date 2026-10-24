import { describe, expect, test } from 'bun:test';
import {
  assessFreshTracking,
  classifyEnviaCancelResponse,
  fetchFreshTracking,
  requestEnviaLabelCancellation,
  type EnviaCarrierRequestDependencies,
} from './envia-carrier-cancellation.ts';

const TRACKING = '7520610403';
const API_KEY = 'secret-envia-key';
const config = {
  mode: 'sandbox' as const,
  apiKey: API_KEY,
  apiUrl: 'https://api-test.envia.com',
};

const observation = (status: string, trackingNumber = TRACKING) => ({
  trackingNumber,
  status,
});

describe('assessFreshTracking', () => {
  test.each(['shipped', 'picked up', 'delivered'])(
    'reports scanned for %s',
    (status) => {
      expect(assessFreshTracking(TRACKING, [observation(status)]).state).toBe(
        'scanned',
      );
    },
  );

  test.each([
    [['created']],
    [['pending']],
    [['created', 'information']],
    [['n/a']],
  ])('reports unscanned for %p', (statuses) => {
    expect(
      assessFreshTracking(
        TRACKING,
        statuses.map((status) => observation(status)),
      ).state,
    ).toBe('unscanned');
  });

  test('a scan anywhere in the history wins over created', () => {
    expect(
      assessFreshTracking(TRACKING, [
        observation('created'),
        observation('shipped'),
      ]).state,
    ).toBe('scanned');
  });

  test.each([
    ['canceled'],
    ['lost'],
    ['returned'],
    ['1 delivery attempt'],
    ['something new'],
  ])('fails closed to unknown for %s', (status) => {
    expect(
      assessFreshTracking(TRACKING, [
        observation('created'),
        observation(status),
      ]).state,
    ).toBe('unknown');
  });

  test('reports unknown with no observations', () => {
    expect(assessFreshTracking(TRACKING, [])).toEqual({
      state: 'unknown',
      observations: [],
    });
  });

  test('ignores observations of another tracking number', () => {
    const result = assessFreshTracking(TRACKING, [
      observation('shipped', 'OTHER'),
    ]);
    expect(result.state).toBe('unknown');
    expect(result.observations).toEqual([]);
  });

  test('returns only the observations of the requested tracking number', () => {
    const own = observation('created');
    const result = assessFreshTracking(TRACKING, [
      own,
      observation('shipped', 'OTHER'),
    ]);
    expect(result).toEqual({ state: 'unscanned', observations: [own] });
  });
});

const accepted = (data: Record<string, unknown> = {}) => ({
  kind: 'response' as const,
  status: 200,
  body: {
    meta: 'cancel',
    data: { trackingNumber: TRACKING, ...data },
  },
});

describe('classifyEnviaCancelResponse', () => {
  test('accepted with balance returned and a valid date', () => {
    expect(
      classifyEnviaCancelResponse(
        TRACKING,
        accepted({
          balanceReturned: true,
          balanceReturnDate: '2026-10-01T12:31:00.000Z',
        }),
      ),
    ).toEqual({
      outcome: 'accepted',
      balanceReturned: true,
      balanceReturnedAt: '2026-10-01T12:31:00.000Z',
    });
  });

  test('accepted with balance returned and an invalid date keeps a null date', () => {
    expect(
      classifyEnviaCancelResponse(
        TRACKING,
        accepted({ balanceReturned: true, balanceReturnDate: 'not a date' }),
      ),
    ).toEqual({
      outcome: 'accepted',
      balanceReturned: true,
      balanceReturnedAt: null,
    });
  });

  test('accepted with balance not returned', () => {
    expect(
      classifyEnviaCancelResponse(
        TRACKING,
        accepted({
          balanceReturned: false,
          balanceReturnDate: '2026-10-01T12:31:00.000Z',
        }),
      ),
    ).toEqual({
      outcome: 'accepted',
      balanceReturned: false,
      balanceReturnedAt: null,
    });
  });

  test.each([[undefined], [''], ['true'], [1]])(
    'treats balanceReturned %p as not returned',
    (balanceReturned) => {
      expect(
        classifyEnviaCancelResponse(
          TRACKING,
          accepted({
            balanceReturned,
            balanceReturnDate: '2026-10-01T12:31:00.000Z',
          }),
        ),
      ).toEqual({
        outcome: 'accepted',
        balanceReturned: false,
        balanceReturnedAt: null,
      });
    },
  );

  test('2xx for another tracking number is ambiguous', () => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status: 200,
        body: { meta: 'cancel', data: { trackingNumber: 'OTHER' } },
      }),
    ).toEqual({ outcome: 'ambiguous' });
  });

  test('2xx with an error meta is ambiguous', () => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status: 200,
        body: { meta: 'error', error: { code: 1 } },
      }),
    ).toEqual({ outcome: 'ambiguous' });
  });

  test('2xx without data is ambiguous', () => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status: 200,
        body: { meta: 'cancel' },
      }),
    ).toEqual({ outcome: 'ambiguous' });
  });

  test.each([401, 403, 429])('HTTP %i is unavailable', (status) => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status,
        body: { meta: 'error', error: { code: 9 } },
      }),
    ).toEqual({ outcome: 'unavailable' });
  });

  test.each([400, 422])('HTTP %i with an Envia error is refused', (status) => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status,
        body: { meta: 'error', error: { code: 1234, message: 'scanned' } },
      }),
    ).toEqual({ outcome: 'refused', errorCode: '1234' });
  });

  test('a refusal without a code carries a null code', () => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status: 400,
        body: { meta: 'error' },
      }),
    ).toEqual({ outcome: 'refused', errorCode: null });
  });

  test('a refusal identified by an error field and a string code', () => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status: 422,
        body: { error: 'cannot cancel', code: 'E_SCANNED' },
      }),
    ).toEqual({ outcome: 'refused', errorCode: 'E_SCANNED' });
  });

  test.each([[undefined], [null], ['text'], [{}], [{ ok: false }]])(
    'HTTP 400 with body %p is ambiguous',
    (body) => {
      expect(
        classifyEnviaCancelResponse(TRACKING, {
          kind: 'response',
          status: 400,
          body,
        }),
      ).toEqual({ outcome: 'ambiguous' });
    },
  );

  test.each([500, 503])('HTTP %i is ambiguous', (status) => {
    expect(
      classifyEnviaCancelResponse(TRACKING, {
        kind: 'response',
        status,
        body: { meta: 'error' },
      }),
    ).toEqual({ outcome: 'ambiguous' });
  });

  test('a transport failure is ambiguous', () => {
    expect(
      classifyEnviaCancelResponse(TRACKING, { kind: 'transport_failure' }),
    ).toEqual({ outcome: 'ambiguous' });
  });
});

type FetchCall = { url: string; init: RequestInit };

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const recorder = (
  respond: (call: FetchCall) => Promise<Response> | Response,
) => {
  const calls: FetchCall[] = [];
  const logs: unknown[][] = [];
  const deps: EnviaCarrierRequestDependencies = {
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const call = { url: String(url), init: init ?? {} };
      calls.push(call);
      return await respond(call);
    }) as typeof fetch,
    timeoutMs: 50,
    log: (...args: unknown[]) => {
      logs.push(args);
    },
  };
  return { calls, logs, deps };
};

const hangUntilAborted = (call: FetchCall) =>
  new Promise<Response>((_, reject) => {
    call.init.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });

const cancelResponse = (data: unknown) => ({
  kind: 'response' as const,
  status: 200,
  body: { meta: 'cancel', data },
});

describe('classifyEnviaCancelResponse with data as an array', () => {
  const entry = {
    trackingNumber: TRACKING,
    balanceReturned: true,
    balanceReturnDate: '2025-10-01 12:31:00',
  };

  test('accepts the only element and reads balance fields from it', () => {
    const result = classifyEnviaCancelResponse(
      TRACKING,
      cancelResponse([entry]),
    );
    expect(result).toEqual({
      outcome: 'accepted',
      balanceReturned: true,
      balanceReturnedAt: new Date('2025-10-01 12:31:00').toISOString(),
    });
    expect(
      (result as { balanceReturnedAt: string }).balanceReturnedAt,
    ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('accepts a numeric tracking number equal to the requested one', () => {
    expect(
      classifyEnviaCancelResponse(
        TRACKING,
        cancelResponse([{ ...entry, trackingNumber: Number(TRACKING) }]),
      ),
    ).toMatchObject({ outcome: 'accepted', balanceReturned: true });
  });

  test('compares tracking numbers trimmed', () => {
    expect(
      classifyEnviaCancelResponse(
        ' 123 ',
        cancelResponse([{ ...entry, trackingNumber: '123' }]),
      ),
    ).toMatchObject({ outcome: 'accepted' });
  });

  test('accepts an object data with a numeric tracking number', () => {
    expect(
      classifyEnviaCancelResponse(
        TRACKING,
        cancelResponse({ ...entry, trackingNumber: Number(TRACKING) }),
      ),
    ).toMatchObject({ outcome: 'accepted' });
  });

  test.each([
    ['two entries', [entry, entry]],
    ['an empty array', []],
    ['another tracking number', [{ ...entry, trackingNumber: 'OTHER' }]],
    ['a non-object entry', ['x']],
    ['a null entry', [null]],
    ['a nested array entry', [[entry]]],
    ['a missing tracking number', [{ balanceReturned: true }]],
    ['a boolean tracking number', [{ ...entry, trackingNumber: true }]],
  ])('%s is ambiguous', (_name, data) => {
    expect(
      classifyEnviaCancelResponse(TRACKING, cancelResponse(data)),
    ).toEqual({ outcome: 'ambiguous' });
  });
});

const SECRET_TRACKING = 'SECRET-TRACK-991';
const SECRET_DATE = '2031-02-03 04:05:06';

const shapeOf = async (respond: () => Promise<Response> | Response) => {
  const { logs, deps } = recorder(respond);
  await requestEnviaLabelCancellation(
    config,
    { carrier: 'fedex', trackingNumber: SECRET_TRACKING },
    deps,
  );
  const meta = logs[0][2] as Record<string, unknown>;
  return { meta, shape: meta.shape as Record<string, unknown> };
};

describe('cancel classification shape fingerprint', () => {
  test('describes an object data entry', async () => {
    const { shape } = await shapeOf(() =>
      jsonResponse(200, {
        meta: 'cancel',
        data: {
          trackingNumber: SECRET_TRACKING,
          balanceReturned: true,
          balanceReturnDate: SECRET_DATE,
        },
      }),
    );
    expect(shape).toEqual({
      topLevelKeys: ['data', 'meta'],
      dataType: 'object',
      entryKeys: ['balanceReturnDate', 'balanceReturned', 'trackingNumber'],
      trackingNumberType: 'string',
      balanceReturnedType: 'boolean',
      balanceReturnDateType: 'string',
      trackingNumberMatched: true,
    });
  });

  test('describes an array data entry with a numeric tracking number', async () => {
    const { shape } = await shapeOf(() =>
      jsonResponse(200, {
        meta: 'cancel',
        data: [{ trackingNumber: 5, balanceReturned: 'yes' }],
      }),
    );
    expect(shape).toEqual({
      topLevelKeys: ['data', 'meta'],
      dataType: 'array',
      dataLength: 1,
      entryKeys: ['balanceReturned', 'trackingNumber'],
      trackingNumberType: 'number',
      balanceReturnedType: 'string',
      balanceReturnDateType: 'undefined',
      trackingNumberMatched: false,
    });
  });

  test('describes a two-entry array without entry keys', async () => {
    const { shape } = await shapeOf(() =>
      jsonResponse(200, { meta: 'cancel', data: [{ a: 1 }, { b: 2 }] }),
    );
    expect(shape).toMatchObject({
      dataType: 'array',
      dataLength: 2,
      trackingNumberMatched: false,
    });
    expect(shape).not.toHaveProperty('entryKeys');
  });

  test.each([
    ['transport failure', () => Promise.reject(new Error('down'))],
    [
      'error body',
      () =>
        jsonResponse(422, {
          meta: 'error',
          error: { code: 7, message: 'LEAK-MESSAGE' },
          trackingNumber: SECRET_TRACKING,
        }),
    ],
    [
      'accepted body',
      () =>
        jsonResponse(200, {
          meta: 'cancel',
          data: [
            {
              trackingNumber: SECRET_TRACKING,
              balanceReturned: true,
              balanceReturnDate: SECRET_DATE,
            },
          ],
        }),
    ],
    [
      'string data',
      () => jsonResponse(200, { meta: 'cancel', data: SECRET_DATE }),
    ],
  ])('never logs a body value for a %s', async (_name, respond) => {
    const { meta, shape } = await shapeOf(respond);
    expect(shape).toBeDefined();
    const serialized = JSON.stringify(meta);
    for (const leaked of [
      SECRET_TRACKING,
      SECRET_DATE,
      '2031',
      'LEAK-MESSAGE',
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  test('a transport failure has an empty fingerprint', async () => {
    const { shape } = await shapeOf(() => Promise.reject(new Error('down')));
    expect(shape).toMatchObject({
      topLevelKeys: [],
      dataType: 'undefined',
      trackingNumberMatched: false,
    });
  });
});

describe('requestEnviaLabelCancellation', () => {
  const input = { carrier: 'fedex', trackingNumber: TRACKING };

  test('posts carrier and trackingNumber with the bearer key', async () => {
    const { calls, deps } = recorder(() => jsonResponse(200, accepted().body));
    const result = await requestEnviaLabelCancellation(config, input, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api-test.envia.com/ship/cancel/');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      carrier: 'fedex',
      trackingNumber: TRACKING,
    });
    expect(result).toEqual({
      outcome: 'accepted',
      balanceReturned: false,
      balanceReturnedAt: null,
    });
  });

  test('joins the URL without duplicate slashes', async () => {
    const { calls, deps } = recorder(() => jsonResponse(200, accepted().body));
    await requestEnviaLabelCancellation(
      { ...config, apiUrl: 'https://api-test.envia.com/' },
      input,
      deps,
    );
    expect(calls[0].url).toBe('https://api-test.envia.com/ship/cancel/');
  });

  test('classifies a refusal', async () => {
    const { deps } = recorder(() =>
      jsonResponse(422, { meta: 'error', error: { code: 7 } }),
    );
    expect(await requestEnviaLabelCancellation(config, input, deps)).toEqual({
      outcome: 'refused',
      errorCode: '7',
    });
  });

  test('a thrown fetch is ambiguous', async () => {
    const { deps } = recorder(() => {
      throw new Error('network down');
    });
    expect(await requestEnviaLabelCancellation(config, input, deps)).toEqual({
      outcome: 'ambiguous',
    });
  });

  test('a timeout aborts the request and is ambiguous', async () => {
    const { deps } = recorder(hangUntilAborted);
    expect(await requestEnviaLabelCancellation(config, input, deps)).toEqual({
      outcome: 'ambiguous',
    });
  });

  test('unparsable JSON on 2xx is ambiguous', async () => {
    const { deps } = recorder(() => new Response('<html>', { status: 200 }));
    expect(await requestEnviaLabelCancellation(config, input, deps)).toEqual({
      outcome: 'ambiguous',
    });
  });

  test('a 401 with an unparsable body is unavailable', async () => {
    const { deps } = recorder(() => new Response('nope', { status: 401 }));
    expect(await requestEnviaLabelCancellation(config, input, deps)).toEqual({
      outcome: 'unavailable',
    });
  });

  test('a null config is unavailable and never calls fetch', async () => {
    const { calls, deps } = recorder(() => jsonResponse(200, {}));
    expect(await requestEnviaLabelCancellation(null, input, deps)).toEqual({
      outcome: 'unavailable',
    });
    expect(calls).toHaveLength(0);
  });

  test('never returns or logs the key or the raw body', async () => {
    const { logs, deps } = recorder(() =>
      jsonResponse(422, {
        meta: 'error',
        error: { code: 7, message: 'RAW-PROVIDER-TEXT' },
      }),
    );
    const result = await requestEnviaLabelCancellation(config, input, deps);
    const serialized = JSON.stringify([result, logs]);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('RAW-PROVIDER-TEXT');
    expect(serialized).not.toContain('Bearer');
  });
});

const trackingBody = (data: unknown) => ({ meta: 'track', data });

describe('fetchFreshTracking', () => {
  test('posts the tracking number and assesses the observations', async () => {
    const { calls, deps } = recorder(() =>
      jsonResponse(
        200,
        trackingBody([
          { trackingNumber: TRACKING, status: 'Created' },
          { trackingNumber: TRACKING, status: 'Information' },
        ]),
      ),
    );
    const result = await fetchFreshTracking(config, TRACKING, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api-test.envia.com/ship/generaltrack/');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      trackingNumbers: [TRACKING],
    });
    expect(result.state).toBe('unscanned');
    expect(result.observations).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  test('reads history entries', async () => {
    const { deps } = recorder(() =>
      jsonResponse(
        200,
        trackingBody([
          {
            trackingNumber: TRACKING,
            history: [{ status: 'Created' }, { status: 'Shipped' }],
          },
        ]),
      ),
    );
    expect((await fetchFreshTracking(config, TRACKING, deps)).state).toBe(
      'scanned',
    );
  });

  test.each([
    ['non-2xx', () => jsonResponse(500, trackingBody([]))],
    ['error meta', () => jsonResponse(200, { meta: 'error', data: [] })],
    ['data not an array', () => jsonResponse(200, trackingBody({}))],
    [
      'entry without status',
      () => jsonResponse(200, trackingBody([{ trackingNumber: TRACKING }])),
    ],
    ['unparsable body', () => new Response('<html>', { status: 200 })],
    [
      'thrown fetch',
      () => {
        throw new Error('network down');
      },
    ],
  ])('%s yields unknown', async (_name, respond) => {
    const { deps } = recorder(respond);
    expect(await fetchFreshTracking(config, TRACKING, deps)).toEqual({
      state: 'unknown',
      observations: [],
    });
  });

  test('a timeout yields unknown', async () => {
    const { deps } = recorder(hangUntilAborted);
    expect(await fetchFreshTracking(config, TRACKING, deps)).toEqual({
      state: 'unknown',
      observations: [],
    });
  });

  test('a null config yields unavailable without calling fetch', async () => {
    const { calls, deps } = recorder(() => jsonResponse(200, {}));
    expect(await fetchFreshTracking(null, TRACKING, deps)).toEqual({
      state: 'unavailable',
      observations: [],
    });
    expect(calls).toHaveLength(0);
  });

  test.each([401, 403, 429])(
    'HTTP %i yields unavailable (retry next run, no review)',
    async (status) => {
      const { deps } = recorder(() =>
        jsonResponse(status, { meta: 'error', error: { code: 1 } }),
      );
      expect(await fetchFreshTracking(config, TRACKING, deps)).toEqual({
        state: 'unavailable',
        observations: [],
      });
    },
  );
});
