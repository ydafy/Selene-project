import { describe, expect, it } from 'bun:test';

import {
  ApiError,
  AUTO_COMPLETION_DELAY_MS,
  MAX_AUTO_COMPLETION_BATCH_SIZE,
  buildAutoCompletionRpcInput,
  mapAutoCompletionRpcResult,
  resolveAutoCompletionPlan,
  summarizeAutoCompletionResults,
  validateAutoCompletionRequest,
} from './complete-delivered-shipments';

const now = Date.parse('2026-09-04T12:00:00.000Z');
const cronSecret = 'scheduler-secret';

const shipment = (id: string, deliveredAt: string | null) => ({
  id,
  status: 'delivered',
  delivered_at: deliveredAt,
  buyer_confirmed_at: null,
});

const dueShipment = shipment('shipment-due', '2026-09-02T12:00:00.000Z');

describe('resolveAutoCompletionPlan', () => {
  it('rejects an invalid cron secret before returning due shipment work', () => {
    expect(() =>
      resolveAutoCompletionPlan({
        method: 'POST',
        suppliedCronSecret: 'invalid-secret',
        expectedCronSecret: cronSecret,
        now,
        candidates: [dueShipment],
      }),
    ).toThrow(new ApiError(401, 'CRON_UNAUTHORIZED'));
  });

  it('rejects non-POST requests and missing server configuration', () => {
    expect(() =>
      resolveAutoCompletionPlan({
        method: 'GET',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: cronSecret,
        now,
        candidates: [dueShipment],
      }),
    ).toThrow(new ApiError(400, 'INVALID_REQUEST'));

    expect(() =>
      resolveAutoCompletionPlan({
        method: 'POST',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: '',
        now,
        candidates: [dueShipment],
      }),
    ).toThrow(new ApiError(500, 'INTERNAL_ERROR'));
  });

  it('limits a due batch to the configured maximum while preserving source order', () => {
    const candidates = Array.from({ length: MAX_AUTO_COMPLETION_BATCH_SIZE + 1 }, (_, index) =>
      shipment(`shipment-${index}`, '2026-09-02T12:00:00.000Z'),
    );

    expect(
      resolveAutoCompletionPlan({
        method: 'POST',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: cronSecret,
        now,
        candidates,
      }).shipmentIds,
    ).toEqual(candidates.slice(0, MAX_AUTO_COMPLETION_BATCH_SIZE).map(({ id }) => id));
  });

  it('includes shipments at the 48-hour boundary and excludes early, confirmed, or non-delivered rows', () => {
    expect(
      resolveAutoCompletionPlan({
        method: 'POST',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: cronSecret,
        now,
        candidates: [
          shipment('at-boundary', new Date(now - AUTO_COMPLETION_DELAY_MS).toISOString()),
          shipment('one-millisecond-early', new Date(now - AUTO_COMPLETION_DELAY_MS + 1).toISOString()),
          { ...dueShipment, id: 'buyer-confirmed', buyer_confirmed_at: '2026-09-03T00:00:00.000Z' },
          { ...dueShipment, id: 'not-delivered', status: 'shipped' },
          { ...dueShipment, id: 'without-timestamp', delivered_at: null },
        ],
      }).shipmentIds,
    ).toEqual(['at-boundary']);
  });
});

describe('auto completion RPC contracts', () => {
  it('uses a deterministic auto key and maps a retry to idempotent success', () => {
    expect(buildAutoCompletionRpcInput('shipment-due')).toEqual({
      p_shipment_id: 'shipment-due',
      p_source: 'auto',
      p_actor_id: null,
      p_idempotency_key: 'auto_completion_shipment-due',
    });

    expect(
      mapAutoCompletionRpcResult(
        {
          success: true,
          error: null,
          completion_source: 'auto',
          idempotent: true,
        },
        'shipment-due',
      ),
    ).toEqual({
      shipmentId: 'shipment-due',
      completionSource: 'auto',
      idempotent: true,
    });
  });

  it('accepts a buyer winner in a concurrent race as idempotent completion', () => {
    expect(
      mapAutoCompletionRpcResult(
        {
          success: true,
          error: null,
          completion_source: 'buyer',
          idempotent: true,
        },
        'shipment-due',
      ),
    ).toEqual({
      shipmentId: 'shipment-due',
      completionSource: 'buyer',
      idempotent: true,
    });
  });

  it('fails closed for malformed canonical results', () => {
    expect(() => mapAutoCompletionRpcResult(null, 'shipment-due')).toThrow(
      new ApiError(500, 'INTERNAL_ERROR'),
    );
  });
});

describe('scheduler endpoint contract', () => {
  it('validates the cron secret before the endpoint can query shipments', async () => {
    expect(() =>
      validateAutoCompletionRequest({
        method: 'POST',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: cronSecret,
      }),
    ).not.toThrow();

    const source = await Bun.file(
      new URL('./index.ts', import.meta.url),
    ).text();
    const validationIndex = source.indexOf('validateAutoCompletionRequest({');
    expect(validationIndex).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("from('shipments')")).toBeGreaterThan(
      validationIndex,
    );
  });

  it('reports partial failures for retry without losing successful or idempotent completion counts', () => {
    expect(
      summarizeAutoCompletionResults([
        { completionSource: 'auto', idempotent: false, shipmentId: 'new-completion' },
        null,
        { completionSource: 'buyer', idempotent: true, shipmentId: 'buyer-race' },
      ]),
    ).toEqual({
      success: false,
      attempted: 3,
      completed: 1,
      idempotent: 1,
      failed: 1,
    });
  });
});
