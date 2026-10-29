import { beforeEach, expect, it, mock } from 'bun:test';

// Keep query/provider mocks out of the shared Bun module cache.
if (process.env.B61C_HOOK_CHILD !== '1') {
  it('checks the label reconciliations hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B61C_HOOK_CHILD: '1' },
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
    onSuccess?: (result: unknown, input: unknown) => Promise<void> | void;
    onError?: (error: unknown) => Promise<void> | void;
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
        try {
          const result = await options.mutationFn(input);
          await options.onSuccess?.(result, input);
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
  mock.module('../services/labelReconciliations', () => ({
    fetchLabelReconciliations: async () => [{ shipmentId: 'ship-1' }],
    resolveLabelReconciliation: async (...args: unknown[]) => {
      resolveCalls.push(args);
      if (resolveError) throw resolveError;
      return resolveResult;
    },
  }));
  const { useLabelReconciliations, useResolveLabelReconciliation, LABEL_RECONCILIATIONS_KEY } =
    await import('./useLabelReconciliations');

  beforeEach(() => {
    queryState = { data: undefined, isLoading: false, isError: false };
    mutationPending = false;
    invalidations.length = 0;
    toasts.length = 0;
    resolveCalls.length = 0;
    resolveError = null;
    resolveResult = { resolution: 'no_label', status: 'paid', labelGenerationState: 'unclaimed' };
  });

  const noLabel = { shipmentId: 'ship-1', resolution: 'no_label', note: 'ok' } as const;

  it('queries the service under a stable key', async () => {
    useLabelReconciliations();
    expect(queryOptions.queryKey).toEqual(['label-reconciliations']);
    expect(LABEL_RECONCILIATIONS_KEY).toEqual(['label-reconciliations']);
    expect(await queryOptions.queryFn()).toEqual([{ shipmentId: 'ship-1' }]);
  });

  it('keeps unknown data apart from an empty list so counts are never invented', () => {
    queryState = { data: undefined, isLoading: true, isError: false };
    const loading = useLabelReconciliations();
    expect(loading.isLoading).toBe(true);
    expect(loading.count).toBeNull();
    expect(loading.cases).toEqual([]);
    queryState = { data: [], isLoading: false, isError: false };
    expect(useLabelReconciliations().count).toBe(0);
    queryState = { data: [{ shipmentId: 'a' }, { shipmentId: 'b' }], isLoading: false, isError: false };
    expect(useLabelReconciliations().count).toBe(2);
    queryState = { data: undefined, isLoading: false, isError: true };
    const failed = useLabelReconciliations();
    expect(failed.isError).toBe(true);
    expect(failed.count).toBeNull();
  });

  it('resolves with the exact input, refreshes the list and confirms in plain words', async () => {
    const { resolve } = useResolveLabelReconciliation();
    expect(await resolve(noLabel)).toEqual(resolveResult);
    expect(resolveCalls).toEqual([[noLabel]]);
    expect(invalidations).toEqual([{ queryKey: ['label-reconciliations'] }]);
    expect(toasts).toEqual([['success', 'Envío liberado: el vendedor puede generar la guía de nuevo']]);
  });

  it('confirms a found label with its own message', async () => {
    resolveResult = { resolution: 'label_found', status: 'preparing', labelGenerationState: 'generated' };
    const { resolve } = useResolveLabelReconciliation();
    await resolve({
      shipmentId: 'ship-1',
      resolution: 'label_found',
      note: 'ok',
      enviaShipmentId: '1',
      trackingNumber: 'T',
      labelUrl: 'https://x.example/l.pdf',
      providerCostCents: 100,
    });
    expect(toasts).toEqual([['success', 'Guía registrada: el envío sigue su curso']]);
  });

  it('does not refresh or confirm when the server rejects', async () => {
    resolveError = Object.assign(new Error('INVALID_PROVIDER_RESULT'), { code: 'INVALID_PROVIDER_RESULT' });
    const { resolve } = useResolveLabelReconciliation();
    await expect(resolve(noLabel)).rejects.toThrow('INVALID_PROVIDER_RESULT');
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('refreshes the list when the shipment was already resolved', async () => {
    resolveError = Object.assign(new Error('conflict'), { code: 'ALREADY_RESOLVED' });
    const { resolve } = useResolveLabelReconciliation();
    await expect(resolve(noLabel)).rejects.toThrow('conflict');
    expect(invalidations).toEqual([{ queryKey: ['label-reconciliations'] }]);
    expect(toasts).toEqual([]);
  });

  it('exposes the pending state', () => {
    mutationPending = true;
    expect(useResolveLabelReconciliation().isPending).toBe(true);
  });
}
