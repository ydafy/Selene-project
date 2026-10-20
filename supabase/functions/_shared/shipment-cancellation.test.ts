import { describe, expect, test } from 'bun:test';
import {
  runShipmentCancellation,
  type CancellationContext,
  type CancellationPlan,
} from './shipment-cancellation.ts';

const context: CancellationContext = {
  shipmentId: 'shipment-a',
  orderId: 'order-a',
  actorId: 'buyer-a',
  source: 'buyer',
  reason: 'Original reason',
};
const plan: CancellationPlan = {
  paymentIntentId: 'pi_a',
  amountCents: 11000,
  seguroShareCents: 1000,
  cancellationLossCents: 400,
};
const stripeRefund = {
  id: 're_a',
  payment_intent: 'pi_a',
  amount: 11000,
  status: 'succeeded',
  failure_reason: null,
};
const claim = {
  status: 'claimed',
  operation_key: 'cancel_shipment_shipment-a',
  claim_token: 'opaque-token',
  source: 'buyer',
  actor_id: 'buyer-a',
  reason: 'Original reason',
};
function harness(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const effects = { refunds: 0, cancellations: 0 };
  const recorded: unknown[] = [];
  const dependencies = {
    context,
    claim: async () => {
      calls.push('claim');
      return claim;
    },
    prepare: async () => {
      calls.push('prepare');
      return plan;
    },
    start: async (input: {
      refundRequest: unknown;
      cancellationLossCents: number | null;
    }) => {
      calls.push('start');
      return {
        operation_key: claim.operation_key,
        refund_request: input.refundRequest,
        cancellation_loss_cents: input.cancellationLossCents,
      };
    },
    refund: async () => {
      calls.push('refund');
      effects.refunds++;
      return { ...stripeRefund };
    },
    recordRefund: async (input: { refundId: string; status: string }) => {
      calls.push('record');
      recorded.push(input);
      return {
        refund_id: input.refundId,
        refund_status: input.status,
        refund_failure_reason: null,
        changed: true,
      };
    },
    complete: async () => {
      calls.push('complete');
      effects.cancellations++;
      return { success: true };
    },
  };
  return {
    calls,
    effects,
    recorded,
    run: () => runShipmentCancellation({ ...dependencies, ...overrides }),
  };
}

describe('shipment cancellation reservation orchestration', () => {
  test('claims, reconstructs, freezes/starts, refunds once then completes', async () => {
    const subject = harness();
    expect(await subject.run()).toEqual({
      status: 'cancelled',
      value: { success: true },
    });
    expect(subject.calls).toEqual([
      'claim',
      'prepare',
      'start',
      'refund',
      'record',
      'complete',
    ]);
    expect(subject.effects).toEqual({ refunds: 1, cancellations: 1 });
    expect(subject.recorded).toEqual([
      {
        shipmentId: 'shipment-a',
        refundId: 're_a',
        paymentIntentId: 'pi_a',
        amountCents: 11000,
        status: 'succeeded',
        failureReason: null,
      },
    ]);
  });

  test.each(['busy', 'recovery_required'] as const)(
    '%s never reconstructs, refunds or mutates business data',
    async (status: 'busy' | 'recovery_required') => {
      const subject = harness({ claim: async () => ({ status }) });
      expect(await subject.run()).toEqual({ status });
      expect(subject.calls).toEqual([]);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    },
  );

  test('uses the persisted winning context, request, loss and common idempotency key', async () => {
    const sent: unknown[] = [];
    let preparedContext: unknown;
    let completedContext: unknown;
    const persisted = {
      payment_intent: 'pi_a',
      amount: 11000,
      reason: 'requested_by_customer',
      metadata: {
        shipment_id: 'shipment-a',
        order_id: 'order-a',
        caller_role: 'system',
        reason: 'First cron reason',
        seguro_share_cents: 1000,
      },
    };
    const result = await runShipmentCancellation({
      context: { ...context, reason: 'Later buyer reason' },
      claim: async () => ({
        ...claim,
        source: 'paid_timeout',
        actor_id: null,
        reason: 'First cron reason',
      }),
      prepare: async (winner) => {
        preparedContext = winner;
        return plan;
      },
      start: async (input) => {
        expect(input.refundRequest).toEqual(persisted);
        expect(input.claimToken).toBe('opaque-token');
        return {
          operation_key: claim.operation_key,
          refund_request: structuredClone(persisted),
          cancellation_loss_cents: 400,
        };
      },
      refund: async (params, options) => {
        sent.push(params, options);
        return { ...stripeRefund };
      },
      recordRefund: async (input) => ({
        refund_id: input.refundId,
        refund_status: input.status,
      }),
      complete: async (winner, frozen) => {
        completedContext = [winner, frozen];
        return 'done';
      },
    });
    const winner = {
      ...context,
      actorId: null,
      source: 'paid_timeout',
      reason: 'First cron reason',
    };
    expect(preparedContext).toEqual(winner);
    expect(sent).toEqual([
      persisted,
      { idempotencyKey: 'cancel_shipment_shipment-a' },
    ]);
    expect(completedContext).toEqual([
      winner,
      {
        operationKey: claim.operation_key,
        refundRequest: persisted,
        cancellationLossCents: 400,
      },
    ]);
    expect(result).toEqual({ status: 'cancelled', value: 'done' });
    expect(JSON.stringify(result)).not.toContain('opaque-token');
  });

  test.each(['seller', 'paid_timeout', 'preparing_timeout'] as const)(
    'preserves %s source and null/zero loss',
    async (source: 'seller' | 'paid_timeout' | 'preparing_timeout') => {
      for (const loss of [null, 0]) {
        let sent: unknown;
        const subject = harness({
          claim: async () => ({
            ...claim,
            source,
            actor_id: source === 'seller' ? 'seller-a' : null,
          }),
          prepare: async () => ({ ...plan, cancellationLossCents: loss }),
          refund: async (params: unknown) => {
            sent = params;
            return { ...stripeRefund };
          },
        });
        expect((await subject.run()).status).toBe('cancelled');
        expect(sent).toEqual({
          payment_intent: 'pi_a',
          amount: 11000,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: 'shipment-a',
            order_id: 'order-a',
            caller_role: source === 'seller' ? 'seller' : 'system',
            reason: 'Original reason',
            seguro_share_cents: 1000,
          },
        });
      }
    },
  );

  test('invalid reconstructed payment, integer cents or loss never starts or refunds', async () => {
    for (const invalid of [
      { paymentIntentId: '' },
      { amountCents: 0 },
      { amountCents: 1.5 },
      { amountCents: Number.MAX_SAFE_INTEGER + 1 },
      { seguroShareCents: -1 },
      { seguroShareCents: 11001 },
      { seguroShareCents: 0.5 },
      { cancellationLossCents: -1 },
      { cancellationLossCents: Number.NaN },
    ]) {
      const subject = harness({
        prepare: async () => ({ ...plan, ...invalid }),
      });
      await expect(subject.run()).rejects.toThrow(
        'INVALID_CANCELLATION_REFUND_REQUEST',
      );
      expect(subject.calls).toEqual(['claim']);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
  });

  test('failed or uncertain claim/prepare/start never reaches a provider', async () => {
    for (const stage of ['claim', 'prepare', 'start']) {
      const subject = harness({
        [stage]: async () => {
          throw new Error(`${stage} unavailable`);
        },
      });
      await expect(subject.run()).rejects.toThrow(`${stage} unavailable`);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
  });

  test('invalid claim/start envelopes fail closed without refunds or completion', async () => {
    for (const response of [
      null,
      {},
      { status: 'other' },
      { ...claim, claim_token: '' },
      { ...claim, operation_key: 'other-key' },
      { ...claim, source: 'admin' },
      { ...claim, actor_id: null },
      { ...claim, reason: '' },
    ]) {
      const subject = harness({ claim: async () => response });
      await expect(subject.run()).rejects.toThrow(
        'CANCELLATION_RESERVATION_INVALID',
      );
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
    for (const response of [
      null,
      true,
      {},
      { operation_key: 'other-key' },
      {
        operation_key: claim.operation_key,
        refund_request: {},
        cancellation_loss_cents: 400,
      },
    ]) {
      const subject = harness({ start: async () => response });
      await expect(subject.run()).rejects.toThrow('CANCELLATION_START_INVALID');
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
  });

  test('changed frozen request/key/loss fails closed, not a second reconstruction', async () => {
    for (const field of ['amount', 'metadata', 'loss']) {
      const subject = harness({
        start: async (input: { refundRequest: object }) => ({
          operation_key: claim.operation_key,
          refund_request: {
            ...input.refundRequest,
            ...(field === 'amount'
              ? { amount: 22000 }
              : field === 'metadata'
                ? { metadata: {} }
                : {}),
          },
          cancellation_loss_cents: field === 'loss' ? 401 : 400,
        }),
      });
      await expect(subject.run()).rejects.toThrow('CANCELLATION_START_INVALID');
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
  });

  test('provider failure including already-refunded never completes DB cancellation', async () => {
    for (const message of ['timeout', 'charge_already_refunded']) {
      const subject = harness({
        refund: async () => {
          throw new Error(message);
        },
      });
      await expect(subject.run()).rejects.toThrow(message);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
      expect(subject.calls).toEqual(['claim', 'prepare', 'start']);
    }
  });

  test.each(['pending', 'requires_action', 'failed', 'canceled'] as const)(
    'a %s refund is recorded once and never completes',
    async (status: string) => {
      const sent = { refunds: 0 };
      const subject = harness({
        refund: async () => {
          sent.refunds++;
          return {
            ...stripeRefund,
            status,
            failure_reason:
              status === 'failed' ? 'expired_or_canceled_card' : null,
          };
        },
      });
      await expect(subject.run()).rejects.toMatchObject({
        status: 409,
        message: 'CANCELLATION_REFUND_UNCONFIRMED',
      });
      expect(subject.calls).toEqual(['claim', 'prepare', 'start', 'record']);
      expect(subject.recorded).toEqual([
        {
          shipmentId: 'shipment-a',
          refundId: 're_a',
          paymentIntentId: 'pi_a',
          amountCents: 11000,
          status,
          failureReason:
            status === 'failed' ? 'expired_or_canceled_card' : null,
        },
      ]);
      expect(sent.refunds).toBe(1);
      expect(subject.effects.cancellations).toBe(0);
    },
  );

  test('Stripe succeeded but recorded state not succeeded never completes', async () => {
    const subject = harness({
      recordRefund: async (input: { refundId: string }) => ({
        refund_id: input.refundId,
        refund_status: 'failed',
      }),
    });
    await expect(subject.run()).rejects.toMatchObject({
      status: 409,
      message: 'CANCELLATION_REFUND_UNCONFIRMED',
    });
    expect(subject.effects).toEqual({ refunds: 1, cancellations: 0 });
  });

  test.each([
    undefined,
    null,
    {},
    { status: 'succeeded' },
    { id: '  ', status: 'succeeded' },
    { id: 're_a' },
    { id: 're_a', status: 1 },
    { id: 're_a', status: null, payment_intent: 'pi_a', amount: 11000 },
    { id: 're_a', status: 'succeeded', payment_intent: null, amount: 11000 },
    { id: 're_a', status: 'succeeded', payment_intent: { id: 'pi_a' }, amount: 11000 },
    { id: 're_a', status: 'succeeded', payment_intent: 'pi_a', amount: 110.5 },
    { id: 're_a', status: 'succeeded', payment_intent: 'pi_a', amount: '11000' },
  ])(
    'unusable refund response %p is not recorded or completed',
    async (result) => {
      const subject = harness({ refund: async () => result });
      await expect(subject.run()).rejects.toMatchObject({
        status: 409,
        message: 'CANCELLATION_REFUND_UNCONFIRMED',
      });
      expect(subject.calls).toEqual(['claim', 'prepare', 'start']);
      expect(subject.recorded).toEqual([]);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    },
  );

  test('a recordRefund failure never completes or retries the refund', async () => {
    const subject = harness({
      recordRefund: async () => {
        throw new Error('record unavailable');
      },
    });
    await expect(subject.run()).rejects.toThrow('record unavailable');
    expect(subject.effects).toEqual({ refunds: 1, cancellations: 0 });
  });

  test.each([
    null,
    {},
    { refund_id: 'other', refund_status: 'succeeded' },
    { refund_id: 're_a' },
    { refund_id: 're_a', refund_status: 1 },
  ])('invalid record envelope %p fails closed', async (envelope) => {
    const subject = harness({ recordRefund: async () => envelope });
    await expect(subject.run()).rejects.toMatchObject({
      status: 500,
      message: 'CANCELLATION_REFUND_RECORD_INVALID',
    });
    expect(subject.effects).toEqual({ refunds: 1, cancellations: 0 });
  });

  test('DB failure after provider does not retry provider within invocation', async () => {
    const subject = harness({
      complete: async () => {
        throw new Error('DB failed');
      },
    });
    await expect(subject.run()).rejects.toThrow('DB failed');
    expect(subject.effects).toEqual({ refunds: 1, cancellations: 0 });
  });

  test('shared reservation permits one manual/cron winner, repeated attempts fence, siblings remain independent', async () => {
    const state = new Map<string, string>();
    const effects: string[] = [];
    const run = (
      source: CancellationContext['source'],
      shipmentId = context.shipmentId,
    ) =>
      runShipmentCancellation({
        context: {
          ...context,
          shipmentId,
          source,
          actorId: source === 'paid_timeout' ? null : context.actorId,
        },
        claim: async () => {
          const status = state.get(shipmentId);
          if (status) return { status };
          state.set(shipmentId, 'busy');
          return {
            ...claim,
            source,
            actor_id: source === 'paid_timeout' ? null : context.actorId,
            operation_key: `cancel_shipment_${shipmentId}`,
          };
        },
        prepare: async () => plan,
        start: async (input) => {
          state.set(shipmentId, 'recovery_required');
          return {
            operation_key: `cancel_shipment_${shipmentId}`,
            refund_request: input.refundRequest,
            cancellation_loss_cents: 400,
          };
        },
        refund: async () => {
          effects.push(`refund:${shipmentId}`);
          return { ...stripeRefund };
        },
        recordRefund: async (input) => ({
          refund_id: input.refundId,
          refund_status: input.status,
        }),
        complete: async () => {
          effects.push(`complete:${shipmentId}`);
          return true;
        },
      });
    const results = await Promise.all([run('buyer'), run('paid_timeout')]);
    expect(results.map((r) => r.status).sort()).toEqual(['busy', 'cancelled']);
    expect(effects).toEqual(['refund:shipment-a', 'complete:shipment-a']);
    expect((await run('seller')).status).toBe('recovery_required');
    expect((await run('buyer', 'shipment-b')).status).toBe('cancelled');
    expect(effects).toEqual([
      'refund:shipment-a',
      'complete:shipment-a',
      'refund:shipment-b',
      'complete:shipment-b',
    ]);
  });
});
