import { describe, expect, it } from 'bun:test';
import {
  handleShipmentRefundEvent,
  type ShipmentRefundEventInput,
  type ShipmentRefundEventPorts,
} from './shipment-refund-events.ts';

const SHIPMENT_ID = '7b300000-0000-4000-8000-000000000011';

function refundEvent(
  overrides: Record<string, unknown> = {},
  metadata: unknown = { shipment_id: SHIPMENT_ID, order_id: 'order-1' },
  type = 'refund.updated',
) {
  return {
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 're_1',
        object: 'refund',
        payment_intent: 'pi_1',
        amount: 11000,
        status: 'succeeded',
        failure_reason: null,
        metadata,
        ...overrides,
      },
    },
  };
}

function fakePorts(
  result: unknown = { outcome: 'completed' },
  error: { message: string } | null = null,
) {
  const calls: ShipmentRefundEventInput[] = [];
  const reports: Array<[string, Record<string, unknown>]> = [];
  const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const ports: ShipmentRefundEventPorts = {
    apply: async (input) => {
      calls.push(input);
      return { data: result, error };
    },
    report: async (message, data) => {
      reports.push([message, data]);
    },
    log: (level, msg, data) => {
      logs.push([level, msg, data]);
    },
  };
  return { calls, reports, logs, ports };
}

describe('shipment refund events: verifier probes', () => {
  it('S3 ignores null, non-string, blank and non-UUID shipment ids without calling the RPC', async () => {
    for (const metadata of [null, { shipment_id: 123 }, { shipment_id: 'abc' }, { shipment_id: '' }, { shipment_id: '   ' }]) {
      const fake = fakePorts();
      expect(await handleShipmentRefundEvent(refundEvent({}, metadata), fake.ports)).toEqual({
        handled: false,
        reason: 'not_a_shipment_refund',
      });
      expect(fake.calls).toHaveLength(0);
    }
  });

  it('S3 accepts a padded uppercase UUID and passes it trimmed', async () => {
    const fake = fakePorts();
    const metadata = { shipment_id: `  ${SHIPMENT_ID.toUpperCase()} ` };
    expect(await handleShipmentRefundEvent(refundEvent({}, metadata), fake.ports)).toEqual({
      handled: true,
      outcome: 'completed',
    });
    expect(fake.calls[0].shipmentId).toBe(SHIPMENT_ID.toUpperCase());
  });

  it('S3 ignores any non-empty dispute_id, but not an empty string or null', async () => {
    for (const disputeId of ['dispute-1', ' ', 0, 5]) {
      const fake = fakePorts();
      const metadata = { shipment_id: SHIPMENT_ID, dispute_id: disputeId };
      expect(await handleShipmentRefundEvent(refundEvent({}, metadata), fake.ports)).toEqual({
        handled: false,
        reason: 'dispute_refund',
      });
      expect(fake.calls).toHaveLength(0);
    }
    for (const disputeId of ['', null]) {
      const fake = fakePorts();
      const metadata = { shipment_id: SHIPMENT_ID, dispute_id: disputeId };
      expect((await handleShipmentRefundEvent(refundEvent({}, metadata), fake.ports)).handled).toBe(true);
    }
  });

  it('S3 malformed amount, payment intent, status or id throws REFUND_EVENT_MALFORMED without calling the RPC', async () => {
    const malformed: Array<Record<string, unknown>> = [
      { amount: 0 },
      { amount: -1 },
      { amount: 1.5 },
      { amount: '11000' },
      { amount: Number.NaN },
      { payment_intent: null },
      { payment_intent: { id: '' } },
      { status: 'processing' },
      { status: null },
      { id: '' },
      { id: 5 },
    ];
    for (const overrides of malformed) {
      const fake = fakePorts();
      await expect(handleShipmentRefundEvent(refundEvent(overrides), fake.ports)).rejects.toThrow(
        /^REFUND_EVENT_MALFORMED$/,
      );
      expect(fake.calls).toHaveLength(0);
    }
  });

  it('S3 refund.failed with an expanded payment intent passes the exact Stripe fields', async () => {
    const fake = fakePorts({ outcome: 'unchanged' });
    const event = refundEvent(
      {
        payment_intent: { id: 'pi_expanded', object: 'payment_intent' },
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      },
      undefined,
      'refund.failed',
    );
    await handleShipmentRefundEvent(event, fake.ports);
    expect(fake.calls).toEqual([
      {
        shipmentId: SHIPMENT_ID,
        refundId: 're_1',
        paymentIntentId: 'pi_expanded',
        amountCents: 11000,
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
      },
    ]);
  });

  it('other refund-related event types are not handled', async () => {
    for (const type of ['refund.created', 'charge.refunded', 'charge.refund.updated']) {
      const fake = fakePorts();
      expect(await handleShipmentRefundEvent(refundEvent({}, undefined, type), fake.ports)).toEqual({
        handled: false,
        reason: 'unsupported_event_type',
      });
      expect(fake.calls).toHaveLength(0);
    }
  });

  it('an RPC error throws REFUND_EVENT_RPC_FAILED, keeps the raw message in the log only and never alerts', async () => {
    const fake = fakePorts(null, { message: 'CANCELLATION_COMPLETE_FAILED: raw detail' });
    let thrown = '';
    try {
      await handleShipmentRefundEvent(refundEvent(), fake.ports);
    } catch (error) {
      thrown = (error as Error).message;
    }
    expect(thrown).toBe('REFUND_EVENT_RPC_FAILED');
    expect(JSON.stringify(fake.logs)).toContain('CANCELLATION_COMPLETE_FAILED: raw detail');
    expect(fake.reports).toHaveLength(0);
  });

  it('S3/S6 sends exactly one CRITICAL per failure outcome with the frozen amount owed', async () => {
    for (const outcome of ['failed_after_cancellation', 'failed_before_cancellation']) {
      const fake = fakePorts({
        outcome,
        amount_owed_cents: 11000,
        refund_failure_reason: 'lost_or_stolen_card',
      });
      await handleShipmentRefundEvent(refundEvent({ status: 'failed' }), fake.ports);
      expect(fake.reports).toEqual([
        [
          `SHIPMENT_REFUND_${outcome.toUpperCase()}`,
          {
            shipmentId: SHIPMENT_ID,
            refundId: 're_1',
            amountOwedCents: 11000,
            failureReason: 'lost_or_stolen_card',
            outcome,
          },
        ],
      ]);
    }
  });

  it('never alerts on ignored, completed, unchanged or recorded outcomes', async () => {
    for (const outcome of ['ignored', 'completed', 'unchanged', 'recorded']) {
      const fake = fakePorts({ outcome });
      await handleShipmentRefundEvent(refundEvent(), fake.ports);
      expect(fake.reports).toHaveLength(0);
    }
  });

  it('an unusable RPC result throws REFUND_EVENT_RESULT_INVALID', async () => {
    for (const result of [null, [], 'completed', { outcome: 'FAILED' }, { outcome: 1 }]) {
      const fake = fakePorts(result);
      await expect(handleShipmentRefundEvent(refundEvent(), fake.ports)).rejects.toThrow(
        /^REFUND_EVENT_RESULT_INVALID$/,
      );
    }
  });
});
