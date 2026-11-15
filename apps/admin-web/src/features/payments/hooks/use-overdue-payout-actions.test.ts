import { beforeEach, expect, it, mock } from 'bun:test';

// Keep query/provider mocks out of the shared Bun module cache.
if (process.env.OVERDUE_HOOK_CHILD !== '1') {
  it('checks the overdue payout action hooks in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { OVERDUE_HOOK_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  type MutationOptions = {
    mutationFn: (input: unknown) => Promise<unknown>;
    onSuccess?: (result: unknown) => Promise<void> | void;
    onError?: (error: unknown) => Promise<void> | void;
  };
  let mutationPending = false;
  const invalidations: unknown[] = [];
  const toasts: Array<[string, string]> = [];
  const apiCalls: unknown[][] = [];
  let apiError: unknown = null;
  let refundStatus: 'refunded' | 'pending' = 'refunded';

  mock.module('@tanstack/react-query', () => ({
    useMutation: (options: MutationOptions) => ({
      isPending: mutationPending,
      mutateAsync: async (input: unknown) => {
        try {
          const result = await options.mutationFn(input);
          await options.onSuccess?.(result);
          return result;
        } catch (error) {
          await options.onError?.(error);
          throw error;
        }
      },
    }),
    useQueryClient: () => ({
      invalidateQueries: async (filters: unknown) => {
        invalidations.push(filters);
      },
    }),
  }));
  mock.module('sonner', () => ({
    toast: {
      success: (message: string) => toasts.push(['success', message]),
      info: (message: string) => toasts.push(['info', message]),
    },
  }));
  mock.module('../lib/overdue-payouts-api', () => ({
    recordPayoutHoldNote: async (...args: unknown[]) => {
      apiCalls.push(['note', ...args]);
      if (apiError) throw apiError;
      return {
        id: 'note-1',
        shipmentId: args[0],
        note: args[1],
        notedAt: '2026-11-14T05:27:34.123456+00:00',
        notedBy: 'admin-1',
      };
    },
    refundOverduePayout: async (...args: unknown[]) => {
      apiCalls.push(['refund', ...args]);
      if (apiError) throw apiError;
      return {
        status: refundStatus,
        shipmentId: args[0],
        refundId: 're_1',
        amountCents: 10600,
      };
    },
  }));
  const { useRecordPayoutHoldNote, useRefundOverduePayout } =
    await import('./use-overdue-payout-actions');

  const queue = { queryKey: ['connect-payout-release-queue'] };
  const refundProblems = { queryKey: ['shipment-refund-problems'] };

  beforeEach(() => {
    mutationPending = false;
    invalidations.length = 0;
    toasts.length = 0;
    apiCalls.length = 0;
    apiError = null;
    refundStatus = 'refunded';
  });

  it('records the note with the exact arguments and refreshes the queue', async () => {
    const { record } = useRecordPayoutHoldNote();
    const stored = await record('ship-1', 'Sigue en revisión');
    expect(stored).toMatchObject({ shipmentId: 'ship-1' });
    expect(apiCalls).toEqual([['note', 'ship-1', 'Sigue en revisión']]);
    expect(invalidations).toEqual([queue]);
    expect(toasts).toEqual([
      ['success', 'Nota guardada; el pago sigue retenido.'],
    ]);
  });

  it('neither refreshes nor confirms a refused note', async () => {
    apiError = Object.assign(new Error('x'), { code: 'PAYOUT_NOT_OVERDUE' });
    const { record } = useRecordPayoutHoldNote();
    await expect(record('ship-1', 'x')).rejects.toThrow();
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('sends only the shipment id for a refund and refreshes the queue', async () => {
    const { refund } = useRefundOverduePayout();
    expect((await refund('ship-1')).status).toBe('refunded');
    expect(apiCalls).toEqual([['refund', 'ship-1']]);
    expect(invalidations).toEqual([queue]);
    expect(toasts[0][0]).toBe('success');
  });

  it('reports a pending refund as pending in Stripe, not as refunded', async () => {
    refundStatus = 'pending';
    const { refund } = useRefundOverduePayout();
    await refund('ship-1');
    expect(invalidations).toEqual([queue]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0][0]).toBe('info');
    expect(toasts[0][1]).toContain('pendiente en Stripe');
  });

  it('refreshes the queue and the refund problems when Stripe failed the refund', async () => {
    apiError = Object.assign(new Error('x'), { code: 'REFUND_FAILED' });
    const { refund } = useRefundOverduePayout();
    await expect(refund('ship-1')).rejects.toThrow();
    expect(invalidations).toEqual([queue, refundProblems]);
    expect(toasts).toEqual([]);
  });

  it('refreshes the queue after any other refusal, without confirming', async () => {
    apiError = Object.assign(new Error('x'), {
      code: 'SELLER_ACCOUNT_NOT_REJECTED',
    });
    const { refund } = useRefundOverduePayout();
    await expect(refund('ship-1')).rejects.toThrow();
    expect(invalidations).toEqual([queue]);
    expect(toasts).toEqual([]);
  });

  it('exposes the pending state of both actions', () => {
    mutationPending = true;
    expect(useRecordPayoutHoldNote().isPending).toBe(true);
    expect(useRefundOverduePayout().isPending).toBe(true);
  });
}
