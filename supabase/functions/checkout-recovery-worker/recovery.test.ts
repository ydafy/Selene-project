import { describe, expect, it } from 'bun:test';

import * as recoveryModule from './recovery.ts';
import {
  buildRecoveryRefundParams,
  claimCheckoutRecoveryShells,
  classifySettlementFailure,
  compensateRecoveryShell,
  processRecoveryClaimsSequentially,
} from './recovery.ts';

describe('checkout recovery > classifySettlementFailure', () => {
  it('requires a refund for closed semantic allocation failures', () => {
    expect(classifySettlementFailure('PRODUCT_NOT_RESERVED')).toEqual({
      kind: 'semantic',
      refundRequired: true,
    });
  });

  it('keeps unknown transport failures retryable without an automatic refund', () => {
    expect(classifySettlementFailure('ETIMEDOUT')).toEqual({
      kind: 'transient',
      refundRequired: false,
    });
  });
});

describe('checkout recovery > compensateRecoveryShell', () => {
  it('returns reconciliation-needed without refunding a pre-classified missing-evidence shell', async () => {
    const calls: string[] = [];

    const result = await compensateRecoveryShell(
      {
        paymentIntentId: 'pi_missing_charge',
        hasDestinationTransfer: false,
        chargeEvidence: 'missing',
      },
      {
        claim: async () => ({ kind: 'claimed' }),
        createRefund: async () => {
          calls.push('refund');
          return { id: 'unexpected' };
        },
        finalize: async () => calls.push('finalize'),
        queueRetry: async () => calls.push('retry'),
      },
    );

    expect(result).toEqual({
      kind: 'reconciliation_needed',
      reason: 'missing_charge_evidence',
    });
    expect(calls).toEqual([]);
  });

  it('refunds with a stable key before finalizing cancellation and reservation release', async () => {
    const calls: string[] = [];

    const result = await compensateRecoveryShell(
      { paymentIntentId: 'pi_123', hasDestinationTransfer: true },
      {
        claim: async () => ({ kind: 'claimed' }),
        createRefund: async (params) => {
          calls.push(`refund:${params.idempotencyKey}`);
          expect(params.reverseTransfer).toBe(true);
          return { id: 're_123' };
        },
        finalize: async ({ refundId }) => {
          calls.push(`finalize:${refundId}`);
        },
        queueRetry: async () => calls.push('retry'),
      },
    );

    expect(result).toEqual({ kind: 'refunded', refundId: 're_123' });
    expect(calls).toEqual(['refund:pi_pi_123_recovery', 'finalize:re_123']);
  });

  it('does not refund or finalize when a duplicate delivery cannot claim the shell', async () => {
    const calls: string[] = [];

    const result = await compensateRecoveryShell(
      { paymentIntentId: 'pi_duplicate', hasDestinationTransfer: false },
      {
        claim: async () => ({ kind: 'busy' }),
        createRefund: async () => {
          calls.push('refund');
          return { id: 'unexpected' };
        },
        finalize: async () => calls.push('finalize'),
        queueRetry: async () => calls.push('retry'),
      },
    );

    expect(result).toEqual({ kind: 'busy' });
    expect(calls).toEqual([]);
  });

  it('queues reconciliation after a refund failure and preserves the held shell', async () => {
    const calls: string[] = [];

    const result = await compensateRecoveryShell(
      { paymentIntentId: 'pi_timeout', hasDestinationTransfer: false },
      {
        claim: async () => ({ kind: 'claimed' }),
        createRefund: async () => {
          calls.push('refund');
          throw new Error('timeout');
        },
        finalize: async () => calls.push('finalize'),
        queueRetry: async ({ error }) => calls.push(`retry:${error}`),
      },
    );

    expect(result).toEqual({ kind: 'retry_queued' });
    expect(calls).toEqual(['refund', 'retry:timeout']);
  });
});

describe('checkout recovery > buildRecoveryRefundParams', () => {
  it('omits reverse_transfer for manual-release charges without a destination transfer', () => {
    expect(
      buildRecoveryRefundParams({
        paymentIntentId: 'pi_manual_release',
        hasDestinationTransfer: false,
      }),
    ).toEqual({
      paymentIntentId: 'pi_manual_release',
      idempotencyKey: 'pi_pi_manual_release_recovery',
    });
  });

  it('includes reverse_transfer only for a proven destination transfer', () => {
    expect(
      buildRecoveryRefundParams({
        paymentIntentId: 'pi_destination',
        hasDestinationTransfer: true,
      }),
    ).toEqual({
      paymentIntentId: 'pi_destination',
      idempotencyKey: 'pi_pi_destination_recovery',
      reverseTransfer: true,
    });
  });
});

describe('checkout recovery worker authorization', () => {
  it('has no dedicated worker-JWT check: the worker authorizes with the shared cron secret', () => {
    expect('isAuthorizedCheckoutRecoveryWorker' in recoveryModule).toBe(false);
  });
});

describe('checkout recovery > cron claims', () => {
  it('does not start the next claim until the current claim completes', async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCompleted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const processing = processRecoveryClaimsSequentially(
      ['pi_first', 'pi_second'],
      async (paymentIntentId) => {
        started.push(paymentIntentId);
        if (paymentIntentId === 'pi_first') await firstCompleted;
        return `${paymentIntentId}:complete`;
      },
    );

    await Promise.resolve();
    expect(started).toEqual(['pi_first']);

    releaseFirst?.();
    await expect(processing).resolves.toEqual([
      'pi_first:complete',
      'pi_second:complete',
    ]);
    expect(started).toEqual(['pi_first', 'pi_second']);
  });

  it('claims twelve order shells before thirteen standalone shells and preserves that order', async () => {
    const calls: Array<{ limit: number; scope: 'order' | 'standalone' }> = [];

    const claims = await claimCheckoutRecoveryShells(async (input) => {
      calls.push(input);
      return input.scope === 'order'
        ? [{ stripe_payment_intent_id: 'pi_order' }]
        : [{ stripe_payment_intent_id: 'pi_standalone' }];
    });

    expect(calls).toEqual([
      { limit: 12, scope: 'order' },
      { limit: 13, scope: 'standalone' },
    ]);
    expect(claims).toEqual([
      { stripe_payment_intent_id: 'pi_order' },
      { stripe_payment_intent_id: 'pi_standalone' },
    ]);
  });

  it('propagates a standalone claim failure instead of processing partial cron claims', async () => {
    const calls: Array<{ limit: number; scope: 'order' | 'standalone' }> = [];

    await expect(
      claimCheckoutRecoveryShells(async (input) => {
        calls.push(input);
        if (input.scope === 'standalone') throw new Error('claim failed');
        return [{ stripe_payment_intent_id: 'pi_order' }];
      }),
    ).rejects.toThrow('claim failed');

    expect(calls).toEqual([
      { limit: 12, scope: 'order' },
      { limit: 13, scope: 'standalone' },
    ]);
  });
});
