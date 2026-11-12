import { describe, expect, it } from 'bun:test';

import type { PollingTrackingEvent } from '../_shared/envia/envia-tracking-ingestion.ts';
import {
  createTrackShipmentsDependencies,
  type SupabaseAdminClient,
} from './dependencies.ts';

type Row = Record<string, unknown>;

const NOW = Date.parse('2026-08-29T11:00:00.000Z');
const MINUTE = 60 * 1_000;
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * MINUTE).toISOString();

const shipment = (
  id: string,
  status: string,
  lastTrackedAt: string | null,
  trackingNumber: string | null = `TRACK-${id}`,
): Row => ({
  id,
  status,
  tracking_number: trackingNumber,
  last_tracked_at: lastTrackedAt,
});

// An in-memory database that applies the PostgREST filters, ordering and limit the polling
// adapters use, so a test observes which shipments a lane selects instead of the query text.
function fakeDatabase(
  shipments: Row[] = [],
  rpcData: Record<string, unknown> = {},
) {
  const tables: Record<string, Row[]> = { shipments };
  const calls: Array<{ name: string; args: unknown }> = [];

  // Ascending order; Postgres puts nulls last unless nullsFirst is set.
  const compare = (left: unknown, right: unknown, nullsFirst: boolean) => {
    if (left === right) return 0;
    if (left === null) return nullsFirst ? -1 : 1;
    if (right === null) return nullsFirst ? 1 : -1;
    return String(left) < String(right) ? -1 : 1;
  };

  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const orderings: Array<{ column: string; nullsFirst: boolean }> = [];
    let limit = Number.POSITIVE_INFINITY;
    const result = () => {
      const sorted = [...rows].sort((left, right) => {
        for (const { column, nullsFirst } of orderings) {
          const order = compare(left[column], right[column], nullsFirst);
          if (order !== 0) return order;
        }
        return 0;
      });
      return { data: sorted.slice(0, limit), error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      not: (column: string, operator: string, value: unknown) => {
        if (operator !== 'is' || value !== null) {
          throw new Error(`fake database: unsupported not.${operator}`);
        }
        rows = rows.filter((row) => row[column] !== null);
        return chain;
      },
      or: (filter: string) => {
        const match =
          /^last_tracked_at\.is\.null,last_tracked_at\.lte\.(.+)$/.exec(filter);
        if (!match) throw new Error(`fake database: unsupported or ${filter}`);
        const dueAt = Date.parse(match[1] as string);
        rows = rows.filter(
          (row) =>
            row.last_tracked_at === null ||
            Date.parse(row.last_tracked_at as string) <= dueAt,
        );
        return chain;
      },
      order: (
        column: string,
        options: { ascending: boolean; nullsFirst?: boolean },
      ) => {
        if (!options.ascending) throw new Error('fake database: descending');
        orderings.push({ column, nullsFirst: options.nullsFirst ?? false });
        return chain;
      },
      limit: (count: number) => {
        limit = count;
        return Promise.resolve(result());
      },
      update: (values: Row) => ({
        in: async (column: string, ids: string[]) => {
          calls.push({
            name: `update:${table}`,
            args: { values, column, ids },
          });
          return { error: null };
        },
      }),
    };
    return chain;
  };

  const client = {
    from: (table: string) => {
      calls.push({ name: `from:${table}`, args: null });
      return query(table);
    },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name: `rpc:${name}`, args });
      return { data: rpcData[name] ?? null, error: null };
    },
  };
  return { client: client as unknown as SupabaseAdminClient, calls };
}

const envFor =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

const adapters = (
  options: {
    database?: ReturnType<typeof fakeDatabase>;
    env?: Record<string, string>;
    fetch?: typeof fetch;
  } = {},
) =>
  createTrackShipmentsDependencies({
    createSupabaseAdmin: () => (options.database ?? fakeDatabase()).client,
    getEnv: envFor(
      options.env ?? { ENVIA_MODE: 'sandbox', ENVIA_API_KEY_SANDBOX: 'key-s' },
    ),
    fetch:
      options.fetch ??
      ((() => {
        throw new Error('unexpected fetch');
      }) as unknown as typeof fetch),
    now: () => NOW,
  });

const signal = () => new AbortController().signal;

describe('track-shipments target selection', () => {
  it('selects preparing shipments not tracked in the last five minutes', async () => {
    const database = fakeDatabase([
      shipment('p-due', 'preparing', minutesAgo(5)),
      shipment('p-fresh', 'preparing', minutesAgo(4)),
      shipment('p-never', 'preparing', null),
      shipment('p-no-tracking', 'preparing', null, null),
      shipment('s-due', 'shipped', minutesAgo(60)),
    ]);

    const targets = await adapters({ database }).selectTargets(
      'preparing',
      signal(),
    );

    expect(targets).toEqual([
      { id: 'p-never', trackingNumber: 'TRACK-p-never' },
      { id: 'p-due', trackingNumber: 'TRACK-p-due' },
    ]);
  });

  it('selects shipped shipments not tracked in the last fifteen minutes', async () => {
    const database = fakeDatabase([
      shipment('s-due', 'shipped', minutesAgo(15)),
      shipment('s-fresh', 'shipped', minutesAgo(14)),
      shipment('p-due', 'preparing', minutesAgo(60)),
    ]);

    const targets = await adapters({ database }).selectTargets(
      'shipped',
      signal(),
    );

    expect(targets).toEqual([{ id: 's-due', trackingNumber: 'TRACK-s-due' }]);
  });

  it('orders never-tracked shipments first, then the oldest, ties by id, and caps the batch at fifty', async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      shipment(
        `s-${String(index).padStart(2, '0')}`,
        'shipped',
        minutesAgo(100 - Math.floor(index / 2)),
      ),
    );
    rows.push(shipment('s-zz-never', 'shipped', null));
    const database = fakeDatabase(rows.reverse());

    const targets = await adapters({ database }).selectTargets(
      'shipped',
      signal(),
    );

    expect(targets).toHaveLength(50);
    expect(targets.slice(0, 4).map((target) => target.id)).toEqual([
      's-zz-never',
      's-00',
      's-01',
      's-02',
    ]);
    expect(targets.at(-1)?.id).toBe('s-48');
  });

  it('leaves shipments without a tracking number out of the batch', async () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      shipment(`s-untracked-${index}`, 'shipped', null, null),
    );
    rows.push(shipment('s-due', 'shipped', minutesAgo(30)));
    const database = fakeDatabase(rows);

    const targets = await adapters({ database }).selectTargets(
      'shipped',
      signal(),
    );

    expect(targets).toEqual([{ id: 's-due', trackingNumber: 'TRACK-s-due' }]);
  });

  it('stops before querying when the deadline already passed', async () => {
    const database = fakeDatabase([shipment('p-due', 'preparing', null)]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapters({ database }).selectTargets('preparing', controller.signal),
    ).rejects.toThrow('TRACKING_DEADLINE_EXCEEDED');
    expect(database.calls).toEqual([]);
  });
});

describe('track-shipments Envia polling', () => {
  const enviaResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  const recordingFetch = (response: () => Response) => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFake = (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return response();
    }) as unknown as typeof fetch;
    return { fetchFake, requests };
  };

  it.each([
    [
      'sandbox',
      { ENVIA_MODE: 'sandbox', ENVIA_API_KEY_SANDBOX: 'key-s' },
      'https://api-test.envia.com/ship/generaltrack/',
      'Bearer key-s',
    ],
    [
      'production',
      { ENVIA_MODE: 'production', ENVIA_API_KEY_PROD: 'key-p' },
      'https://api.envia.com/ship/generaltrack/',
      'Bearer key-p',
    ],
  ])(
    'asks the %s Envia API for the tracking numbers and returns its observations',
    async (_mode, env, url, authorization) => {
      const { fetchFake, requests } = recordingFetch(() =>
        enviaResponse({
          meta: 'generaltrack',
          data: [{ trackingNumber: 'TRACK-1', status: 'Delivered' }],
        }),
      );

      const observations = await adapters({
        env,
        fetch: fetchFake,
      }).fetchObservations(['TRACK-1'], signal());

      expect(observations).toEqual([
        expect.objectContaining({
          trackingNumber: 'TRACK-1',
          status: 'Delivered',
        }),
      ]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(url);
      expect(requests[0]?.init?.method).toBe('POST');
      expect(new Headers(requests[0]?.init?.headers).get('Authorization')).toBe(
        authorization,
      );
      expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
        trackingNumbers: ['TRACK-1'],
      });
    },
  );

  it('fails without calling Envia when the key for the active mode is missing', async () => {
    const { fetchFake, requests } = recordingFetch(() => enviaResponse({}));

    await expect(
      adapters({
        env: { ENVIA_MODE: 'production', ENVIA_API_KEY_SANDBOX: 'key-s' },
        fetch: fetchFake,
      }).fetchObservations(['TRACK-1'], signal()),
    ).rejects.toThrow('MISSING_ENVIA_API_KEY');
    expect(requests).toEqual([]);
  });

  it.each([
    ['an HTTP error', () => enviaResponse({ data: [] }, 500)],
    ['an error meta', () => enviaResponse({ meta: 'error', data: [] })],
    ['a body without a data list', () => enviaResponse({ data: {} })],
  ])('rejects %s as a failed request', async (_case, response) => {
    const { fetchFake } = recordingFetch(response);

    await expect(
      adapters({ fetch: fetchFake }).fetchObservations(['TRACK-1'], signal()),
    ).rejects.toThrow('ENVIA_TRACKING_REQUEST_FAILED');
  });

  it.each([
    ['an entry without a status', { trackingNumber: 'TRACK-1' }],
    ['a blank status', { trackingNumber: 'TRACK-1', status: '  ' }],
    [
      'a history entry without a status',
      { trackingNumber: 'TRACK-1', history: [{ date: '2026-08-29' }] },
    ],
    ['an entry that is not an object', 'TRACK-1'],
  ])('rejects the whole response when it holds %s', async (_case, entry) => {
    const { fetchFake } = recordingFetch(() =>
      enviaResponse({
        data: [{ trackingNumber: 'TRACK-2', status: 'Delivered' }, entry],
      }),
    );

    await expect(
      adapters({ fetch: fetchFake }).fetchObservations(
        ['TRACK-1', 'TRACK-2'],
        signal(),
      ),
    ).rejects.toThrow('ENVIA_TRACKING_INVALID_RESPONSE');
  });
});

describe('track-shipments persistence', () => {
  const event: PollingTrackingEvent = {
    targetId: 'shipment-1',
    trackingNumber: 'TRACK-1',
    rawStatus: 'Delivered',
    eventType: 'delivered',
    transition: 'delivered',
    eventAt: '2026-08-29T10:00:00.000Z',
    statusDescription: 'Entregado',
    location: 'CDMX',
    carrierName: 'Paquetexpress',
  };

  it('records each event through fn_record_tracking_event with the polling run id', async () => {
    const database = fakeDatabase([], {
      fn_record_tracking_event: { inserted: true },
    });

    const result = await adapters({ database }).record(
      event,
      'run-1',
      signal(),
    );

    expect(result).toEqual({ inserted: true });
    expect(database.calls).toEqual([
      {
        name: 'rpc:fn_record_tracking_event',
        args: {
          p_shipment_id: 'shipment-1',
          p_dispute_id: null,
          p_event_type: 'delivered',
          p_event_at: '2026-08-29T10:00:00.000Z',
          p_raw_status: 'Delivered',
          p_location: 'CDMX',
          p_status_description: 'Entregado',
          p_carrier_name: 'Paquetexpress',
          p_webhook_delivery_id: null,
          p_polling_run_id: 'run-1',
          p_transition: 'delivered',
        },
      },
    ]);
  });

  it('reports a duplicate event as not inserted', async () => {
    const database = fakeDatabase([], {
      fn_record_tracking_event: { inserted: false },
    });

    expect(
      await adapters({ database }).record(event, 'run-1', signal()),
    ).toEqual({ inserted: false });
  });

  it('marks tracked shipments by writing only last_tracked_at', async () => {
    const database = fakeDatabase();

    await adapters({ database }).markTracked(
      ['shipment-1', 'shipment-2'],
      '2026-08-29T11:00:00.000Z',
      signal(),
    );

    expect(database.calls).toEqual([
      { name: 'from:shipments', args: null },
      {
        name: 'update:shipments',
        args: {
          values: { last_tracked_at: '2026-08-29T11:00:00.000Z' },
          column: 'id',
          ids: ['shipment-1', 'shipment-2'],
        },
      },
    ]);
  });

  it('acquires and releases the lane lease through the cron lease RPCs', async () => {
    const database = fakeDatabase([], {
      fn_acquire_cron_lease: [{ acquired: true, lease_id: 'lease-1' }],
    });
    const dependencies = adapters({ database });

    expect(await dependencies.acquireLease('shipped')).toEqual({
      acquired: true,
      leaseId: 'lease-1',
    });
    await dependencies.releaseLease('shipped', 'lease-1');

    expect(database.calls).toEqual([
      {
        name: 'rpc:fn_acquire_cron_lease',
        args: { p_job: 'track_shipments_shipped' },
      },
      {
        name: 'rpc:fn_release_cron_lease',
        args: { p_job: 'track_shipments_shipped', p_lease_id: 'lease-1' },
      },
    ]);
  });
});
