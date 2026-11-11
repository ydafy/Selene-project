import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { MAX_AUTO_COMPLETION_BATCH_SIZE } from './complete-delivered-shipments.ts';
import {
  createCompleteDeliveredShipmentsHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type RpcRow = {
  success: boolean;
  error: string | null;
  completion_source: string | null;
  idempotent: boolean;
};

const NOW = Date.parse('2026-09-04T12:00:00.000Z');
const HOUR = 60 * 60 * 1_000;
const CRON_SECRET = 'scheduler-secret';

const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

const shipmentRow = (id: string, overrides: Row = {}): Row => ({
  id,
  status: 'delivered',
  delivered_at: hoursAgo(72),
  buyer_confirmed_at: null,
  stripe_payment_intent_id: `pi_${id}`,
  ...overrides,
});

// An in-memory database that applies the PostgREST filters the handler uses, so a test
// observes which shipments reach fn_confirm_shipment_delivery instead of the query text.
// fn_confirm_shipment_delivery completes a delivered shipment once and answers a retry
// as idempotent; `refusals` makes it refuse a shipment with the given error code.
function fakeDatabase(input: {
  shipments: Row[];
  disputes?: Row[];
  refusals?: Record<string, string>;
  failingTable?: string;
}) {
  const tables: Record<string, Row[]> = {
    shipments: input.shipments,
    disputes: input.disputes ?? [],
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let columns: string[] = [];
    const chain = {
      select: (selection: string) => {
        columns = selection.split(',').map((column) => column.trim());
        return chain;
      },
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      is: (column: string, value: null) => {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      lte: (column: string, value: string) => {
        rows = rows.filter(
          (row) =>
            typeof row[column] === 'string' &&
            Date.parse(row[column] as string) <= Date.parse(value),
        );
        return chain;
      },
      not: (column: string, operator: string, value: unknown) => {
        if (operator === 'is') {
          rows = rows.filter((row) => row[column] !== value);
        } else if (operator === 'in') {
          const list = String(value).slice(1, -1).split(',');
          rows = rows.filter((row) => !list.includes(String(row[column])));
        } else {
          throw new Error(`fake database: unsupported not.${operator}`);
        }
        return chain;
      },
      order: (column: string, options: { ascending: boolean }) => {
        rows.sort(
          (a, b) =>
            String(a[column]).localeCompare(String(b[column])) *
            (options.ascending ? 1 : -1),
        );
        return chain;
      },
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return chain;
      },
      then: (
        resolve: (value: { data: Row[] | null; error: unknown }) => void,
      ) =>
        resolve(
          table === input.failingTable
            ? { data: null, error: { message: 'boom' } }
            : {
                data: rows.map((row) =>
                  Object.fromEntries(columns.map((c) => [c, row[c]])),
                ),
                error: null,
              },
        ),
    };
    return chain;
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const shipment = tables.shipments.find(
      (row) => row.id === args.p_shipment_id,
    );
    const refusal = input.refusals?.[String(args.p_shipment_id)];
    let row: RpcRow;
    if (refusal) {
      row = {
        success: false,
        error: refusal,
        completion_source: null,
        idempotent: false,
      };
    } else if (shipment?.status === 'completed') {
      row = {
        success: true,
        error: null,
        completion_source: 'auto',
        idempotent: true,
      };
    } else {
      if (shipment) shipment.status = 'completed';
      row = {
        success: true,
        error: null,
        completion_source: 'auto',
        idempotent: false,
      };
    }
    return { data: [row], error: null };
  };

  let clientsCreated = 0;
  return {
    createSupabaseAdmin: () => {
      clientsCreated += 1;
      return { from: query, rpc } as unknown as SupabaseAdminClient;
    },
    rpcCalls,
    completedIds: () => rpcCalls.map(({ args }) => args.p_shipment_id),
    statusOf: (id: string) =>
      tables.shipments.find((row) => row.id === id)?.status,
    clientsCreated: () => clientsCreated,
  };
}

const cronRequest = (
  headers: Record<string, string> = { 'x-cron-secret': CRON_SECRET },
  method = 'POST',
) =>
  new Request('https://example.com/functions/v1/complete-delivered-shipments', {
    method,
    headers,
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

type Report = {
  message: string;
  options: { fingerprint: string[]; tags: Record<string, string> };
};
let reports: Report[] = [];

const handlerFor = (
  database: ReturnType<typeof fakeDatabase>,
  cronSecret: string | null = CRON_SECRET,
  reportMessage: (
    message: string,
    options: Report['options'],
  ) => void | Promise<void> = (message, options) => {
    reports.push({ message, options });
  },
) =>
  createCompleteDeliveredShipmentsHandler({
    cronSecret,
    createSupabaseAdmin: database.createSupabaseAdmin,
    reportMessage,
    now: () => NOW,
  });

let consoleLog: ReturnType<typeof spyOn>;
beforeEach(() => {
  consoleLog = spyOn(console, 'log').mockImplementation(() => undefined);
  reports = [];
});
afterEach(() => {
  consoleLog.mockRestore();
});

const logLines = () =>
  consoleLog.mock.calls.map(([line]) => JSON.parse(String(line)) as Row);

describe('complete-delivered-shipments handler: cron secret', () => {
  for (const [name, request, cronSecret, status, error] of [
    [
      'a wrong cron secret',
      cronRequest({ 'x-cron-secret': 'not-the-secret' }),
      CRON_SECRET,
      401,
      'CRON_UNAUTHORIZED',
    ],
    [
      'a missing cron secret',
      cronRequest({}),
      CRON_SECRET,
      401,
      'CRON_UNAUTHORIZED',
    ],
    [
      'a server without CRON_SECRET',
      cronRequest({ 'x-cron-secret': '' }),
      null,
      500,
      'INTERNAL_ERROR',
    ],
    [
      'a server with an empty CRON_SECRET',
      cronRequest({ 'x-cron-secret': '' }),
      '',
      500,
      'INTERNAL_ERROR',
    ],
    [
      'a GET request',
      cronRequest({ 'x-cron-secret': CRON_SECRET }, 'GET'),
      CRON_SECRET,
      400,
      'INVALID_REQUEST',
    ],
  ] as const) {
    it(`rejects ${name} before any database access`, async () => {
      const database = fakeDatabase({ shipments: [shipmentRow('due')] });

      const response = await handlerFor(database, cronSecret)(request);

      expect(response.status).toBe(status);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(await response.json()).toEqual({ success: false, error });
      expect(database.clientsCreated()).toBe(0);
      expect(database.rpcCalls).toEqual([]);
      expect(database.statusOf('due')).toBe('delivered');
      expect(logLines()).toEqual([
        {
          timestamp: expect.any(String),
          function: 'complete-delivered-shipments',
          level: 'ERROR',
          msg: 'Delivered shipment completion request failed',
          source: 'auto',
          result: 'failure',
          code: error,
        },
      ]);
    });
  }
});

describe('complete-delivered-shipments handler: cron secret mismatch reports', () => {
  it('reports a wrong cron secret once, without its value, and still answers 401', async () => {
    const database = fakeDatabase({ shipments: [shipmentRow('due')] });

    const response = await handlerFor(database)(
      cronRequest({ 'x-cron-secret': 'not-the-secret' }),
    );

    expect(response.status).toBe(401);
    expect(reports).toEqual([
      {
        message: 'complete-delivered-shipments cron secret mismatch',
        options: {
          fingerprint: ['cron-secret-mismatch', 'complete-delivered-shipments'],
          tags: { edge_function: 'complete-delivered-shipments' },
        },
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain('not-the-secret');
    expect(database.clientsCreated()).toBe(0);
  });

  it('does not report a request without the header, a GET, or a server without CRON_SECRET', async () => {
    for (const [request, cronSecret, status] of [
      [cronRequest({}), CRON_SECRET, 401],
      [cronRequest({ 'x-cron-secret': 'nope' }, 'GET'), CRON_SECRET, 400],
      [cronRequest({ 'x-cron-secret': 'nope' }), null, 500],
    ] as const) {
      const database = fakeDatabase({ shipments: [shipmentRow('due')] });

      const response = await handlerFor(database, cronSecret)(request);

      expect(response.status).toBe(status);
    }
    expect(reports).toEqual([]);
  });

  it('keeps the 401 when the reporter throws', async () => {
    const database = fakeDatabase({ shipments: [shipmentRow('due')] });

    const response = await handlerFor(database, CRON_SECRET, () => {
      throw new Error('sentry down');
    })(cronRequest({ 'x-cron-secret': 'not-the-secret' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      error: 'CRON_UNAUTHORIZED',
    });
  });
});

describe('complete-delivered-shipments handler: completion', () => {
  it('completes the due Connect shipments with a deterministic auto key and logs each one', async () => {
    const database = fakeDatabase({
      shipments: [
        shipmentRow('due-1', { delivered_at: hoursAgo(72) }),
        shipmentRow('due-2', { delivered_at: hoursAgo(48) }),
        shipmentRow('recent', { delivered_at: hoursAgo(1) }),
        shipmentRow('buyer-confirmed', { buyer_confirmed_at: hoursAgo(10) }),
        shipmentRow('shipped', { status: 'shipped' }),
      ],
    });

    const response = await handlerFor(database)(cronRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      attempted: 2,
      completed: 2,
      idempotent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(database.rpcCalls).toEqual([
      {
        name: 'fn_confirm_shipment_delivery',
        args: {
          p_shipment_id: 'due-1',
          p_source: 'auto',
          p_actor_id: null,
          p_idempotency_key: 'auto_completion_due-1',
        },
      },
      {
        name: 'fn_confirm_shipment_delivery',
        args: {
          p_shipment_id: 'due-2',
          p_source: 'auto',
          p_actor_id: null,
          p_idempotency_key: 'auto_completion_due-2',
        },
      },
    ]);
    expect(database.statusOf('recent')).toBe('delivered');
    expect(
      logLines().map(({ level, msg, shipmentId, code }) => ({
        level,
        msg,
        shipmentId,
        code,
      })),
    ).toEqual([
      {
        level: 'INFO',
        msg: 'Delivered shipment completion processed',
        shipmentId: 'due-1',
        code: 'COMPLETED',
      },
      {
        level: 'INFO',
        msg: 'Delivered shipment completion processed',
        shipmentId: 'due-2',
        code: 'COMPLETED',
      },
      {
        level: 'INFO',
        msg: 'Delivered shipment completion batch finished',
        shipmentId: undefined,
        code: 'BATCH_COMPLETED',
      },
    ]);
  });

  it('completes nothing new when it runs twice over the same state', async () => {
    const database = fakeDatabase({
      shipments: [shipmentRow('due-1'), shipmentRow('due-2')],
    });
    const handler = handlerFor(database);

    await handler(cronRequest());
    const second = await handler(cronRequest());

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      success: true,
      attempted: 0,
      completed: 0,
      idempotent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(database.completedIds()).toEqual(['due-1', 'due-2']);
  });

  it('never sends a shipment with an active dispute, even when disputed shipments would fill the batch', async () => {
    const disputed = Array.from(
      { length: MAX_AUTO_COMPLETION_BATCH_SIZE },
      (_, index) =>
        shipmentRow(`disputed-${String(index).padStart(3, '0')}`, {
          delivered_at: hoursAgo(200),
        }),
    );
    const database = fakeDatabase({
      shipments: [
        ...disputed,
        shipmentRow('resolved-dispute', { delivered_at: hoursAgo(100) }),
        shipmentRow('rejected-dispute', { delivered_at: hoursAgo(100) }),
        shipmentRow('undisputed', { delivered_at: hoursAgo(72) }),
      ],
      disputes: [
        ...disputed.map(({ id }) => ({ shipment_id: id, status: 'open' })),
        { shipment_id: 'resolved-dispute', status: 'resolved' },
        { shipment_id: 'rejected-dispute', status: 'rejected' },
        { shipment_id: null, status: 'open' },
      ],
    });

    const response = await handlerFor(database)(cronRequest());

    expect(response.status).toBe(200);
    expect(new Set(database.completedIds())).toEqual(
      new Set(['resolved-dispute', 'rejected-dispute', 'undisputed']),
    );
  });

  it('only takes shipments paid through Stripe Connect, so legacy rows never starve the batch', async () => {
    const legacy = Array.from(
      { length: MAX_AUTO_COMPLETION_BATCH_SIZE },
      (_, index) =>
        shipmentRow(`legacy-${String(index).padStart(3, '0')}`, {
          delivered_at: hoursAgo(200),
          stripe_payment_intent_id: null,
        }),
    );
    const database = fakeDatabase({
      shipments: [...legacy, shipmentRow('connect')],
      refusals: Object.fromEntries(
        legacy.map(({ id }) => [id, 'SHIPMENT_NOT_CONNECT']),
      ),
    });

    const response = await handlerFor(database)(cronRequest());

    expect(response.status).toBe(200);
    expect(database.completedIds()).toEqual(['connect']);
  });

  it('skips a shipment whose cancellation refund started with a WARN log and keeps processing', async () => {
    const database = fakeDatabase({
      shipments: [
        shipmentRow('cancelling', { delivered_at: hoursAgo(80) }),
        shipmentRow('due', { delivered_at: hoursAgo(72) }),
      ],
      refusals: { cancelling: 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE' },
    });

    const response = await handlerFor(database)(cronRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      attempted: 2,
      completed: 1,
      idempotent: 0,
      skipped: 1,
      failed: 0,
    });
    expect(database.statusOf('cancelling')).toBe('delivered');
    expect(database.statusOf('due')).toBe('completed');
    expect(logLines()[0]).toEqual({
      timestamp: expect.any(String),
      function: 'complete-delivered-shipments',
      level: 'WARN',
      msg: 'Delivered shipment completion skipped',
      source: 'auto',
      shipmentId: 'cancelling',
      result: 'success',
      code: 'SKIPPED_CANCELLATION_OPERATION_ACTIVE',
    });
  });

  it('skips the active-dispute and non-Connect refusals with an INFO log', async () => {
    const database = fakeDatabase({
      shipments: [
        shipmentRow('late-dispute', { delivered_at: hoursAgo(80) }),
        shipmentRow('not-connect', { delivered_at: hoursAgo(72) }),
      ],
      refusals: {
        'late-dispute': 'SHIPMENT_HAS_ACTIVE_DISPUTE',
        'not-connect': 'SHIPMENT_NOT_CONNECT',
      },
    });

    const response = await handlerFor(database)(cronRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toBe(2);
    expect(
      logLines()
        .slice(0, 2)
        .map(({ level, msg, code }) => ({ level, msg, code })),
    ).toEqual([
      {
        level: 'INFO',
        msg: 'Delivered shipment completion skipped',
        code: 'SKIPPED_ACTIVE_DISPUTE',
      },
      {
        level: 'INFO',
        msg: 'Delivered shipment completion skipped',
        code: 'SKIPPED_NOT_CONNECT',
      },
    ]);
  });

  it('answers 500 with the counts when one shipment fails, after processing the rest', async () => {
    const database = fakeDatabase({
      shipments: [
        shipmentRow('broken', { delivered_at: hoursAgo(80) }),
        shipmentRow('due', { delivered_at: hoursAgo(72) }),
      ],
      refusals: { broken: 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE' },
    });

    const response = await handlerFor(database)(cronRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      attempted: 2,
      completed: 1,
      idempotent: 0,
      skipped: 0,
      failed: 1,
    });
    expect(
      logLines().map(({ level, code, shipmentId }) => ({
        level,
        code,
        shipmentId,
      })),
    ).toEqual([
      {
        level: 'ERROR',
        code: 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
        shipmentId: 'broken',
      },
      { level: 'INFO', code: 'COMPLETED', shipmentId: 'due' },
      { level: 'ERROR', code: 'BATCH_PARTIAL_FAILURE', shipmentId: undefined },
    ]);
  });

  for (const table of ['disputes', 'shipments']) {
    it(`answers 500 INTERNAL_ERROR and completes nothing when reading ${table} fails`, async () => {
      const database = fakeDatabase({
        shipments: [shipmentRow('due')],
        failingTable: table,
      });

      const response = await handlerFor(database)(cronRequest());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        success: false,
        error: 'INTERNAL_ERROR',
      });
      expect(database.rpcCalls).toEqual([]);
    });
  }
});
