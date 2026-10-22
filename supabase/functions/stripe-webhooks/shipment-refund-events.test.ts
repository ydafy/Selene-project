import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  handleShipmentRefundEvent,
  type ShipmentRefundEventPorts,
} from './shipment-refund-events.ts';

const SHIPMENT = '7b300000-0000-4000-8000-000000000011';

type Applied = {
  shipmentId: string;
  refundId: string;
  paymentIntentId: string;
  amountCents: number;
  status: string;
  failureReason: string | null;
};
type Reported = { message: string; data: Record<string, unknown> };

function refund(overrides: Record<string, unknown> = {}) {
  return {
    id: 're_1',
    object: 'refund',
    amount: 11000,
    payment_intent: 'pi_1',
    status: 'succeeded',
    failure_reason: null,
    metadata: { shipment_id: SHIPMENT },
    ...overrides,
  };
}

function event(object: unknown, type = 'refund.updated') {
  return { id: 'evt_1', type, data: { object } };
}

function harness(
  rpc: { data: unknown; error: { message: string } | null } = {
    data: { outcome: 'completed', refund_id: 're_1', refund_status: 'succeeded' },
    error: null,
  },
) {
  const applied: Applied[] = [];
  const reports: Reported[] = [];
  const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  const ports: ShipmentRefundEventPorts = {
    apply: async (input) => {
      applied.push(input);
      return rpc;
    },
    report: async (message, data) => {
      reports.push({ message, data });
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return { ports, applied, reports, logs };
}

describe('handleShipmentRefundEvent', () => {
  it('passes Stripe id, payment intent, amount, status and failure reason to the RPC', async () => {
    const h = harness();
    const result = await handleShipmentRefundEvent(
      event(refund({ status: 'failed', failure_reason: 'expired_or_canceled_card' })),
      h.ports,
    );
    expect(h.applied).toEqual([
      {
        shipmentId: SHIPMENT,
        refundId: 're_1',
        paymentIntentId: 'pi_1',
        amountCents: 11000,
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
      },
    ]);
    expect(result).toEqual({ handled: true, outcome: 'completed' });
  });

  it('handles refund.failed the same way as refund.updated', async () => {
    const h = harness();
    await handleShipmentRefundEvent(event(refund({ status: 'failed' }), 'refund.failed'), h.ports);
    expect(h.applied).toHaveLength(1);
  });

  it('takes the id of an expanded payment_intent object', async () => {
    const h = harness();
    await handleShipmentRefundEvent(event(refund({ payment_intent: { id: 'pi_expanded', object: 'payment_intent' } })), h.ports);
    expect(h.applied[0]?.paymentIntentId).toBe('pi_expanded');
  });

  it('ignores other event types without calling the RPC', async () => {
    const h = harness();
    const result = await handleShipmentRefundEvent(event(refund(), 'refund.created'), h.ports);
    expect(result).toEqual({ handled: false, reason: 'unsupported_event_type' });
    expect(h.applied).toHaveLength(0);
  });

  it('ignores refunds without a usable metadata.shipment_id', async () => {
    for (const metadata of [undefined, null, {}, { shipment_id: '' }, { shipment_id: '   ' }, { shipment_id: 42 }, { shipment_id: 'not-a-uuid' }]) {
      const h = harness();
      const result = await handleShipmentRefundEvent(event(refund({ metadata })), h.ports);
      expect(result.handled).toBe(false);
      expect(h.applied).toHaveLength(0);
      expect(h.reports).toHaveLength(0);
    }
  });

  it('ignores dispute refunds even when they carry the shipment id', async () => {
    const h = harness();
    const result = await handleShipmentRefundEvent(
      event(refund({ metadata: { shipment_id: SHIPMENT, dispute_id: 'dsp_1' } })),
      h.ports,
    );
    expect(result).toEqual({ handled: false, reason: 'dispute_refund' });
    expect(h.applied).toHaveLength(0);
  });

  it('does not throw for a malformed refund that is not ours (no shipment id)', async () => {
    const h = harness();
    const result = await handleShipmentRefundEvent(event({ id: 42, metadata: {} }), h.ports);
    expect(result.handled).toBe(false);
    expect(h.applied).toHaveLength(0);
  });

  it('throws a stable code for malformed id, amount, status or payment intent without calling the RPC', async () => {
    const bad: Array<Record<string, unknown>> = [
      { id: '' },
      { id: 42 },
      { amount: 110.5 },
      { amount: '11000' },
      { amount: 0 },
      { amount: -1 },
      { amount: Number.MAX_SAFE_INTEGER + 1 },
      { status: 'refunded' },
      { status: null },
      { payment_intent: null },
      { payment_intent: '' },
      { payment_intent: { id: 7 } },
    ];
    for (const override of bad) {
      const h = harness();
      await expect(handleShipmentRefundEvent(event(refund(override)), h.ports)).rejects.toThrow(
        'REFUND_EVENT_MALFORMED',
      );
      expect(h.applied).toHaveLength(0);
    }
  });

  it('ignores an event whose object is not an object at all', async () => {
    const h = harness();
    await expect(handleShipmentRefundEvent(event(null), h.ports)).resolves.toMatchObject({ handled: false });
    expect(h.applied).toHaveLength(0);
  });

  it('keeps the failure reason only when it is a string', async () => {
    const h = harness();
    await handleShipmentRefundEvent(event(refund({ status: 'failed', failure_reason: { x: 1 } })), h.ports);
    expect(h.applied[0]?.failureReason).toBeNull();
  });

  for (const outcome of ['failed_after_cancellation', 'failed_before_cancellation'] as const) {
    it(`sends exactly one CRITICAL for ${outcome} with the shipment, refund, amount owed, reason and outcome`, async () => {
      const h = harness({
        data: {
          outcome,
          refund_id: 're_1',
          refund_status: 'failed',
          refund_failure_reason: 'expired_or_canceled_card',
          amount_owed_cents: 11000,
        },
        error: null,
      });
      const result = await handleShipmentRefundEvent(
        event(refund({ status: 'failed', failure_reason: 'expired_or_canceled_card' }), 'refund.failed'),
        h.ports,
      );
      expect(result).toEqual({ handled: true, outcome });
      expect(h.reports).toEqual([
        {
          message: `SHIPMENT_REFUND_${outcome.toUpperCase()}`,
          data: {
            shipmentId: SHIPMENT,
            refundId: 're_1',
            amountOwedCents: 11000,
            failureReason: 'expired_or_canceled_card',
            outcome,
          },
        },
      ]);
    });
  }

  it('never reports on unchanged, completed, recorded or ignored outcomes', async () => {
    for (const outcome of ['unchanged', 'completed', 'recorded', 'ignored']) {
      const h = harness({ data: { outcome }, error: null });
      const result = await handleShipmentRefundEvent(event(refund()), h.ports);
      expect(result).toEqual({ handled: true, outcome });
      expect(h.reports).toHaveLength(0);
    }
  });

  it('maps an RPC error to a stable code, logs the raw message and never exposes it', async () => {
    const h = harness({ data: null, error: { message: 'REFUND_AMOUNT_MISMATCH secret detail' } });
    const failure = await handleShipmentRefundEvent(event(refund()), h.ports).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('REFUND_EVENT_RPC_FAILED');
    expect(h.logs.some((l) => JSON.stringify(l).includes('REFUND_AMOUNT_MISMATCH secret detail'))).toBe(true);
    expect(h.reports).toHaveLength(0);
  });

  it('throws a stable code when the RPC returns an unusable result', async () => {
    for (const data of [null, 'completed', { outcome: 'exploded' }, {}, []]) {
      const h = harness({ data, error: null });
      await expect(handleShipmentRefundEvent(event(refund()), h.ports)).rejects.toThrow(
        'REFUND_EVENT_RESULT_INVALID',
      );
      expect(h.reports).toHaveLength(0);
    }
  });

  it('still alerts the admin for a failure outcome whose amount owed is unusable (the alert must not be lost)', async () => {
    const h = harness({
      data: { outcome: 'failed_after_cancellation', amount_owed_cents: 'x' },
      error: null,
    });
    await handleShipmentRefundEvent(event(refund({ status: 'failed' })), h.ports);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]?.data.amountOwedCents).toBeNull();
  });
});

describe('stripe-webhooks wiring', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  it('routes refund.updated and refund.failed through the refund event handler and the service-only RPC', () => {
    expect(source).toContain("from './shipment-refund-events.ts'");
    expect(source).toContain("'refund.updated'");
    expect(source).toContain("'refund.failed'");
    expect(source).toContain('fn_apply_shipment_cancellation_refund_event');
    expect(source).toContain("createCancellationReporter('stripe-webhooks', log)");
  });
});
