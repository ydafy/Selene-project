import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ApiError,
  AUTO_COMPLETION_DELAY_MS,
  MAX_AUTO_COMPLETION_BATCH_SIZE,
  buildAutoCompletionRpcInput,
  isActiveDisputeRefusal,
  isCancellationOperationActiveRefusal,
  isNotConnectRefusal,
  mapAutoCompletionRpcResult,
  resolveAutoCompletionPlan,
  summarizeAutoCompletionResults,
  validateAutoCompletionRequest,
} from './complete-delivered-shipments';

// Prettier may re-wrap the source files read below; compare without layout.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/ \./g, '.');

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
    const candidates = Array.from(
      { length: MAX_AUTO_COMPLETION_BATCH_SIZE + 1 },
      (_, index) => shipment(`shipment-${index}`, '2026-09-02T12:00:00.000Z'),
    );

    expect(
      resolveAutoCompletionPlan({
        method: 'POST',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: cronSecret,
        now,
        candidates,
      }).shipmentIds,
    ).toEqual(
      candidates.slice(0, MAX_AUTO_COMPLETION_BATCH_SIZE).map(({ id }) => id),
    );
  });

  it('includes shipments at the 48-hour boundary and excludes early, confirmed, or non-delivered rows', () => {
    expect(
      resolveAutoCompletionPlan({
        method: 'POST',
        suppliedCronSecret: cronSecret,
        expectedCronSecret: cronSecret,
        now,
        candidates: [
          shipment(
            'at-boundary',
            new Date(now - AUTO_COMPLETION_DELAY_MS).toISOString(),
          ),
          shipment(
            'one-millisecond-early',
            new Date(now - AUTO_COMPLETION_DELAY_MS + 1).toISOString(),
          ),
          {
            ...dueShipment,
            id: 'buyer-confirmed',
            buyer_confirmed_at: '2026-09-03T00:00:00.000Z',
          },
          { ...dueShipment, id: 'not-delivered', status: 'shipped' },
          { ...dueShipment, id: 'without-timestamp', delivered_at: null },
        ],
      }).shipmentIds,
    ).toEqual(['at-boundary']);
  });
});

describe('shipments with an active dispute', () => {
  it('leaves shipments with an active dispute out of the plan so they never block the batch', () => {
    const disputed = shipment('shipment-disputed', '2026-09-01T00:00:00.000Z');
    const plan = resolveAutoCompletionPlan({
      method: 'POST',
      suppliedCronSecret: cronSecret,
      expectedCronSecret: cronSecret,
      now,
      candidates: [disputed, dueShipment],
      activeDisputeShipmentIds: ['shipment-disputed'],
    });
    expect(plan.shipmentIds).toEqual(['shipment-due']);
  });

  it('recognizes the active-dispute refusal and nothing else as an expected skip', () => {
    const refusal = {
      success: false,
      error: 'SHIPMENT_HAS_ACTIVE_DISPUTE',
      completion_source: null,
      idempotent: false,
    };
    expect(isActiveDisputeRefusal(refusal)).toBe(true);
    expect(
      isActiveDisputeRefusal({
        ...refusal,
        error: 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
      }),
    ).toBe(false);
    expect(
      isActiveDisputeRefusal({ ...refusal, success: true, error: null }),
    ).toBe(false);
    expect(isActiveDisputeRefusal(null)).toBe(false);
  });

  it('recognizes the non-Connect refusal and nothing else as an expected skip', () => {
    const refusal = {
      success: false,
      error: 'SHIPMENT_NOT_CONNECT',
      completion_source: null,
      idempotent: false,
    };
    expect(isNotConnectRefusal(refusal)).toBe(true);
    expect(
      isNotConnectRefusal({ ...refusal, error: 'SHIPMENT_HAS_ACTIVE_DISPUTE' }),
    ).toBe(false);
    expect(
      isNotConnectRefusal({ ...refusal, success: true, error: null }),
    ).toBe(false);
    expect(isNotConnectRefusal(null)).toBe(false);
    expect(isActiveDisputeRefusal(refusal)).toBe(false);
  });

  it('recognizes the cancellation-in-progress refusal and nothing else as an expected skip', () => {
    const refusal = {
      success: false,
      error: 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
      completion_source: null,
      idempotent: false,
    };
    expect(isCancellationOperationActiveRefusal(refusal)).toBe(true);
    expect(
      isCancellationOperationActiveRefusal({
        ...refusal,
        error: 'SHIPMENT_NOT_CONNECT',
      }),
    ).toBe(false);
    expect(
      isCancellationOperationActiveRefusal({
        ...refusal,
        success: true,
        error: null,
      }),
    ).toBe(false);
    expect(isCancellationOperationActiveRefusal(null)).toBe(false);
    expect(isNotConnectRefusal(refusal)).toBe(false);
    expect(isActiveDisputeRefusal(refusal)).toBe(false);
  });

  it('counts a skipped shipment without failing the batch', () => {
    expect(
      summarizeAutoCompletionResults([
        {
          completionSource: 'auto',
          idempotent: false,
          shipmentId: 'new-completion',
        },
        'skipped',
      ]),
    ).toEqual({
      success: true,
      attempted: 2,
      completed: 1,
      idempotent: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it('reads the active disputes before the shipments and excludes them in the query', async () => {
    const source = compact(
      await Bun.file(new URL('./index.ts', import.meta.url)).text(),
    );
    const disputesIndex = source.indexOf(compact(".from('disputes')"));
    expect(disputesIndex).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(compact(".from('shipments')"))).toBeGreaterThan(
      disputesIndex,
    );
    expect(source).toContain(
      compact(".not('status', 'in', '(resolved,rejected)')"),
    );
    expect(source).toContain(compact(".not('id', 'in',"));
  });

  it('only reads shipments paid through Stripe Connect so legacy rows never starve the batch', async () => {
    const source = await Bun.file(
      new URL('./index.ts', import.meta.url),
    ).text();
    expect(source).toContain(".not('stripe_payment_intent_id', 'is', null)");
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

  it('fails a coded RPC refusal with its own code, and unexpected error text as INTERNAL_ERROR', () => {
    for (const code of [
      'COMPLETION_AUDIT_MISSING',
      'SHIPMENT_NOT_FOUND',
      'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
    ]) {
      expect(() =>
        mapAutoCompletionRpcResult(
          {
            success: false,
            error: code,
            completion_source: null,
            idempotent: false,
          },
          'shipment-due',
        ),
      ).toThrow(new ApiError(500, code));
    }
    expect(() =>
      mapAutoCompletionRpcResult(
        {
          success: false,
          error: 'permission denied for table x',
          completion_source: null,
          idempotent: false,
        },
        'shipment-due',
      ),
    ).toThrow(new ApiError(500, 'INTERNAL_ERROR'));
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
        {
          completionSource: 'auto',
          idempotent: false,
          shipmentId: 'new-completion',
        },
        null,
        {
          completionSource: 'buyer',
          idempotent: true,
          shipmentId: 'buyer-race',
        },
      ]),
    ).toEqual({
      success: false,
      attempted: 3,
      completed: 1,
      idempotent: 1,
      skipped: 0,
      failed: 1,
    });
  });
});

describe('complete-delivered-shipments wiring', () => {
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('skips a shipment whose cancellation refund started, logs a WARN and keeps processing', () => {
    expect(index).toContain('isCancellationOperationActiveRefusal(row)');
    expect(index).toContain("code: 'SKIPPED_CANCELLATION_OPERATION_ACTIVE'");
    expect(index).toMatch(/'WARN',\s*'Delivered shipment completion skipped'/);
    expect(index).toContain("level: 'INFO' | 'WARN' | 'ERROR'");
  });
});
