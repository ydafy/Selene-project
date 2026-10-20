import { describe, expect, it } from 'bun:test';

import {
  createTrackShipmentsHandler,
  type TrackShipmentsDependencies,
} from './handler.ts';

const CRON_SECRET = 'cron-secret';

const request = (body: unknown, authorization = `Bearer ${CRON_SECRET}`) =>
  new Request('https://example.test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify(body),
  });

const createDependencies = (): TrackShipmentsDependencies & {
  calls: string[];
} => {
  const calls: string[] = [];
  return {
    calls,
    acquireLease: async (lane) => {
      calls.push(`acquire:${lane}`);
      return { acquired: true, leaseId: 'lease-1' };
    },
    releaseLease: async (lane, leaseId) => {
      calls.push(`release:${lane}:${leaseId}`);
    },
    selectTargets: async (status) => {
      calls.push(`select:${status}`);
      return [
        { id: 'shipment-1', trackingNumber: 'TRACK-1' },
        { id: 'shipment-2', trackingNumber: 'TRACK-1' },
      ];
    },
    fetchObservations: async (trackingNumbers) => {
      calls.push(`fetch:${trackingNumbers.join(',')}`);
      return [
        {
          trackingNumber: 'TRACK-1',
          status: 'Picked Up',
          eventAt: '2026-08-29T10:00:00.000Z',
        },
      ];
    },
    record: async (event) => {
      calls.push(`record:${event.targetId}:${event.eventAt}`);
      return { inserted: true };
    },
    markTracked: async (targetIds, trackedAt) => {
      calls.push(`tracked:${targetIds.join(',')}:${trackedAt}`);
    },
  };
};

const handler = (
  dependencies: TrackShipmentsDependencies,
  options: {
    pollingEnabled?: string | undefined;
    secret?: string | undefined;
    signal?: AbortSignal;
  } = {},
) =>
  createTrackShipmentsHandler({
    secret: 'secret' in options ? options.secret : CRON_SECRET,
    pollingEnabled: options.pollingEnabled ?? 'true',
    dependencies,
    now: () => new Date('2026-08-29T11:00:00.000Z'),
    createDeadline: () => ({
      signal: options.signal ?? new AbortController().signal,
      dispose: () => undefined,
    }),
  });

describe('track shipments cron handler', () => {
  it('rejects missing, malformed, mismatched, and blank-configured Bearer credentials before side effects', async () => {
    for (const authorization of ['', 'Basic cron-secret', 'Bearer wrong-secret']) {
      const dependencies = createDependencies();
      const response = await handler(dependencies)(
        request({ lane: 'preparing' }, authorization),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
      expect(dependencies.calls).toEqual([]);
    }

    const dependencies = createDependencies();
    const response = await handler(dependencies, { secret: '' })(
      request({ lane: 'preparing' }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(dependencies.calls).toEqual([]);
  });

  it('rejects a missing or unsupported lane before selecting targets or calling Envia', async () => {
    for (const body of [{}, { lane: 'delivered' }]) {
      const dependencies = createDependencies();
      const response = await handler(dependencies)(request(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'INVALID_LANE' });
      expect(dependencies.calls).toEqual([]);
    }
  });

  it('returns a side-effect-free disabled skip for either lane', async () => {
    for (const lane of ['preparing', 'shipped'] as const) {
      const dependencies = createDependencies();
      const response = await handler(dependencies, { pollingEnabled: 'false' })(
        request({ lane }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        processed: 0,
        recorded: 0,
        lane,
        skipped: true,
        reason: 'disabled',
      });
      expect(dependencies.calls).toEqual([]);
    }
  });

  it('returns a busy skip without target or Envia work when the same lane lease is held', async () => {
    const dependencies = createDependencies();
    dependencies.acquireLease = async (lane) => {
      dependencies.calls.push(`acquire:${lane}`);
      return { acquired: false };
    };

    const response = await handler(dependencies)(request({ lane: 'preparing' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 0,
      recorded: 0,
      lane: 'preparing',
      skipped: true,
      reason: 'busy',
    });
    expect(dependencies.calls).toEqual(['acquire:preparing']);
  });

  it('reconciles one preparing lane through a deduplicated Envia request and RPC persistence', async () => {
    const dependencies = createDependencies();
    const response = await handler(dependencies)(
      request({ lane: 'preparing' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 2,
      recorded: 2,
      lane: 'preparing',
    });
    expect(dependencies.calls).toEqual([
      'acquire:preparing',
      'select:preparing',
      'fetch:TRACK-1',
      'record:shipment-1:2026-08-29T10:00:00.000Z',
      'record:shipment-2:2026-08-29T10:00:00.000Z',
      'tracked:shipment-1,shipment-2:2026-08-29T11:00:00.000Z',
      'release:preparing:lease-1',
    ]);
  });

  it('advances every selected target after a successful response with no observations', async () => {
    const dependencies = createDependencies();
    dependencies.fetchObservations = async (trackingNumbers) => {
      dependencies.calls.push(`fetch:${trackingNumbers.join(',')}`);
      return [];
    };

    const response = await handler(dependencies)(
      request({ lane: 'preparing' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 2,
      recorded: 0,
      lane: 'preparing',
    });
    expect(dependencies.calls).toEqual([
      'acquire:preparing',
      'select:preparing',
      'fetch:TRACK-1',
      'tracked:shipment-1,shipment-2:2026-08-29T11:00:00.000Z',
      'release:preparing:lease-1',
    ]);
  });

  it('timestamps no-observation targets alongside targets whose events persist', async () => {
    const dependencies = createDependencies();
    dependencies.selectTargets = async (lane) => {
      dependencies.calls.push(`select:${lane}`);
      return [
        { id: 'shipment-with-event', trackingNumber: 'WITH-EVENT' },
        { id: 'shipment-no-history', trackingNumber: 'NO-HISTORY' },
      ];
    };
    dependencies.fetchObservations = async (trackingNumbers) => {
      dependencies.calls.push(`fetch:${trackingNumbers.join(',')}`);
      return [
        {
          trackingNumber: 'WITH-EVENT',
          status: 'Picked Up',
          eventAt: '2026-08-29T10:00:00.000Z',
        },
      ];
    };

    const response = await handler(dependencies)(
      request({ lane: 'shipped' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 2,
      recorded: 1,
      lane: 'shipped',
    });
    expect(dependencies.calls).toEqual([
      'acquire:shipped',
      'select:shipped',
      'fetch:WITH-EVENT,NO-HISTORY',
      'record:shipment-with-event:2026-08-29T10:00:00.000Z',
      'tracked:shipment-with-event,shipment-no-history:2026-08-29T11:00:00.000Z',
      'release:shipped:lease-1',
    ]);
  });

  it('caps a selected lane at fifty targets before making the provider request', async () => {
    const dependencies = createDependencies();
    dependencies.selectTargets = async (status) => {
      dependencies.calls.push(`select:${status}`);
      return Array.from({ length: 51 }, (_, index) => ({
        id: `shipment-${index}`,
        trackingNumber: `TRACK-${index}`,
      }));
    };
    dependencies.fetchObservations = async (trackingNumbers) => {
      dependencies.calls.push(`fetch:${trackingNumbers.join(',')}`);
      return [
        {
          trackingNumber: 'TRACK-0',
          status: 'Picked Up',
          eventAt: '2026-08-29T10:00:00.000Z',
        },
      ];
    };

    const response = await handler(dependencies)(
      request({ lane: 'preparing' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 50,
      recorded: 1,
      lane: 'preparing',
    });
    expect(dependencies.calls).toContain(
      `fetch:${Array.from({ length: 50 }, (_, index) => `TRACK-${index}`).join(',')}`,
    );
    expect(
      dependencies.calls.some((call) => call.includes('TRACK-50')),
    ).toBeFalse();
  });

  it('keeps invalid or partially persisted observations eligible for retry while another shipped target is timestamped', async () => {
    const dependencies = createDependencies();
    dependencies.selectTargets = async (status) => {
      dependencies.calls.push(`select:${status}`);
      return [
        { id: 'shipment-good', trackingNumber: 'GOOD' },
        { id: 'shipment-invalid', trackingNumber: 'INVALID' },
        { id: 'shipment-rpc-failure', trackingNumber: 'PARTIAL' },
      ];
    };
    dependencies.fetchObservations = async (trackingNumbers) => {
      dependencies.calls.push(`fetch:${trackingNumbers.join(',')}`);
      return [
        {
          trackingNumber: 'GOOD',
          status: 'Delivered',
          eventAt: '2026-08-29T09:00:00.000Z',
        },
        {
          trackingNumber: 'PARTIAL',
          status: 'Picked Up',
          eventAt: '2026-08-29T09:01:00.000Z',
        },
        {
          trackingNumber: 'INVALID',
          status: '',
          eventAt: '2026-08-29T09:02:00.000Z',
        },
      ];
    };
    dependencies.record = async (event) => {
      dependencies.calls.push(`record:${event.targetId}:${event.eventAt}`);
      if (event.targetId === 'shipment-rpc-failure')
        throw new Error('RPC_FAILED');
      return { inserted: event.targetId === 'shipment-good' };
    };

    const response = await handler(dependencies)(
      request({ lane: 'shipped' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed: 3,
      recorded: 1,
      lane: 'shipped',
    });
    expect(dependencies.calls).toContain('select:shipped');
    expect(dependencies.calls).toContain('fetch:GOOD,INVALID,PARTIAL');
    expect(dependencies.calls).toContain(
      'tracked:shipment-good:2026-08-29T11:00:00.000Z',
    );
    expect(
      dependencies.calls.some((call) => call.includes('shipment-invalid')),
    ).toBeFalse();
    expect(
      dependencies.calls.some((call) =>
        call.startsWith('tracked:shipment-rpc-failure'),
      ),
    ).toBeFalse();
  });

  it('releases an acquired lease when the 90-second deadline stops later work', async () => {
    const dependencies = createDependencies();
    const controller = new AbortController();
    dependencies.selectTargets = async (lane) => {
      dependencies.calls.push(`select:${lane}`);
      controller.abort();
      return [{ id: 'shipment-1', trackingNumber: 'TRACK-1' }];
    };

    const response = await handler(dependencies, { signal: controller.signal })(
      request({ lane: 'preparing' }),
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: 'TRACKING_DEADLINE_EXCEEDED',
    });
    expect(dependencies.calls).toEqual([
      'acquire:preparing',
      'select:preparing',
      'release:preparing:lease-1',
    ]);
  });

  it('does not treat a deadline-aborted provider request as a successful no-observation response', async () => {
    const dependencies = createDependencies();
    const controller = new AbortController();
    dependencies.fetchObservations = async (trackingNumbers) => {
      dependencies.calls.push(`fetch:${trackingNumbers.join(',')}`);
      controller.abort();
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    };

    const response = await handler(dependencies, { signal: controller.signal })(
      request({ lane: 'preparing' }),
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: 'TRACKING_DEADLINE_EXCEEDED',
    });
    expect(dependencies.calls).toEqual([
      'acquire:preparing',
      'select:preparing',
      'fetch:TRACK-1',
      'release:preparing:lease-1',
    ]);
  });

  it('preserves the primary failure when best-effort lease release fails', async () => {
    const dependencies = createDependencies();
    dependencies.fetchObservations = async () => {
      dependencies.calls.push('fetch:TRACK-1');
      throw new Error('ENVIA_TRACKING_REQUEST_FAILED');
    };
    dependencies.releaseLease = async (lane, leaseId) => {
      dependencies.calls.push(`release:${lane}:${leaseId}`);
      throw new Error('LEASE_RELEASE_FAILED');
    };

    const response = await handler(dependencies)(request({ lane: 'shipped' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'ENVIA_TRACKING_REQUEST_FAILED',
    });
    expect(dependencies.calls).toEqual([
      'acquire:shipped',
      'select:shipped',
      'fetch:TRACK-1',
      'release:shipped:lease-1',
    ]);
  });
});
