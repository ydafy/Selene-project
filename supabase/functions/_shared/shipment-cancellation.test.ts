import { describe, expect, test } from 'bun:test';
import {
  REFUND_REPLAY_WINDOW_MS,
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
const noRecovery = {
  loadRecovery: async () => {
    throw new Error('unexpected loadRecovery');
  },
  listRefunds: async () => {
    throw new Error('unexpected listRefunds');
  },
  retrieveRefund: async () => {
    throw new Error('unexpected retrieveRefund');
  },
  escalate: async () => {
    throw new Error('unexpected escalate');
  },
  reportCritical: async () => undefined,
};
function harness(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const effects = { refunds: 0, cancellations: 0 };
  const recorded: unknown[] = [];
  const criticals: { message: string; data: Record<string, unknown> }[] = [];
  const dependencies = {
    ...noRecovery,
    reportCritical: async (message: string, data: Record<string, unknown>) => {
      criticals.push({ message, data });
    },
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
    criticals,
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

  test('busy never reconstructs, refunds or mutates business data', async () => {
    const subject = harness({ claim: async () => ({ status: 'busy' }) });
    expect(await subject.run()).toEqual({ status: 'busy' });
    expect(subject.calls).toEqual([]);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

  test('recovery_required never reconstructs the plan or starts again', async () => {
    const subject = harness({
      claim: async () => ({ status: 'recovery_required' }),
      loadRecovery: async () => null,
    });
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.calls).toEqual([]);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

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
    {
      id: 're_a',
      status: 'succeeded',
      payment_intent: { id: 'pi_a' },
      amount: 11000,
    },
    { id: 're_a', status: 'succeeded', payment_intent: 'pi_a', amount: 110.5 },
    {
      id: 're_a',
      status: 'succeeded',
      payment_intent: 'pi_a',
      amount: '11000',
    },
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

  test('a recordRefund failure reports CRITICAL with the refund id and keeps the error', async () => {
    const subject = harness({
      recordRefund: async () => {
        throw new Error('record unavailable');
      },
    });
    await expect(subject.run()).rejects.toThrow('record unavailable');
    expect(subject.criticals).toEqual([
      {
        message: 'CANCELLATION_REFUND_RECORD_FAILED',
        data: {
          shipmentId: 'shipment-a',
          refundId: 're_a',
          refundStatus: 'succeeded',
        },
      },
    ]);
  });

  test('an invalid record result reports CRITICAL and a throwing reporter changes nothing', async () => {
    const invalid = harness({
      recordRefund: async () => null,
      reportCritical: async () => {
        throw new Error('sentry down');
      },
    });
    await expect(invalid.run()).rejects.toMatchObject({
      status: 500,
      message: 'CANCELLATION_REFUND_RECORD_INVALID',
    });
    const thrown = harness({
      recordRefund: async () => {
        throw new Error('record unavailable');
      },
      reportCritical: () => {
        throw new Error('sentry down');
      },
    });
    await expect(thrown.run()).rejects.toThrow('record unavailable');
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
    const loads: string[] = [];
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
        ...noRecovery,
        loadRecovery: async (id: string) => {
          loads.push(id);
          return null;
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
    expect(loads).toEqual(['shipment-a']);
    expect((await run('buyer', 'shipment-b')).status).toBe('cancelled');
    expect(effects).toEqual([
      'refund:shipment-a',
      'complete:shipment-a',
      'refund:shipment-b',
      'complete:shipment-b',
    ]);
  });
});

const startedAt = '2026-10-20T10:00:00.000Z';
const frozenRequest = {
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
const startedOperation = {
  operation_key: 'cancel_shipment_shipment-a',
  order_id: 'order-a',
  source: 'paid_timeout',
  actor_id: null,
  reason: 'First cron reason',
  refund_request: frozenRequest,
  cancellation_loss_cents: 400,
  refund_id: null,
  refund_status: null,
  external_started_at: startedAt,
  recovery_escalated_at: null,
};
const escalatedAt = '2026-10-20T12:00:00.000Z';
const ownRefund = {
  ...stripeRefund,
  metadata: { shipment_id: 'shipment-a' },
};
const siblingRefund = {
  ...stripeRefund,
  id: 're_b',
  metadata: { shipment_id: 'shipment-b' },
};

function recoveryHarness(
  operation: unknown,
  overrides: Record<string, unknown> = {},
) {
  const calls: string[] = [];
  const effects = { refunds: 0, cancellations: 0 };
  const recorded: unknown[] = [];
  const sent: unknown[] = [];
  const completed: unknown[] = [];
  const criticals: { message: string; data: Record<string, unknown> }[] = [];
  const escalations: unknown[][] = [];
  const dependencies = {
    context: { ...context, reason: 'Later buyer reason' },
    claim: async () => {
      calls.push('claim');
      return { status: 'recovery_required' };
    },
    prepare: async () => {
      calls.push('prepare');
      throw new Error('unexpected prepare');
    },
    start: async () => {
      calls.push('start');
      throw new Error('unexpected start');
    },
    loadRecovery: async () => {
      calls.push('load');
      return operation;
    },
    listRefunds: async () => {
      calls.push('list');
      return [];
    },
    retrieveRefund: async () => {
      calls.push('retrieve');
      return { ...ownRefund };
    },
    escalate: async (shipmentId: string, reason: string) => {
      calls.push('escalate');
      escalations.push([shipmentId, reason]);
      return { escalated: true };
    },
    refund: async (request: unknown, options: unknown) => {
      calls.push('refund');
      effects.refunds++;
      sent.push(request, options);
      return { ...ownRefund };
    },
    recordRefund: async (input: { refundId: string; status: string }) => {
      calls.push('record');
      recorded.push(input);
      return { refund_id: input.refundId, refund_status: input.status };
    },
    complete: async (winner: unknown, frozen: unknown) => {
      calls.push('complete');
      effects.cancellations++;
      completed.push(winner, frozen);
      return 'done';
    },
    reportCritical: async (message: string, data: Record<string, unknown>) => {
      criticals.push({ message, data });
    },
    now: () => Date.parse(startedAt) + 60 * 60 * 1000,
  };
  return {
    calls,
    effects,
    recorded,
    sent,
    completed,
    criticals,
    escalations,
    run: () => runShipmentCancellation({ ...dependencies, ...overrides }),
  };
}
function recordedAs(status: string) {
  return {
    shipmentId: 'shipment-a',
    refundId: 're_a',
    paymentIntentId: 'pi_a',
    amountCents: 11000,
    status,
    failureReason: null,
  };
}
const storedWinner = {
  ...context,
  actorId: null,
  source: 'paid_timeout',
  reason: 'First cron reason',
};
const storedFrozen = {
  operationKey: 'cancel_shipment_shipment-a',
  refundRequest: frozenRequest,
  cancellationLossCents: 400,
};

describe('shipment cancellation recovery', () => {
  test('a recorded succeeded refund completes without any Stripe call (S2)', async () => {
    const subject = recoveryHarness({
      ...startedOperation,
      refund_id: 're_a',
      refund_status: 'succeeded',
    });
    expect(await subject.run()).toEqual({ status: 'cancelled', value: 'done' });
    expect(subject.calls).toEqual(['claim', 'load', 'complete']);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 1 });
    expect(subject.completed).toEqual([storedWinner, storedFrozen]);
  });

  test('a recorded pending refund is retrieved, recorded and completed', async () => {
    const subject = recoveryHarness(
      { ...startedOperation, refund_id: 're_a', refund_status: 'pending' },
      {
        retrieveRefund: async (id: string) => {
          subject.calls.push(`retrieve:${id}`);
          return { ...ownRefund };
        },
      },
    );
    expect(await subject.run()).toEqual({ status: 'cancelled', value: 'done' });
    expect(subject.calls).toEqual([
      'claim',
      'load',
      'retrieve:re_a',
      'record',
      'complete',
    ]);
    expect(subject.recorded).toEqual([recordedAs('succeeded')]);
    expect(subject.effects.refunds).toBe(0);
  });

  test('a recorded pending refund still pending is unconfirmed and not completed', async () => {
    const subject = recoveryHarness(
      { ...startedOperation, refund_id: 're_a', refund_status: 'pending' },
      {
        retrieveRefund: async () => ({ ...ownRefund, status: 'pending' }),
      },
    );
    await expect(subject.run()).rejects.toMatchObject({
      status: 409,
      message: 'CANCELLATION_REFUND_UNCONFIRMED',
    });
    expect(subject.calls).toEqual(['claim', 'load', 'record']);
    expect(subject.recorded).toEqual([recordedAs('pending')]);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

  test.each(['failed', 'canceled'])(
    'a recorded %s refund needs an admin and makes no Stripe call',
    async (refund_status) => {
      const subject = recoveryHarness({
        ...startedOperation,
        refund_id: 're_a',
        refund_status,
      });
      expect(await subject.run()).toEqual({ status: 'recovery_required' });
      expect(subject.calls).toEqual(['claim', 'load']);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    },
  );

  test('nothing recorded: lists and uses exactly this shipment refund among a same-PI same-amount sibling (S5)', async () => {
    const subject = recoveryHarness(startedOperation, {
      listRefunds: async (pi: string) => {
        subject.calls.push(`list:${pi}`);
        return [siblingRefund, ownRefund];
      },
    });
    expect(await subject.run()).toEqual({ status: 'cancelled', value: 'done' });
    expect(subject.calls).toEqual([
      'claim',
      'load',
      'list:pi_a',
      'record',
      'complete',
    ]);
    expect(subject.recorded).toEqual([recordedAs('succeeded')]);
    expect(subject.effects.refunds).toBe(0);
    expect(subject.completed).toEqual([storedWinner, storedFrozen]);
  });

  test('two matching refunds report CRITICAL and need an admin', async () => {
    const subject = recoveryHarness(startedOperation, {
      listRefunds: async () => [ownRefund, { ...ownRefund, id: 're_c' }],
    });
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.criticals).toHaveLength(1);
    expect(subject.criticals[0].message).toBe('CANCELLATION_REFUND_AMBIGUOUS');
    expect(subject.criticals[0].data).toMatchObject({
      shipmentId: 'shipment-a',
    });
    expect(subject.calls).toEqual(['claim', 'load', 'escalate']);
    expect(subject.escalations).toEqual([['shipment-a', 'refund_ambiguous']]);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

  test('no refund within 23 h replays the identical frozen request and key', async () => {
    const subject = recoveryHarness(startedOperation, {
      listRefunds: async () => [siblingRefund],
    });
    expect(await subject.run()).toEqual({ status: 'cancelled', value: 'done' });
    expect(subject.sent).toEqual([
      frozenRequest,
      { idempotencyKey: 'cancel_shipment_shipment-a' },
    ]);
    expect(subject.effects.refunds).toBe(1);
    expect(subject.recorded).toEqual([recordedAs('succeeded')]);
  });

  test('at and after 23 h without a refund reports CRITICAL and never creates (S4)', async () => {
    for (const offset of [
      REFUND_REPLAY_WINDOW_MS,
      REFUND_REPLAY_WINDOW_MS + 1,
      25 * 60 * 60 * 1000,
    ]) {
      const subject = recoveryHarness(startedOperation, {
        now: () => Date.parse(startedAt) + offset,
      });
      expect(await subject.run()).toEqual({ status: 'recovery_required' });
      expect(subject.criticals).toHaveLength(1);
      expect(subject.criticals[0].message).toBe('CANCELLATION_REFUND_NOT_FOUND');
      expect(subject.escalations).toEqual([['shipment-a', 'refund_not_found']]);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
    const justInside = recoveryHarness(startedOperation, {
      now: () => Date.parse(startedAt) + REFUND_REPLAY_WINDOW_MS - 1,
    });
    expect((await justInside.run()).status).toBe('cancelled');
  });

  test('a changed caller or reason completes with the stored winner (S4)', async () => {
    const subject = recoveryHarness(startedOperation, {
      context: { ...context, actorId: 'someone-else', source: 'seller' },
      listRefunds: async () => [ownRefund],
    });
    expect((await subject.run()).status).toBe('cancelled');
    expect(subject.completed).toEqual([storedWinner, storedFrozen]);
    expect(subject.recorded).toEqual([recordedAs('succeeded')]);
  });

  const withRequest = (patch: Record<string, unknown>) => ({
    ...startedOperation,
    refund_request: { ...frozenRequest, ...patch },
  });
  const withMetadata = (patch: Record<string, unknown>) =>
    withRequest({ metadata: { ...frozenRequest.metadata, ...patch } });
  test.each([
    ['null', null],
    ['other operation key', { ...startedOperation, operation_key: 'other' }],
    ['other order', { ...startedOperation, order_id: 'order-z' }],
    ['bad source', { ...startedOperation, source: 'admin' }],
    ['buyer without actor', { ...startedOperation, source: 'buyer' }],
    ['system with actor', { ...startedOperation, actor_id: 'x' }],
    ['blank reason', { ...startedOperation, reason: ' ' }],
    ['missing request', { ...startedOperation, refund_request: null }],
    ['extra request key', withRequest({ extra: 1 })],
    ['fractional amount', withRequest({ amount: 1.5 })],
    ['zero amount', withRequest({ amount: 0 })],
    ['blank payment intent', withRequest({ payment_intent: '' })],
    ['other reason code', withRequest({ reason: 'duplicate' })],
    ['other shipment metadata', withMetadata({ shipment_id: 'shipment-z' })],
    ['other order metadata', withMetadata({ order_id: 'order-z' })],
    ['extra metadata key', withMetadata({ extra: 'x' })],
    ['negative loss', { ...startedOperation, cancellation_loss_cents: -1 }],
    ['fractional loss', { ...startedOperation, cancellation_loss_cents: 0.5 }],
    ['unparseable start', { ...startedOperation, external_started_at: 'nope' }],
    ['missing start', { ...startedOperation, external_started_at: null }],
    ['unparseable escalation', { ...startedOperation, recovery_escalated_at: 'nope' }],
    ['numeric escalation', { ...startedOperation, recovery_escalated_at: 123 }],
    [
      'missing escalation field',
      Object.fromEntries(
        Object.entries(startedOperation).filter(
          ([key]) => key !== 'recovery_escalated_at',
        ),
      ),
    ],
    ['id without status', { ...startedOperation, refund_id: 're_a' }],
    ['status without id', { ...startedOperation, refund_status: 'pending' }],
  ])(
    'invalid operation (%s) is recovery_required with no Stripe call',
    async (_name, operation) => {
      const subject = recoveryHarness(operation);
      expect(await subject.run()).toEqual({ status: 'recovery_required' });
      expect(subject.calls).toEqual(['claim', 'load']);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    },
  );

  describe('escalation (B2.2.1)', () => {
    const escalatedOperation = {
      ...startedOperation,
      recovery_escalated_at: escalatedAt,
    };

    test('an escalated operation with no recorded refund stops before any Stripe call and stays silent', async () => {
      const subject = recoveryHarness(escalatedOperation);
      expect(await subject.run()).toEqual({ status: 'recovery_required' });
      expect(subject.calls).toEqual(['claim', 'load']);
      expect(subject.criticals).toEqual([]);
      expect(subject.escalations).toEqual([]);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    });

    test('a recorded succeeded refund still completes when escalated', async () => {
      const subject = recoveryHarness({
        ...escalatedOperation,
        refund_id: 're_a',
        refund_status: 'succeeded',
      });
      expect(await subject.run()).toEqual({ status: 'cancelled', value: 'done' });
      expect(subject.calls).toEqual(['claim', 'load', 'complete']);
      expect(subject.criticals).toEqual([]);
    });

    test('a recorded pending refund is still retrieved and completed when escalated', async () => {
      const subject = recoveryHarness({
        ...escalatedOperation,
        refund_id: 're_a',
        refund_status: 'pending',
      });
      expect(await subject.run()).toEqual({ status: 'cancelled', value: 'done' });
      expect(subject.calls).toEqual(['claim', 'load', 'retrieve', 'record', 'complete']);
      expect(subject.escalations).toEqual([]);
    });

    test.each([
      [
        'refund_ambiguous',
        'CANCELLATION_REFUND_AMBIGUOUS',
        { listRefunds: async () => [ownRefund, { ...ownRefund, id: 're_c' }] },
      ],
      [
        'refund_not_found',
        'CANCELLATION_REFUND_NOT_FOUND',
        { now: () => Date.parse(startedAt) + REFUND_REPLAY_WINDOW_MS },
      ],
    ])('%s: reports CRITICAL only when the escalation was newly recorded', async (reason, message, overrides) => {
      const first = recoveryHarness(startedOperation, overrides);
      expect(await first.run()).toEqual({ status: 'recovery_required' });
      expect(first.escalations).toEqual([['shipment-a', reason]]);
      expect(first.criticals.map((entry) => entry.message)).toEqual([message]);

      for (const result of [
        { escalated: false },
        { escalated: 'true' },
        { escalated: true, extra: 1 },
        {},
        null,
        undefined,
        true,
      ]) {
        const later = recoveryHarness(startedOperation, {
          ...overrides,
          escalate: async () => result,
        });
        expect(await later.run()).toEqual({ status: 'recovery_required' });
        expect(later.criticals).toEqual([]);
        expect(later.effects).toEqual({ refunds: 0, cancellations: 0 });
      }
    });

    test.each([
      ['CANCELLATION_REFUND_AMBIGUOUS', { listRefunds: async () => [ownRefund, { ...ownRefund, id: 're_c' }] }],
      ['CANCELLATION_REFUND_NOT_FOUND', { now: () => Date.parse(startedAt) + REFUND_REPLAY_WINDOW_MS }],
    ])('%s: an escalate failure still needs an admin and fails safe toward alerting', async (message, overrides) => {
      const subject = recoveryHarness(startedOperation, {
        ...overrides,
        escalate: async () => {
          throw new Error('rpc down');
        },
      });
      expect(await subject.run()).toEqual({ status: 'recovery_required' });
      expect(subject.criticals).toHaveLength(1);
      expect(subject.criticals[0].message).toBe(message);
      expect(subject.criticals[0].data).toMatchObject({ shipmentId: 'shipment-a' });
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    });

    test('a throwing reporter never changes the escalation outcome', async () => {
      const subject = recoveryHarness(startedOperation, {
        now: () => Date.parse(startedAt) + REFUND_REPLAY_WINDOW_MS,
        reportCritical: () => {
          throw new Error('sentry down');
        },
      });
      expect(await subject.run()).toEqual({ status: 'recovery_required' });
      expect(subject.escalations).toEqual([['shipment-a', 'refund_not_found']]);
    });
  });

  test('a null loss in the stored operation is accepted', async () => {
    const subject = recoveryHarness({
      ...startedOperation,
      cancellation_loss_cents: null,
      refund_id: 're_a',
      refund_status: 'succeeded',
    });
    expect((await subject.run()).status).toBe('cancelled');
    expect(subject.completed[1]).toEqual({
      ...storedFrozen,
      cancellationLossCents: null,
    });
  });

  test('a recovered refund of another shipment fails closed without recording', async () => {
    const pending = {
      ...startedOperation,
      refund_id: 're_a',
      refund_status: 'pending',
    };
    for (const refund of [
      { ...ownRefund, metadata: { shipment_id: 'shipment-b' } },
      { ...ownRefund, metadata: {} },
      { ...ownRefund, metadata: undefined },
      { ...ownRefund, id: 're_other' },
    ]) {
      const subject = recoveryHarness(pending, {
        retrieveRefund: async () => refund,
      });
      await expect(subject.run()).rejects.toMatchObject({
        status: 409,
        message: 'CANCELLATION_REFUND_UNCONFIRMED',
      });
      expect(subject.recorded).toEqual([]);
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    }
    const replayed = recoveryHarness(startedOperation, {
      refund: async () => ({
        ...ownRefund,
        metadata: { shipment_id: 'shipment-b' },
      }),
    });
    await expect(replayed.run()).rejects.toMatchObject({
      status: 409,
      message: 'CANCELLATION_REFUND_UNCONFIRMED',
    });
    expect(replayed.recorded).toEqual([]);
  });

  test.each([
    { ...ownRefund, id: '' },
    { ...ownRefund, status: null },
    { ...ownRefund, payment_intent: null },
    { ...ownRefund, amount: 110.5 },
    null,
  ])('an unusable recovered refund %p fails closed', async (refund) => {
    const subject = recoveryHarness(
      { ...startedOperation, refund_id: 're_a', refund_status: 'pending' },
      { retrieveRefund: async () => refund },
    );
    await expect(subject.run()).rejects.toMatchObject({
      status: 409,
      message: 'CANCELLATION_REFUND_UNCONFIRMED',
    });
    expect(subject.recorded).toEqual([]);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

  test('a listRefunds result that is not an array fails closed without creating', async () => {
    for (const listed of [null, undefined, { data: [ownRefund] }, 'x']) {
      const subject = recoveryHarness(startedOperation, {
        listRefunds: async () => listed,
      });
      await expect(subject.run()).rejects.toMatchObject({
        status: 409,
        message: 'CANCELLATION_REFUND_UNCONFIRMED',
      });
      expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
      expect(subject.recorded).toEqual([]);
    }
  });

  test('a record failure in recovery reports CRITICAL with the refund id', async () => {
    const subject = recoveryHarness(startedOperation, {
      listRefunds: async () => [ownRefund],
      recordRefund: async () => {
        throw new Error('record unavailable');
      },
    });
    await expect(subject.run()).rejects.toThrow('record unavailable');
    expect(subject.criticals).toEqual([
      {
        message: 'CANCELLATION_REFUND_RECORD_FAILED',
        data: {
          shipmentId: 'shipment-a',
          refundId: 're_a',
          refundStatus: 'succeeded',
        },
      },
    ]);
  });

  test('a throwing reporter never changes recovery outcomes', async () => {
    const throwing = () => {
      throw new Error('sentry down');
    };
    const found = recoveryHarness(startedOperation, {
      listRefunds: async () => [ownRefund],
      reportCritical: throwing,
    });
    expect(await found.run()).toEqual({ status: 'cancelled', value: 'done' });
    const ambiguous = recoveryHarness(startedOperation, {
      listRefunds: async () => [ownRefund, { ...ownRefund, id: 're_c' }],
      reportCritical: throwing,
    });
    expect(await ambiguous.run()).toEqual({ status: 'recovery_required' });
    const expired = recoveryHarness(startedOperation, {
      now: () => Date.parse(startedAt) + 2 * REFUND_REPLAY_WINDOW_MS,
      reportCritical: throwing,
    });
    expect(await expired.run()).toEqual({ status: 'recovery_required' });
    const failedRecord = recoveryHarness(startedOperation, {
      listRefunds: async () => [ownRefund],
      recordRefund: async () => {
        throw new Error('record unavailable');
      },
      reportCritical: throwing,
    });
    await expect(failedRecord.run()).rejects.toThrow('record unavailable');
  });
});

describe('shipment cancellation carrier confirmation port (B4.4b)', () => {
  const happyPath = [
    'claim',
    'prepare',
    'start',
    'refund',
    'record',
    'complete',
  ];

  test.each(['buyer', 'paid_timeout'] as const)(
    'without the port a %s cancellation runs exactly as before',
    async (source) => {
      const subject = harness({
        context: { ...context, source, actorId: source === 'buyer' ? 'buyer-a' : null },
        claim: async () => {
          subject.calls.push('claim');
          return {
            ...claim,
            source,
            actor_id: source === 'buyer' ? 'buyer-a' : null,
          };
        },
      });
      expect(await subject.run()).toEqual({
        status: 'cancelled',
        value: { success: true },
      });
      expect(subject.calls).toEqual(happyPath);
    },
  );

  test('a proceed answer runs after the claim and before prepare, with the stored winner and the claim token', async () => {
    const confirmations: unknown[][] = [];
    const subject = harness({
      confirmBeforeRefund: async (...args: unknown[]) => {
        subject.calls.push('confirm');
        confirmations.push(args);
        return { proceed: true };
      },
    });
    expect(await subject.run()).toEqual({
      status: 'cancelled',
      value: { success: true },
    });
    expect(subject.calls).toEqual([
      'claim',
      'confirm',
      'prepare',
      'start',
      'refund',
      'record',
      'complete',
    ]);
    expect(confirmations).toEqual([
      [
        {
          ...context,
          source: 'buyer',
          actorId: 'buyer-a',
          reason: 'Original reason',
        },
        'opaque-token',
      ],
    ]);
  });

  test('a stop answer ends the run with carrier_pending: no prepare, start, refund or completion', async () => {
    const subject = harness({
      confirmBeforeRefund: async () => {
        subject.calls.push('confirm');
        return { proceed: false, reason: 'carrier_refused' };
      },
    });
    expect(await subject.run()).toEqual({
      status: 'carrier_pending',
      reason: 'carrier_refused',
    });
    expect(subject.calls).toEqual(['claim', 'confirm']);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
    expect(subject.recorded).toEqual([]);
  });

  test('a throwing confirmation propagates its error and never reaches prepare', async () => {
    const subject = harness({
      confirmBeforeRefund: async () => {
        subject.calls.push('confirm');
        throw new Error('carrier lookup exploded');
      },
    });
    await expect(subject.run()).rejects.toThrow('carrier lookup exploded');
    expect(subject.calls).toEqual(['claim', 'confirm']);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

  test.each([
    ['undefined', undefined],
    ['a bare true', true],
    ['an empty object', {}],
    ['proceed as a string', { proceed: 'true' }],
    ['a stop without a reason', { proceed: false }],
    ['a stop with a blank reason', { proceed: false, reason: '  ' }],
  ])('%s fails closed without prepare or any money movement', async (_label, answer) => {
    const subject = harness({
      confirmBeforeRefund: async () => {
        subject.calls.push('confirm');
        return answer;
      },
    });
    await expect(subject.run()).rejects.toMatchObject({
      message: 'CANCELLATION_CONFIRMATION_INVALID',
    });
    expect(subject.calls).toEqual(['claim', 'confirm']);
    expect(subject.effects).toEqual({ refunds: 0, cancellations: 0 });
  });

  test.each([
    ['busy', { status: 'busy' }],
    ['recovery_required', { status: 'recovery_required' }],
  ])('a %s claim never asks for carrier confirmation', async (_label, reservation) => {
    const subject = harness({
      claim: async () => {
        subject.calls.push('claim');
        return reservation;
      },
      loadRecovery: async () => null,
      confirmBeforeRefund: async () => {
        subject.calls.push('confirm');
        return { proceed: true };
      },
    });
    await subject.run();
    expect(subject.calls).not.toContain('confirm');
    expect(subject.calls).not.toContain('prepare');
  });
});
