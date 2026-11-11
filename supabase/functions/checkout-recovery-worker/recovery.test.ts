import { describe, expect, it } from 'bun:test';

import * as recoveryModule from './recovery.ts';
import {
  buildRecoveryRefundParams,
  classifySettlementFailure,
  compensateRecoveryShell,
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
