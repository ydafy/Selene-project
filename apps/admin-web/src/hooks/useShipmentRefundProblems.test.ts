import { beforeEach, expect, it, mock } from 'bun:test';

// Keep query/provider mocks out of the shared Bun module cache.
if (process.env.B24_HOOK_CHILD !== '1') {
  it('checks the refund problems hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B24_HOOK_CHILD: '1' },
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
  mock.module('../services/shipmentRefunds', () => ({
    fetchShipmentRefundProblems: async () => [{ shipmentId: 'ship-1' }],
    resolveShipmentRefund: async (...args: unknown[]) => {
      resolveCalls.push(args);
      if (resolveError) throw resolveError;
      return resolveResult;
    },
  }));
  const { useShipmentRefundProblems, useResolveShipmentRefund, SHIPMENT_REFUND_PROBLEMS_KEY } =
    await import('./useShipmentRefundProblems');

  beforeEach(() => {
    queryState = { data: undefined, isLoading: false, isError: false };
    mutationPending = false;
    invalidations.length = 0;
    toasts.length = 0;
    resolveCalls.length = 0;
    resolveError = null;
    resolveResult = { resolved: true, shipmentCancelled: true, amountOwedCents: 5000, reference: 'SPEI-1' };
  });

  it('queries the service under a stable key', async () => {
    useShipmentRefundProblems();
    expect(queryOptions.queryKey).toEqual(['shipment-refund-problems']);
    expect(SHIPMENT_REFUND_PROBLEMS_KEY).toEqual(['shipment-refund-problems']);
    expect(await queryOptions.queryFn()).toEqual([{ shipmentId: 'ship-1' }]);
  });

  it('keeps unknown data apart from an empty list so counts are never invented', () => {
    queryState = { data: undefined, isLoading: true, isError: false };
    const loading = useShipmentRefundProblems();
    expect(loading.isLoading).toBe(true);
    expect(loading.count).toBeNull();
    expect(loading.problems).toEqual([]);
    queryState = { data: [], isLoading: false, isError: false };
    expect(useShipmentRefundProblems().count).toBe(0);
    queryState = { data: [{ shipmentId: 'a' }, { shipmentId: 'b' }], isLoading: false, isError: false };
    expect(useShipmentRefundProblems().count).toBe(2);
    queryState = { data: undefined, isLoading: false, isError: true };
    const failed = useShipmentRefundProblems();
    expect(failed.isError).toBe(true);
    expect(failed.count).toBeNull();
  });

  it('resolves with the exact arguments, invalidates the query and confirms', async () => {
    const { resolve } = useResolveShipmentRefund();
    expect(await resolve('ship-1', 'SPEI-1')).toEqual(resolveResult);
    expect(resolveCalls).toEqual([['ship-1', 'SPEI-1']]);
    expect(invalidations).toEqual([{ queryKey: ['shipment-refund-problems'] }]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0][0]).toBe('success');
  });

  it('tells the admin when the refund was already resolved and still refreshes', async () => {
    resolveResult = { resolved: false, shipmentCancelled: true, amountOwedCents: 5000, reference: 'SPEI-OLD' };
    const { resolve } = useResolveShipmentRefund();
    await resolve('ship-1', 'SPEI-NEW');
    expect(invalidations).toEqual([{ queryKey: ['shipment-refund-problems'] }]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0][0]).toBe('info');
    expect(toasts[0][1]).toContain('SPEI-OLD');
    expect(toasts[0][1]).not.toContain('SPEI-NEW');
  });

  it('does not invalidate or confirm when the server rejects', async () => {
    resolveError = new Error('REFUND_NOT_RESOLVABLE');
    const { resolve } = useResolveShipmentRefund();
    await expect(resolve('ship-1', 'SPEI-1')).rejects.toThrow('REFUND_NOT_RESOLVABLE');
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('exposes the pending state', () => {
    mutationPending = true;
    expect(useResolveShipmentRefund().isPending).toBe(true);
  });
}
