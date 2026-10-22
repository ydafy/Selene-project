import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveManualShipmentCancelPlan } from './cancel-order.ts';
import {
  runShipmentCancellation,
  type CancellationContext,
  type ShipmentCancellationPorts,
} from '../_shared/shipment-cancellation.ts';

const context: CancellationContext = {
  orderId: 'order',
  shipmentId: 'shipment',
  actorId: 'buyer',
  source: 'buyer',
  reason: 'Current reason',
};
function refundResult(status: string) {
  return {
    id: 're_1',
    payment_intent: 'pi_1',
    amount: 35,
    status,
    failure_reason: null,
  };
}
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
function fixture() {
  const effects: string[] = [];
  let started = false;
  let operation: Record<string, unknown> | null = null;
  const ports: ShipmentCancellationPorts<void> = {
    context,
    claim: async () =>
      started
        ? { status: 'recovery_required' }
        : {
            status: 'claimed',
            operation_key: 'cancel_shipment_shipment',
            claim_token: 'token',
            source: 'seller',
            actor_id: 'seller',
            reason: 'Original reason',
          },
    prepare: async (winner) => {
      effects.push('prepare:' + winner.reason);
      return {
        paymentIntentId: 'pi_1',
        amountCents: 35,
        seguroShareCents: 6,
        cancellationLossCents: 2,
      };
    },
    start: async (input) => {
      started = true;
      effects.push('start');
      operation = {
        operation_key: 'cancel_shipment_shipment',
        order_id: 'order',
        source: 'seller',
        actor_id: 'seller',
        reason: 'Original reason',
        refund_request: input.refundRequest,
        cancellation_loss_cents: input.cancellationLossCents,
        refund_id: null,
        refund_status: null,
        external_started_at: new Date(NOW - 60_000).toISOString(),
        recovery_escalated_at: null,
      };
      return {
        operation_key: 'cancel_shipment_shipment',
        refund_request: input.refundRequest,
        cancellation_loss_cents: input.cancellationLossCents,
      };
    },
    refund: async (request, options) => {
      expect(request.metadata).toEqual({
        shipment_id: 'shipment',
        order_id: 'order',
        caller_role: 'seller',
        reason: 'Original reason',
        seguro_share_cents: 6,
      });
      expect(options).toEqual({ idempotencyKey: 'cancel_shipment_shipment' });
      effects.push('refund');
      return refundResult('succeeded');
    },
    recordRefund: async (input) => {
      effects.push('record');
      operation = {
        ...operation,
        refund_id: input.refundId,
        refund_status: input.status,
      };
      return {
        refund_id: input.refundId,
        refund_status: input.status,
      };
    },
    loadRecovery: async () => {
      effects.push('loadRecovery');
      return operation;
    },
    listRefunds: async () => {
      effects.push('list');
      return [];
    },
    retrieveRefund: async () => {
      effects.push('retrieve');
      return { ...refundResult('pending'), metadata: { shipment_id: 'shipment' } };
    },
    escalate: async () => {
      effects.push('escalate');
      return { escalated: true };
    },
    reportCritical: () => undefined,
    now: () => NOW,
    complete: async (winner, frozen) => {
      expect(winner).toEqual({
        ...context,
        source: 'seller',
        actorId: 'seller',
        reason: 'Original reason',
      });
      expect(frozen.cancellationLossCents).toBe(2);
      effects.push('complete');
    },
  };
  return { ports, effects };
}

it('keeps takeover context and converges a repeated attempt without another refund', async () => {
  const { ports, effects } = fixture();
  expect(await runShipmentCancellation(ports)).toEqual({
    status: 'cancelled',
    value: undefined,
  });
  // The recorded succeeded refund completes again with the stored winner; no money moves.
  expect(await runShipmentCancellation(ports)).toEqual({
    status: 'cancelled',
    value: undefined,
  });
  expect(effects).toEqual([
    'prepare:Original reason',
    'start',
    'refund',
    'record',
    'complete',
    'loadRecovery',
    'complete',
  ]);
});

it('does not complete or call Stripe when the recorded refund failed', async () => {
  const { ports, effects } = fixture();
  ports.refund = async () => {
    effects.push('refund');
    return refundResult('failed');
  };
  await expect(runShipmentCancellation(ports)).rejects.toThrow(
    'CANCELLATION_REFUND_UNCONFIRMED',
  );
  expect(await runShipmentCancellation(ports)).toEqual({
    status: 'recovery_required',
  });
  expect(effects).toEqual([
    'prepare:Original reason',
    'start',
    'refund',
    'record',
    'loadRecovery',
  ]);
});

it('allows only one concurrent manual contender to reconstruct and refund', async () => {
  const { ports, effects } = fixture();
  const claim = ports.claim;
  let claimed = false;
  ports.claim = async (input) => {
    if (claimed) return { status: 'busy' };
    claimed = true;
    return claim(input);
  };
  expect(
    await Promise.all([
      runShipmentCancellation(ports),
      runShipmentCancellation(ports),
    ]),
  ).toEqual([{ status: 'cancelled', value: undefined }, { status: 'busy' }]);
  expect(effects).toEqual([
    'prepare:Original reason',
    'start',
    'refund',
    'record',
    'complete',
  ]);
});

it('does not reconstruct or cancel for a busy loser', async () => {
  const { ports, effects } = fixture();
  ports.claim = async () => ({ status: 'busy' });
  expect(await runShipmentCancellation(ports)).toEqual({ status: 'busy' });
  expect(effects).toEqual([]);
});

it('never completes after an uncertain refund or already-refunded error', async () => {
  for (const outcome of ['pending', 'charge_already_refunded']) {
    const { ports, effects } = fixture();
    ports.refund = async () => {
      effects.push('refund');
      if (outcome === 'charge_already_refunded') throw new Error(outcome);
      return refundResult(outcome);
    };
    await expect(runShipmentCancellation(ports)).rejects.toThrow(
      outcome === 'pending' ? 'CANCELLATION_REFUND_UNCONFIRMED' : outcome,
    );
    // Recovery re-reads the recorded refund or replays the same key; it never completes.
    await expect(runShipmentCancellation(ports)).rejects.toThrow(
      outcome === 'pending' ? 'CANCELLATION_REFUND_UNCONFIRMED' : outcome,
    );
    expect(effects).not.toContain('complete');
    expect(effects).toEqual(
      outcome === 'pending'
        ? [
            'prepare:Original reason',
            'start',
            'refund',
            'record',
            'loadRecovery',
            'retrieve',
            'record',
          ]
        : [
            'prepare:Original reason',
            'start',
            'refund',
            'loadRecovery',
            'list',
            'refund',
          ],
    );
  }
});

it('wires reservation before financial reconstruction and preserves preclaim guards', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  expect(source).toContain('runShipmentCancellation({');
  expect(source).toContain("'fn_claim_shipment_cancellation'");
  expect(source).toContain("'fn_start_shipment_cancellation_refund'");
  expect(source).toContain("'fn_record_shipment_cancellation_refund'");
  expect(source).toContain("'fn_get_shipment_cancellation_recovery'");
  expect(source).toMatch(/stripe\s*\.refunds\s*\.list\(\{/);
  expect(source).toContain('payment_intent: paymentIntentId');
  expect(source).toContain('stripe.refunds.retrieve(');
  expect(source).toContain("withSentry('cancel-order'");
  expect(source).toContain("createCancellationReporter('cancel-order', log)");
  expect(source).toContain("'fn_escalate_shipment_cancellation'");
  expect(source).toContain("'CANCELLATION_ESCALATION_FAILED'");
  expect(source).toContain("'CANCELLATION_REFUND_RECORD_FAILED'");
  expect(source).toContain("'CANCELLATION_RECOVERY_UNAVAILABLE'");
  const prepare = source.indexOf('prepare: async (winner)');
  expect(prepare).toBeGreaterThan(source.indexOf("'UNAUTHORIZED'"));
  expect(prepare).toBeGreaterThan(
    source.indexOf("'STRIPE_TRANSFER_ALREADY_RELEASED'"),
  );
  expect(source.indexOf('stripe.charges.retrieve')).toBeGreaterThan(prepare);
  expect(source.indexOf('buildStripeFeeReconciliationPlan({')).toBeGreaterThan(
    prepare,
  );
  expect(source).toContain('return stripe.refunds.create(request, options)');
  expect(source).not.toContain("code === 'charge_already_refunded'");
  expect(source).toContain(
    'p_cancellation_loss_cents: frozen.cancellationLossCents',
  );
  expect(source).toContain('p_reason: winner.reason');
  expect(source).toContain(
    "throw new ApiError(409, 'CANCELLATION_' + result.status.toUpperCase())",
  );
});

it('serializes fractional-price seguro share as integer cents and preserves allocation', () => {
  const item = {
    price_at_purchase: 0.29,
    shipping_amount: 10,
    shipment_id: 'shipment',
  };
  const plan = resolveManualShipmentCancelPlan({
    isMaintenance: false,
    callerRole: 'buyer',
    callerId: 'buyer',
    orderId: 'order',
    orderBuyerId: 'buyer',
    shipmentSellerId: 'seller',
    shipmentId: 'shipment',
    shipmentOrderId: 'order',
    shipmentStatus: 'paid',
    shipmentStripePaymentIntentId: 'pi_1',
    shipmentStripeTransferId: null,
    shipmentItems: [item],
    orderItems: [item],
    orderChargeCents: 35,
    actualStripeFeeCents: 2,
    reason: 'Original reason',
  });
  expect(plan.amountCents).toBe(35);
  expect(plan.refundParams.params.metadata.seguro_share_cents).toBe(6);
  expect(plan.rpcInput).toEqual({
    p_shipment_id: 'shipment',
    p_cancelled_by_role: 'buyer',
    p_reason: 'Original reason',
    p_cancellation_loss_cents: 2,
  });
});
