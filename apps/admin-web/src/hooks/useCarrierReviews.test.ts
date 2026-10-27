import { beforeEach, expect, it, mock } from 'bun:test';

// Keep query/provider mocks out of the shared Bun module cache.
if (process.env.B44D_HOOK_CHILD !== '1') {
  it('checks the carrier reviews hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B44D_HOOK_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  type QueryOptions = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };
  type MutationOptions = {
    mutationFn: (input: unknown) => Promise<unknown>;
    onSuccess?: (result: unknown) => Promise<void> | void;
  };
  let queryOptions: QueryOptions;
  let queryState: Record<string, unknown>;
  let mutationPending = false;
  const invalidations: unknown[] = [];
  const toasts: Array<[string, string]> = [];
  const resolveCalls: unknown[][] = [];
  let resolveResult: unknown;
  let resolveError: Error | null;

  mock.module('@tanstack/react-query', () => ({
    useQuery: (options: QueryOptions) => {
      queryOptions = options;
      return { ...queryState, refetch: async () => undefined };
    },
    useMutation: (options: MutationOptions) => ({
      isPending: mutationPending,
      mutateAsync: async (input: unknown) => {
        const result = await options.mutationFn(input);
        await options.onSuccess?.(result);
        return result;
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
  mock.module('../services/carrierReviews', () => ({
    fetchCarrierReviews: async () => [{ shipmentId: 'ship-1' }],
    resolveCarrierReview: async (...args: unknown[]) => {
      resolveCalls.push(args);
      if (resolveError) throw resolveError;
      return resolveResult;
    },
  }));
  const { useCarrierReviews, useResolveCarrierReview, CARRIER_REVIEWS_KEY } = await import('./useCarrierReviews');

  beforeEach(() => {
    queryState = { data: undefined, isLoading: false, isError: false };
    mutationPending = false;
    invalidations.length = 0;
    toasts.length = 0;
    resolveCalls.length = 0;
    resolveError = null;
    resolveResult = {
      resolution: 'closed_no_refund', resolvedAt: '2026-10-22T12:00:00.000Z', note: 'ok', labelCostLossCents: null,
    };
  });

  it('queries the service under a stable key', async () => {
    useCarrierReviews();
    expect(queryOptions.queryKey).toEqual(['carrier-reviews']);
    expect(CARRIER_REVIEWS_KEY).toEqual(['carrier-reviews']);
    expect(await queryOptions.queryFn()).toEqual([{ shipmentId: 'ship-1' }]);
  });

  it('keeps unknown data apart from an empty list so counts are never invented', () => {
    queryState = { data: undefined, isLoading: true, isError: false };
    const loading = useCarrierReviews();
    expect(loading.isLoading).toBe(true);
    expect(loading.count).toBeNull();
    expect(loading.reviews).toEqual([]);
    queryState = { data: [], isLoading: false, isError: false };
    expect(useCarrierReviews().count).toBe(0);
    queryState = { data: [{ shipmentId: 'a' }, { shipmentId: 'b' }], isLoading: false, isError: false };
    expect(useCarrierReviews().count).toBe(2);
    queryState = { data: undefined, isLoading: false, isError: true };
    const failed = useCarrierReviews();
    expect(failed.isError).toBe(true);
    expect(failed.count).toBeNull();
  });

  it('resolves with the exact arguments, invalidates the query and confirms', async () => {
    const { resolve } = useResolveCarrierReview();
    expect(await resolve('ship-1', 'closed_no_refund', 'ok')).toEqual(resolveResult);
    expect(resolveCalls).toEqual([['ship-1', 'closed_no_refund', 'ok']]);
    expect(invalidations).toEqual([{ queryKey: ['carrier-reviews'] }]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0][0]).toBe('success');
    expect(toasts[0][1]).toContain('sin reembolso');
  });

  it('says the refund runs on the next automatic cycle when it is approved', async () => {
    resolveResult = {
      resolution: 'refund_approved', resolvedAt: '2026-10-22T12:00:00.000Z', note: 'ok', labelCostLossCents: 15000,
    };
    const { resolve } = useResolveCarrierReview();
    await resolve('ship-1', 'refund_approved', 'ok');
    expect(toasts).toHaveLength(1);
    expect(toasts[0][1]).toContain('automático');
  });

  it('does not invalidate or confirm when the server rejects', async () => {
    resolveError = new Error('CARRIER_REVIEW_NOT_PENDING');
    const { resolve } = useResolveCarrierReview();
    await expect(resolve('ship-1', 'closed_no_refund', 'ok')).rejects.toThrow('CARRIER_REVIEW_NOT_PENDING');
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('exposes the pending state', () => {
    mutationPending = true;
    expect(useResolveCarrierReview().isPending).toBe(true);
  });
}
