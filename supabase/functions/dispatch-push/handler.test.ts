import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CronMismatchReporter } from '../_shared/cron-auth.ts';
import {
  CLAIM_SIZE,
  MAX_BATCHES,
  PURGE_LIMIT,
  RECEIPT_LIMIT,
  createDispatchPushHandler,
  type ClaimedDelivery,
  type DispatchPushDeps,
} from './handler.ts';

const SECRET = 'cron-secret-value';
const EXPO_TOKEN = 'expo-access-token-value';
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

const delivery = (
  n: number,
  overrides: Partial<ClaimedDelivery> = {},
): ClaimedDelivery => ({
  delivery_id: `d-${n}`,
  claim_token: `c-${n}`,
  expo_token: `ExponentPushToken[secret-${n}]`,
  platform: 'android',
  channel: 'orders',
  title: `Secret title ${n}`,
  message: `Secret body ${n}`,
  action_path: `/orders/${n}`,
  notification_id: `n-${n}`,
  event_kind: 'order_paid',
  ...overrides,
});

const batch = (count: number, start = 1) =>
  Array.from({ length: count }, (_, index) => delivery(start + index));

const okTicket = (n: number) => ({ status: 'ok', id: `t-${n}` });
const errTicket = (code: string) => ({
  status: 'error',
  message: 'Provider text that must never be stored',
  details: { error: code },
});

type Json = Record<string, unknown>;
type DbError = { code?: string; message: string } | null;
type FetchCall = { url: string; init: RequestInit; body: unknown };
type FetchReply = Response | Error | undefined;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function harness(
  overrides: {
    secret?: string | undefined;
    expoToken?: string | undefined;
    claims?: (ClaimedDelivery[] | null)[];
    claimError?: DbError;
    /** Per send request, in order; default answers with an ok ticket per message. */
    sendReplies?: FetchReply[];
    receiptsDue?: { delivery_id: string; ticket_id: string }[];
    receiptsDueError?: DbError;
    receiptsReply?: FetchReply;
    recordResultsError?: DbError;
    recordResultsThrows?: boolean;
    recordReceiptsError?: DbError;
    purgeError?: DbError;
    purgeCount?: number;
    reporter?: CronMismatchReporter;
  } = {},
) {
  const claimCalls: number[] = [];
  const fetchCalls: FetchCall[] = [];
  const resultCalls: Json[][] = [];
  const dueCalls: number[] = [];
  const receiptRecords: Json[][] = [];
  const purgeCalls: number[] = [];
  const events: string[] = [];
  const logs: { level: string; msg: string; data?: Record<string, unknown> }[] =
    [];
  const reports: {
    message: string;
    options: { fingerprint: string[]; tags: Record<string, string> };
  }[] = [];
  let claimIndex = 0;
  let sendIndex = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? 'null'));
    fetchCalls.push({ url, init: init ?? {}, body });
    if (url === SEND_URL) events.push('send');
    let answer: FetchReply;
    if (url === SEND_URL) {
      answer = overrides.sendReplies?.[sendIndex];
      sendIndex += 1;
      if (answer === undefined) {
        answer = reply(200, {
          data: (body as unknown[]).map((_, i) =>
            okTicket(sendIndex * 1000 + i),
          ),
        });
      }
    } else {
      answer = overrides.receiptsReply ?? reply(200, { data: {} });
    }
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;

  const deps: DispatchPushDeps = {
    getCronSecret: () => ('secret' in overrides ? overrides.secret : SECRET),
    getExpoAccessToken: () =>
      'expoToken' in overrides ? overrides.expoToken : EXPO_TOKEN,
    fetch: fetchImpl,
    claimDeliveries: async (limit) => {
      claimCalls.push(limit);
      events.push('claim');
      const data = overrides.claims ? (overrides.claims[claimIndex] ?? []) : [];
      claimIndex += 1;
      return {
        data: overrides.claimError ? null : data,
        error: overrides.claimError ?? null,
      };
    },
    recordResults: async (results) => {
      resultCalls.push(results as Json[]);
      events.push('record');
      if (overrides.recordResultsThrows) throw new Error('boom');
      const sent = (results as Json[]).filter(
        (r) => r.outcome === 'sent',
      ).length;
      return {
        data: overrides.recordResultsError
          ? null
          : { sent, retry: 0, failed: 0, ignored: 0 },
        error: overrides.recordResultsError ?? null,
      };
    },
    listReceiptsDue: async (limit) => {
      dueCalls.push(limit);
      return {
        data: overrides.receiptsDue ?? [],
        error: overrides.receiptsDueError ?? null,
      };
    },
    recordReceipts: async (receipts) => {
      receiptRecords.push(receipts as Json[]);
      return {
        data: overrides.recordReceiptsError
          ? null
          : {
              ok: 1,
              error: 1,
              missing: 1,
              pending: 0,
              ignored: 0,
              tokens_disabled: 1,
            },
        error: overrides.recordReceiptsError ?? null,
      };
    },
    purgeDeliveries: async (limit) => {
      purgeCalls.push(limit);
      return {
        data: overrides.purgeError ? null : (overrides.purgeCount ?? 0),
        error: overrides.purgeError ?? null,
      };
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
    reportMessage:
      overrides.reporter ??
      ((message, options) => {
        reports.push({ message, options });
      }),
  };
  return {
    handler: createDispatchPushHandler(deps),
    claimCalls,
    fetchCalls,
    resultCalls,
    dueCalls,
    receiptRecords,
    purgeCalls,
    events,
    logs,
    reports,
  };
}

const call = (
  h: ReturnType<typeof harness>,
  init: { method?: string; secret?: string | null } = {},
) =>
  h.handler(
    new Request('http://localhost/functions/v1/dispatch-push', {
      method: init.method ?? 'POST',
      headers:
        init.secret === null ? {} : { 'x-cron-secret': init.secret ?? SECRET },
    }),
  );

const sendCalls = (h: ReturnType<typeof harness>) =>
  h.fetchCalls.filter((c) => c.url === SEND_URL);

const EMPTY_SUMMARY = {
  claimed: 0,
  sent: 0,
  retry: 0,
  failed: 0,
  ignored: 0,
  receipts: {
    checked: 0,
    ok: 0,
    error: 0,
    missing: 0,
    pending: 0,
    tokens_disabled: 0,
  },
  purged: 0,
};

describe('dispatch-push: authentication and configuration', () => {
  it('401 without the header, claiming and calling nothing', async () => {
    const h = harness({ claims: [batch(2)] });
    const response = await call(h, { secret: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(h.claimCalls).toEqual([]);
    expect(h.fetchCalls).toEqual([]);
    expect(h.purgeCalls).toEqual([]);
    expect(h.reports).toEqual([]);
  });

  it('401 with a wrong secret and reports the mismatch', async () => {
    const h = harness();
    const response = await call(h, { secret: 'nope' });
    expect(response.status).toBe(401);
    expect(h.claimCalls).toEqual([]);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]?.options.fingerprint).toEqual([
      'cron-secret-mismatch',
      'dispatch-push',
    ]);
  });

  it('401 when no CRON_SECRET is configured', async () => {
    const h = harness({ secret: undefined });
    expect((await call(h, { secret: '' })).status).toBe(401);
    expect(h.claimCalls).toEqual([]);
  });

  it('405 for a non-POST request after authentication', async () => {
    const h = harness();
    const response = await call(h, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.claimCalls).toEqual([]);
  });

  it('401 wins over 405 for an unauthenticated GET', async () => {
    const h = harness();
    expect((await call(h, { method: 'GET', secret: null })).status).toBe(401);
  });

  it('500 MISSING_SERVER_CONFIG without EXPO_ACCESS_TOKEN, before claiming anything', async () => {
    const h = harness({ expoToken: undefined, claims: [batch(2)] });
    const response = await call(h);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'MISSING_SERVER_CONFIG' });
    expect(h.claimCalls).toEqual([]);
    expect(h.fetchCalls).toEqual([]);
    expect(h.purgeCalls).toEqual([]);
  });

  it('uses the shared constant-time cron auth helper', () => {
    const source = readFileSync(join(import.meta.dir, 'handler.ts'), 'utf8');
    expect(source).toContain("from '../_shared/cron-auth.ts'");
  });
});

describe('dispatch-push: send phase', () => {
  it('claims 100, sends the exact Expo request and records the tickets by index', async () => {
    const rows = [
      delivery(1),
      delivery(2, { message: null, action_path: null, channel: 'activity' }),
    ];
    const h = harness({ claims: [rows] });
    const response = await call(h);

    expect(response.status).toBe(200);
    expect(h.claimCalls).toEqual([CLAIM_SIZE]);
    expect(CLAIM_SIZE).toBe(100);

    const sends = sendCalls(h);
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    expect(send.init.method).toBe('POST');
    const headers = new Headers(send.init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('accept-encoding')).toBe('gzip, deflate');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe(`Bearer ${EXPO_TOKEN}`);
    expect(send.init.signal).toBeInstanceOf(AbortSignal);
    expect(send.body).toEqual([
      {
        to: 'ExponentPushToken[secret-1]',
        title: 'Secret title 1',
        body: 'Secret body 1',
        data: {
          notification_id: 'n-1',
          action_path: '/orders/1',
          event_kind: 'order_paid',
        },
        channelId: 'orders',
        sound: 'default',
        priority: 'high',
        ttl: 21600,
      },
      {
        to: 'ExponentPushToken[secret-2]',
        title: 'Secret title 2',
        data: {
          notification_id: 'n-2',
          action_path: null,
          event_kind: 'order_paid',
        },
        channelId: 'activity',
        sound: 'default',
        priority: 'high',
        ttl: 21600,
      },
    ]);
    expect(Object.keys((send.body as Json[])[1]!)).not.toContain('body');

    expect(h.resultCalls).toEqual([
      [
        { id: 'd-1', claim_token: 'c-1', outcome: 'sent', ticket_id: 't-1000' },
        { id: 'd-2', claim_token: 'c-2', outcome: 'sent', ticket_id: 't-1001' },
      ],
    ]);
    expect(await response.json()).toEqual({
      ...EMPTY_SUMMARY,
      claimed: 2,
      sent: 2,
    });
  });

  it('maps ticket errors: DeviceNotRegistered dead, MessageTooBig failed, others retry', async () => {
    const h = harness({
      claims: [batch(5)],
      sendReplies: [
        reply(200, {
          data: [
            okTicket(1),
            errTicket('DeviceNotRegistered'),
            errTicket('MessageTooBig'),
            errTicket('MessageRateExceeded'),
            { status: 'error', message: 'no details' },
          ],
        }),
      ],
    });
    const response = await call(h);
    expect(h.resultCalls).toEqual([
      [
        { id: 'd-1', claim_token: 'c-1', outcome: 'sent', ticket_id: 't-1' },
        {
          id: 'd-2',
          claim_token: 'c-2',
          outcome: 'failed',
          error: 'DeviceNotRegistered',
          token_dead: true,
        },
        {
          id: 'd-3',
          claim_token: 'c-3',
          outcome: 'failed',
          error: 'MessageTooBig',
        },
        {
          id: 'd-4',
          claim_token: 'c-4',
          outcome: 'retry',
          error: 'MessageRateExceeded',
        },
        { id: 'd-5', claim_token: 'c-5', outcome: 'retry', error: 'error' },
      ],
    ]);
    expect(response.status).toBe(200);
    // The summary comes from the database counts.
    expect(await response.json()).toEqual({
      ...EMPTY_SUMMARY,
      claimed: 5,
      sent: 1,
    });
    expect(h.reports).toEqual([]);
  });

  it.each(['InvalidCredentials', 'MismatchSenderId'])(
    'retries a %s ticket and reports it to Sentry once per run',
    async (code) => {
      const h = harness({
        claims: [batch(2)],
        sendReplies: [reply(200, { data: [errTicket(code), errTicket(code)] })],
      });
      await call(h);
      expect(h.resultCalls[0]?.map((r) => r.outcome)).toEqual([
        'retry',
        'retry',
      ]);
      expect(h.resultCalls[0]?.map((r) => r.error)).toEqual([code, code]);
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]?.options.fingerprint).toEqual([
        'dispatch-push-credentials',
        code,
      ]);
      expect(h.reports[0]?.options.tags).toEqual({
        edge_function: 'dispatch-push',
        code,
      });
    },
  );

  const wholeFailure = (
    name: string,
    answer: FetchReply,
    error: string,
    reported = false,
  ) =>
    it(`${name}: every row retries with ${error}${reported ? ' and Sentry hears about it' : ''}`, async () => {
      const h = harness({ claims: [batch(2)], sendReplies: [answer] });
      const response = await call(h);
      expect(response.status).toBe(200);
      expect(h.resultCalls).toEqual([
        [
          { id: 'd-1', claim_token: 'c-1', outcome: 'retry', error },
          { id: 'd-2', claim_token: 'c-2', outcome: 'retry', error },
        ],
      ]);
      expect(h.reports).toHaveLength(reported ? 1 : 0);
      if (reported) {
        expect(h.reports[0]?.options.fingerprint).toEqual([
          'dispatch-push-credentials',
          error,
        ]);
      }
    });

  wholeFailure(
    'HTTP 429',
    reply(429, { errors: [{ code: 'TOO_MANY_REQUESTS', message: 'x' }] }),
    'expo_http_429',
  );
  wholeFailure(
    'HTTP 500',
    new Response('upstream down', { status: 500 }),
    'expo_http_500',
  );
  wholeFailure(
    'HTTP 401',
    reply(401, { errors: [{ code: 'UNAUTHORIZED', message: 'x' }] }),
    'expo_http_401',
    true,
  );
  wholeFailure(
    'HTTP 403',
    new Response('', { status: 403 }),
    'expo_http_403',
    true,
  );
  wholeFailure(
    'errors body on 200',
    reply(200, {
      errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'x' }],
    }),
    'PUSH_TOO_MANY_EXPERIENCE_IDS',
  );
  wholeFailure(
    'UNAUTHORIZED errors body',
    reply(200, { errors: [{ code: 'UNAUTHORIZED', message: 'x' }] }),
    'UNAUTHORIZED',
    true,
  );
  wholeFailure('missing data', reply(200, {}), 'expo_bad_response');
  wholeFailure(
    'non-JSON body',
    new Response('<html>', { status: 200 }),
    'expo_bad_response',
  );
  wholeFailure(
    'ticket count mismatch',
    reply(200, { data: [okTicket(1)] }),
    'expo_ticket_mismatch',
  );
  wholeFailure('thrown fetch', new TypeError('network down'), 'expo_network');
  wholeFailure(
    'timeout',
    Object.assign(new Error('t'), { name: 'TimeoutError' }),
    'expo_timeout',
  );

  it('never stores or logs provider text, tokens, titles or bodies', async () => {
    const h = harness({
      claims: [batch(2)],
      sendReplies: [
        reply(200, { data: [errTicket('InvalidCredentials'), okTicket(2)] }),
      ],
      receiptsDue: [{ delivery_id: 'd-9', ticket_id: 't-9' }],
      receiptsReply: reply(200, {
        data: {
          't-9': {
            status: 'error',
            message: 'Provider text',
            details: { error: 'DeviceNotRegistered' },
          },
        },
      }),
    });
    await call(h);
    const everything = JSON.stringify({
      logs: h.logs,
      results: h.resultCalls,
      receipts: h.receiptRecords,
      reports: h.reports,
    });
    for (const secret of [
      'ExponentPushToken',
      'Secret title',
      'Secret body',
      'Provider text',
      EXPO_TOKEN,
      SECRET,
    ]) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe('dispatch-push: batch loop', () => {
  it('claims again after a full batch and stops at the first short one', async () => {
    const h = harness({ claims: [batch(100), batch(40, 101)] });
    const response = await call(h);
    expect(h.claimCalls).toEqual([100, 100]);
    expect(sendCalls(h).map((c) => (c.body as unknown[]).length)).toEqual([
      100, 40,
    ]);
    expect(h.resultCalls.map((r) => r.length)).toEqual([100, 40]);
    expect(((await response.json()) as Json).claimed).toBe(140);
  });

  it('stops at an empty claim without calling Expo', async () => {
    const h = harness({ claims: [[]] });
    const response = await call(h);
    expect(h.claimCalls).toEqual([100]);
    expect(sendCalls(h)).toEqual([]);
    expect(h.resultCalls).toEqual([]);
    expect(await response.json()).toEqual(EMPTY_SUMMARY);
  });

  it('runs at most 5 batches', async () => {
    expect(MAX_BATCHES).toBe(5);
    const h = harness({
      claims: Array.from({ length: 8 }, (_, i) => batch(100, i * 100 + 1)),
    });
    const response = await call(h);
    expect(h.claimCalls).toEqual([100, 100, 100, 100, 100]);
    expect(sendCalls(h)).toHaveLength(5);
    expect(((await response.json()) as Json).claimed).toBe(500);
  });

  it('sends each batch right after its claim, before the next claim', async () => {
    const h = harness({ claims: [batch(100), batch(1, 101)] });
    await call(h);
    expect(h.events.filter((e) => e !== 'record')).toEqual([
      'claim',
      'send',
      'claim',
      'send',
    ]);
  });

  it('a failed batch does not stop the next one', async () => {
    const h = harness({
      claims: [batch(100), batch(1, 101)],
      sendReplies: [reply(503, {}), undefined],
    });
    await call(h);
    expect(h.claimCalls).toEqual([100, 100]);
    expect(
      h.resultCalls[0]?.every(
        (r) => r.outcome === 'retry' && r.error === 'expo_http_503',
      ),
    ).toBe(true);
    expect(h.resultCalls[1]).toEqual([
      {
        id: 'd-101',
        claim_token: 'c-101',
        outcome: 'sent',
        ticket_id: 't-2000',
      },
    ]);
  });

  it('500 INTERNAL_ERROR when the claim fails, calling Expo for nothing', async () => {
    const h = harness({
      claimError: { code: '42501', message: 'permission denied for secret' },
    });
    const response = await call(h);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' });
    expect(h.fetchCalls).toEqual([]);
    expect(h.resultCalls).toEqual([]);
    expect(JSON.stringify(h.logs)).not.toContain('permission denied');
    expect(h.logs.some((l) => l.level === 'ERROR')).toBe(true);
  });

  it('keeps going when recording fails (database error)', async () => {
    const h = harness({
      claims: [batch(2)],
      recordResultsError: { code: '57014', message: 'timeout' },
    });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(h.resultCalls).toHaveLength(1);
    expect(h.purgeCalls).toEqual([PURGE_LIMIT]);
    expect(h.logs.some((l) => l.level === 'ERROR')).toBe(true);
    expect(((await response.json()) as Json).claimed).toBe(2);
  });

  it('keeps going when the record port throws', async () => {
    const h = harness({ claims: [batch(2)], recordResultsThrows: true });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(h.purgeCalls).toEqual([PURGE_LIMIT]);
  });
});

describe('dispatch-push: receipts phase', () => {
  const due = [
    { delivery_id: 'd-1', ticket_id: 't-1' },
    { delivery_id: 'd-2', ticket_id: 't-2' },
    { delivery_id: 'd-3', ticket_id: 't-3' },
    { delivery_id: 'd-4', ticket_id: 't-4' },
  ];

  it('asks for up to 1000 receipts, calls getReceipts and records ok/error/missing/token_dead', async () => {
    const h = harness({
      receiptsDue: due,
      receiptsReply: reply(200, {
        data: {
          't-1': { status: 'ok' },
          't-2': {
            status: 'error',
            message: 'x',
            details: { error: 'DeviceNotRegistered' },
          },
          't-3': { status: 'error', message: 'x' },
        },
      }),
    });
    const response = await call(h);

    expect(h.dueCalls).toEqual([RECEIPT_LIMIT]);
    expect(RECEIPT_LIMIT).toBe(1000);
    const receiptCall = h.fetchCalls.find((c) => c.url === RECEIPTS_URL)!;
    expect(receiptCall.body).toEqual({ ids: ['t-1', 't-2', 't-3', 't-4'] });
    const headers = new Headers(receiptCall.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${EXPO_TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(receiptCall.init.signal).toBeInstanceOf(AbortSignal);

    expect(h.receiptRecords).toEqual([
      [
        { id: 'd-1', receipt: 'ok' },
        {
          id: 'd-2',
          receipt: 'error',
          error: 'DeviceNotRegistered',
          token_dead: true,
        },
        { id: 'd-3', receipt: 'error', error: 'error' },
        { id: 'd-4', receipt: 'missing' },
      ],
    ]);
    expect(((await response.json()) as Json).receipts).toEqual({
      checked: 4,
      ok: 1,
      error: 1,
      missing: 1,
      pending: 0,
      tokens_disabled: 1,
    });
  });

  it('skips Expo and the record call when nothing is due', async () => {
    const h = harness();
    await call(h);
    expect(h.fetchCalls.filter((c) => c.url === RECEIPTS_URL)).toEqual([]);
    expect(h.receiptRecords).toEqual([]);
  });

  it.each([
    ['HTTP 500', reply(500, {})],
    ['thrown fetch', new TypeError('down')],
    ['errors body', reply(200, { errors: [{ code: 'X', message: 'x' }] })],
    ['missing data', reply(200, {})],
  ])(
    'does not record when getReceipts fails (%s), logs WARN and still purges',
    async (_name, answer) => {
      const h = harness({
        receiptsDue: due,
        receiptsReply: answer as FetchReply,
      });
      const response = await call(h);
      expect(response.status).toBe(200);
      expect(h.receiptRecords).toEqual([]);
      expect(h.logs.some((l) => l.level === 'WARN')).toBe(true);
      expect(h.purgeCalls).toEqual([PURGE_LIMIT]);
      expect(((await response.json()) as Json).receipts).toEqual(
        EMPTY_SUMMARY.receipts,
      );
    },
  );

  it('reports a credential receipt error to Sentry and a 401 getReceipts too', async () => {
    const h = harness({
      receiptsDue: due.slice(0, 1),
      receiptsReply: reply(200, {
        data: {
          't-1': {
            status: 'error',
            message: 'x',
            details: { error: 'InvalidCredentials' },
          },
        },
      }),
    });
    await call(h);
    expect(h.receiptRecords[0]).toEqual([
      { id: 'd-1', receipt: 'error', error: 'InvalidCredentials' },
    ]);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]?.options.fingerprint).toEqual([
      'dispatch-push-credentials',
      'InvalidCredentials',
    ]);

    const h2 = harness({ receiptsDue: due, receiptsReply: reply(401, {}) });
    await call(h2);
    expect(h2.receiptRecords).toEqual([]);
    expect(h2.reports[0]?.options.fingerprint).toEqual([
      'dispatch-push-credentials',
      'expo_http_401',
    ]);
  });

  it('a failing list or record does not fail the run', async () => {
    const h = harness({ receiptsDueError: { code: 'XX', message: 'm' } });
    expect((await call(h)).status).toBe(200);
    expect(h.purgeCalls).toEqual([PURGE_LIMIT]);

    const h2 = harness({
      receiptsDue: due,
      receiptsReply: reply(200, { data: { 't-1': { status: 'ok' } } }),
      recordReceiptsError: { code: 'XX', message: 'm' },
    });
    const response = await call(h2);
    expect(response.status).toBe(200);
    expect(h2.logs.some((l) => l.level === 'ERROR')).toBe(true);
    expect(h2.purgeCalls).toEqual([PURGE_LIMIT]);
  });
});

describe('dispatch-push: purge and summary', () => {
  it('purges up to 5000 rows and reports the count', async () => {
    const h = harness({ purgeCount: 7 });
    const response = await call(h);
    expect(h.purgeCalls).toEqual([5000]);
    expect(await response.json()).toEqual({ ...EMPTY_SUMMARY, purged: 7 });
  });

  it('tolerates a purge failure: 200, ERROR log, purged 0', async () => {
    const h = harness({ purgeError: { code: 'XX', message: 'm' } });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EMPTY_SUMMARY);
    expect(h.logs.some((l) => l.level === 'ERROR')).toBe(true);
  });

  it('logs one INFO line with the summary and no sensitive data', async () => {
    const h = harness({ claims: [batch(2)], purgeCount: 3 });
    await call(h);
    const info = h.logs.filter((l) => l.level === 'INFO');
    expect(info).toHaveLength(1);
    expect(info[0]?.data).toMatchObject({ claimed: 2, sent: 2, purged: 3 });
  });

  it('a failing Sentry reporter never changes the response', async () => {
    const h = harness({
      claims: [batch(1)],
      sendReplies: [reply(401, {})],
      reporter: () => {
        throw new Error('sentry down');
      },
    });
    expect((await call(h)).status).toBe(200);
    expect(h.resultCalls[0]?.[0]?.error).toBe('expo_http_401');
  });
});
