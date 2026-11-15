import { describe, expect, test } from 'bun:test';
import {
  REFUND_REPLAY_WINDOW_MS,
  runShipmentCancellation,
  type CancellationContext,
  type CancellationRefundRecordInput,
  type ShipmentCancellationPorts,
} from './shipment-cancellation.ts';

// The admin overdue payout refund (#549, odd/tasks/held-payout-overdue-refund.md T5) runs
// through the same coordinator as cancellations. These cases pin what differs for its source;
// the cancellation sources keep their behavior (shipment-cancellation*.test.ts).

const SHIP = 'ship-overdue';
const ORDER = 'order-overdue';
const ADMIN = 'admin-1';
const KEY = `cancel_shipment_${SHIP}`;
const STARTED = '2026-11-01T00:00:00.000Z';
const T0 = Date.parse(STARTED);
const REASON = 'overdue_payout_seller_rejected';

const context: CancellationContext = {
  shipmentId: SHIP,
  orderId: ORDER,
  actorId: ADMIN,
  source: 'admin_overdue_payout',
  reason: REASON,
};
const frozen = {
  payment_intent: 'pi_overdue',
  amount: 10600,
  reason: 'requested_by_customer',
  metadata: {
    shipment_id: SHIP,
    order_id: ORDER,
    caller_role: 'admin',
    reason: REASON,
    seguro_share_cents: 600,
  },
};
const operation = (overrides: Record<string, unknown> = {}) => ({
  operation_key: KEY,
  order_id: ORDER,
  source: 'admin_overdue_payout',
  actor_id: ADMIN,
  reason: REASON,
  refund_request: frozen,
  cancellation_loss_cents: 390,
  refund_id: null,
  refund_status: null,
  external_started_at: STARTED,
  recovery_escalated_at: null,
  ...overrides,
});
const stripeRefund = (overrides: Record<string, unknown> = {}) => ({
  id: 're_overdue',
  payment_intent: 'pi_overdue',
  amount: 10600,
  status: 'succeeded',
  failure_reason: null,
  metadata: { shipment_id: SHIP },
  ...overrides,
});

function harness(
  overrides: Partial<ShipmentCancellationPorts<unknown>> = {},
  now = T0 + 1000,
) {
  const state = {
    calls: [] as string[],
    requests: [] as { request: unknown; key: string }[],
    records: [] as CancellationRefundRecordInput[],
    escalations: [] as string[],
    criticals: [] as string[],
  };
  const ports: ShipmentCancellationPorts<unknown> = {
    context,
    claim: async () => {
      state.calls.push('claim');
      return {
        status: 'claimed',
        operation_key: KEY,
        claim_token: 'token-1',
        source: 'admin_overdue_payout',
        actor_id: ADMIN,
        reason: REASON,
      };
    },
    prepare: async () => {
      state.calls.push('prepare');
      return {
        paymentIntentId: 'pi_overdue',
        amountCents: 10600,
        seguroShareCents: 600,
        cancellationLossCents: 390,
      };
    },
    start: async (input) => {
      state.calls.push('start');
      return {
        operation_key: KEY,
        refund_request: input.refundRequest,
        cancellation_loss_cents: input.cancellationLossCents,
      };
    },
    refund: async (request, options) => {
      state.calls.push('refund');
      state.requests.push({ request, key: options.idempotencyKey });
      return stripeRefund();
    },
    recordRefund: async (input) => {
      state.calls.push('record');
      state.records.push(input);
      return {
        refund_id: input.refundId,
        refund_status: input.status,
        changed: true,
      };
    },
    loadRecovery: async () => {
      state.calls.push('loadRecovery');
      return operation();
    },
    listRefunds: async () => {
      state.calls.push('list');
      return [];
    },
    retrieveRefund: async () => {
      state.calls.push('retrieve');
      return stripeRefund();
    },
    escalate: async (_shipmentId, reason) => {
      state.calls.push('escalate');
      state.escalations.push(reason);
      return { escalated: true };
    },
    leaseReplay: async () => {
      state.calls.push('lease');
      return { status: 'leased', lease_expires_at: STARTED };
    },
    reportCritical: (message) => {
      state.calls.push(`critical:${message}`);
      state.criticals.push(message);
    },
    now: () => now,
    complete: async () => {
      state.calls.push('complete');
      return { shipment_status: 'refunded' };
    },
    ...overrides,
  };
  return { state, run: () => runShipmentCancellation(ports) };
}

const recoveryClaim = async () => ({
  status: 'recovery_required',
  operation_key: KEY,
});

describe('overdue payout refund through the cancellation coordinator', () => {
  test('sends caller_role admin with the admin as the winner, refunds once, completes', async () => {
    const subject = harness();
    expect(await subject.run()).toEqual({
      status: 'cancelled',
      value: { shipment_status: 'refunded' },
    });
    expect(subject.state.calls).toEqual([
      'claim',
      'prepare',
      'start',
      'refund',
      'record',
      'complete',
    ]);
    expect(subject.state.requests).toEqual([{ request: frozen, key: KEY }]);
  });

  test('a claim without the admin actor is invalid and nothing starts', async () => {
    const subject = harness({
      claim: async () => ({
        status: 'claimed',
        operation_key: KEY,
        claim_token: 'token-1',
        source: 'admin_overdue_payout',
        actor_id: null,
        reason: REASON,
      }),
    });
    await expect(subject.run()).rejects.toThrow(
      'CANCELLATION_RESERVATION_INVALID',
    );
    expect(subject.state.calls).toEqual([]);
  });

  test('a claim won by a cancellation source never runs as the overdue refund', async () => {
    const subject = harness({
      claim: async () => ({
        status: 'claimed',
        operation_key: KEY,
        claim_token: 'token-1',
        source: 'buyer',
        actor_id: 'buyer-1',
        reason: 'Buyer reason',
      }),
    });
    await expect(subject.run()).rejects.toThrow(
      'CANCELLATION_RESERVATION_INVALID',
    );
    expect(subject.state.calls).toEqual([]);
  });

  test('a cancellation never runs an overdue refund operation it finds in recovery', async () => {
    const subject = harness({
      context: { ...context, source: 'buyer', actorId: 'buyer-1' },
      claim: recoveryClaim,
    });
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.state.calls).toEqual(['loadRecovery']);
  });

  test('a pending refund is returned unsettled, recorded and not completed', async () => {
    const subject = harness({
      refund: async () => stripeRefund({ status: 'pending' }),
    });
    expect(await subject.run()).toEqual({
      status: 'refund_unsettled',
      refundId: 're_overdue',
      refundStatus: 'pending',
      amountCents: 10600,
    });
    expect(subject.state.records).toHaveLength(1);
    expect(subject.state.calls).not.toContain('complete');
  });

  test('a failed refund is returned unsettled with its status and not completed', async () => {
    const subject = harness({
      refund: async () =>
        stripeRefund({
          status: 'failed',
          failure_reason: 'expired_or_canceled_card',
        }),
    });
    expect(await subject.run()).toEqual({
      status: 'refund_unsettled',
      refundId: 're_overdue',
      refundStatus: 'failed',
      amountCents: 10600,
    });
    expect(subject.state.records[0]?.failureReason).toBe(
      'expired_or_canceled_card',
    );
    expect(subject.state.calls).not.toContain('complete');
  });

  test('recovery with a recorded failed refund reports it without calling Stripe', async () => {
    const subject = harness({
      claim: recoveryClaim,
      loadRecovery: async () =>
        operation({ refund_id: 're_overdue', refund_status: 'failed' }),
    });
    expect(await subject.run()).toEqual({
      status: 'refund_unsettled',
      refundId: 're_overdue',
      refundStatus: 'failed',
      amountCents: 10600,
    });
    expect(subject.state.calls).toEqual([]);
  });

  test('an escalated operation re-searches Stripe and settles the refund it finds by metadata', async () => {
    const subject = harness(
      {
        claim: recoveryClaim,
        loadRecovery: async () =>
          operation({ recovery_escalated_at: '2026-11-02T00:00:00.000Z' }),
        listRefunds: async () => [
          stripeRefund({ id: 're_other', metadata: { shipment_id: 'x' } }),
          stripeRefund(),
        ],
      },
      T0 + 3 * REFUND_REPLAY_WINDOW_MS,
    );
    expect(await subject.run()).toEqual({
      status: 'cancelled',
      value: { shipment_status: 'refunded' },
    });
    expect(subject.state.requests).toHaveLength(0);
    expect(subject.state.records.map((r) => r.refundId)).toEqual([
      're_overdue',
    ]);
  });

  test('an escalated operation with no refund at Stripe takes the replay lease, lists again, alerts, then replays the frozen request and key', async () => {
    const subject = harness(
      {
        claim: recoveryClaim,
        loadRecovery: async () =>
          operation({ recovery_escalated_at: '2026-11-02T00:00:00.000Z' }),
      },
      T0 + 3 * REFUND_REPLAY_WINDOW_MS,
    );
    expect(await subject.run()).toEqual({
      status: 'cancelled',
      value: { shipment_status: 'refunded' },
    });
    expect(subject.state.calls).toEqual([
      'list',
      'lease',
      'list',
      'critical:OVERDUE_REFUND_REPLAY_PAST_WINDOW',
      'refund',
      'record',
      'complete',
    ]);
    expect(subject.state.requests).toEqual([{ request: frozen, key: KEY }]);
    expect(subject.state.escalations).toEqual([]);
  });

  const escalatedOperation = async () =>
    operation({ recovery_escalated_at: '2026-11-02T00:00:00.000Z' });
  const pastWindow = T0 + 3 * REFUND_REPLAY_WINDOW_MS;

  test('two interleaved admin retries past the window create exactly one refund', async () => {
    // One Stripe account and one operation row shared by both retries.
    const stripeRefunds: Record<string, unknown>[] = [];
    let leaseHeld = false;
    let arrivals = 0;
    let releaseBarrier = () => {};
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const retry = () => {
      let listed = 0;
      return harness(
        {
          claim: recoveryClaim,
          loadRecovery: escalatedOperation,
          // Both retries list before either reaches the lease or Stripe.
          listRefunds: async () => {
            listed += 1;
            if (listed === 1) {
              arrivals += 1;
              if (arrivals === 2) releaseBarrier();
              await barrier;
            }
            return [...stripeRefunds];
          },
          leaseReplay: async () => {
            if (leaseHeld) return { status: 'busy' };
            leaseHeld = true;
            return { status: 'leased', lease_expires_at: STARTED };
          },
          refund: async () => {
            const created = stripeRefund({ id: `re_${stripeRefunds.length}` });
            stripeRefunds.push(created);
            return created;
          },
        },
        pastWindow,
      );
    };
    const results = await Promise.all([retry().run(), retry().run()]);
    expect(stripeRefunds).toHaveLength(1);
    expect(results.map((result) => result.status).sort()).toEqual([
      'busy',
      'cancelled',
    ]);
  });

  test('a refund created between the first list and the lease is found after the lease and settled, never replayed', async () => {
    let listed = 0;
    const subject = harness(
      {
        claim: recoveryClaim,
        loadRecovery: escalatedOperation,
        listRefunds: async () => {
          listed += 1;
          return listed === 1 ? [] : [stripeRefund()];
        },
      },
      pastWindow,
    );
    expect(await subject.run()).toEqual({
      status: 'cancelled',
      value: { shipment_status: 'refunded' },
    });
    expect(subject.state.requests).toEqual([]);
    expect(subject.state.records.map((r) => r.refundId)).toEqual([
      're_overdue',
    ]);
    expect(subject.state.criticals).toEqual([]);
  });

  test('a lease held by another retry answers busy and never calls Stripe to refund', async () => {
    const subject = harness(
      {
        claim: recoveryClaim,
        loadRecovery: escalatedOperation,
        leaseReplay: async () => ({ status: 'busy' }),
      },
      pastWindow,
    );
    expect(await subject.run()).toEqual({ status: 'busy' });
    expect(subject.state.requests).toEqual([]);
    expect(subject.state.records).toEqual([]);
    expect(subject.state.criticals).toEqual([]);
  });

  test('two refunds of the shipment found after the lease escalate as ambiguous and never refund', async () => {
    let listed = 0;
    const subject = harness(
      {
        claim: recoveryClaim,
        loadRecovery: escalatedOperation,
        listRefunds: async () => {
          listed += 1;
          return listed === 1
            ? []
            : [stripeRefund(), stripeRefund({ id: 're_two' })];
        },
      },
      pastWindow,
    );
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.state.requests).toEqual([]);
    expect(subject.state.escalations).toEqual(['refund_ambiguous']);
  });

  test('an unusable lease answer or a missing lease port fails closed without a refund', async () => {
    for (const leaseReplay of [
      async () => ({ status: 'granted' }),
      async () => null,
      undefined,
    ]) {
      const subject = harness(
        { claim: recoveryClaim, loadRecovery: escalatedOperation, leaseReplay },
        pastWindow,
      );
      await expect(subject.run()).rejects.toThrow(
        'CANCELLATION_REPLAY_LEASE_INVALID',
      );
      expect(subject.state.requests).toEqual([]);
    }
  });

  test('inside the replay window the frozen request is replayed with its key and no lease', async () => {
    const subject = harness({ claim: recoveryClaim });
    expect((await subject.run()).status).toBe('cancelled');
    expect(subject.state.calls).not.toContain('lease');
    expect(subject.state.requests).toEqual([{ request: frozen, key: KEY }]);
  });

  test('an escalated operation with two refunds of the shipment stays in recovery and never refunds', async () => {
    const subject = harness({
      claim: recoveryClaim,
      loadRecovery: async () =>
        operation({ recovery_escalated_at: '2026-11-02T00:00:00.000Z' }),
      listRefunds: async () => [stripeRefund(), stripeRefund({ id: 're_two' })],
      escalate: async () => ({ escalated: false }),
    });
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.state.requests).toHaveLength(0);
    expect(subject.state.records).toHaveLength(0);
    expect(subject.state.criticals).toEqual([]);
  });

  test('past the replay window and not yet escalated it escalates once like a cancellation', async () => {
    const subject = harness(
      { claim: recoveryClaim },
      T0 + REFUND_REPLAY_WINDOW_MS,
    );
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.state.escalations).toEqual(['refund_not_found']);
    expect(subject.state.criticals).toEqual(['CANCELLATION_REFUND_NOT_FOUND']);
    expect(subject.state.requests).toHaveLength(0);
  });
});

describe('cancellation sources keep their behavior', () => {
  const buyer: CancellationContext = {
    shipmentId: SHIP,
    orderId: ORDER,
    actorId: 'buyer-1',
    source: 'buyer',
    reason: 'Buyer reason',
  };
  const buyerOperation = (overrides: Record<string, unknown> = {}) =>
    operation({
      source: 'buyer',
      actor_id: 'buyer-1',
      reason: 'Buyer reason',
      refund_request: {
        ...frozen,
        metadata: {
          ...frozen.metadata,
          caller_role: 'buyer',
          reason: 'Buyer reason',
        },
      },
      ...overrides,
    });

  test('a pending cancellation refund still answers CANCELLATION_REFUND_UNCONFIRMED', async () => {
    const subject = harness({
      context: buyer,
      claim: async () => ({
        status: 'claimed',
        operation_key: KEY,
        claim_token: 'token-1',
        source: 'buyer',
        actor_id: 'buyer-1',
        reason: 'Buyer reason',
      }),
      refund: async () => stripeRefund({ status: 'pending' }),
    });
    await expect(subject.run()).rejects.toThrow(
      'CANCELLATION_REFUND_UNCONFIRMED',
    );
  });

  test('a recorded failed cancellation refund still answers recovery_required', async () => {
    const subject = harness({
      context: buyer,
      claim: recoveryClaim,
      loadRecovery: async () =>
        buyerOperation({ refund_id: 're_overdue', refund_status: 'failed' }),
    });
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
  });

  test('an escalated cancellation still answers recovery_required without calling Stripe', async () => {
    const subject = harness({
      context: buyer,
      claim: recoveryClaim,
      loadRecovery: async () =>
        buyerOperation({ recovery_escalated_at: '2026-11-02T00:00:00.000Z' }),
    });
    expect(await subject.run()).toEqual({ status: 'recovery_required' });
    expect(subject.state.calls).toEqual([]);
  });
});
