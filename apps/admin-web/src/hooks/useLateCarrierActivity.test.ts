import { beforeEach, expect, it, mock } from 'bun:test';

// Keep query/provider mocks out of the shared Bun module cache.
if (process.env.B58B_HOOK_CHILD !== '1') {
  it('checks the late carrier activity hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B58B_HOOK_CHILD: '1' },
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
  const acknowledgeCalls: unknown[][] = [];
  let acknowledgeResult: unknown;
  let acknowledgeError: Error | null;

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
  mock.module('../services/lateCarrierActivity', () => ({
    fetchLateCarrierActivity: async () => [{ shipmentId: 'ship-1' }],
    acknowledgeLateCarrierActivity: async (...args: unknown[]) => {
      acknowledgeCalls.push(args);
      if (acknowledgeError) throw acknowledgeError;
      return acknowledgeResult;
    },
  }));
  const { useLateCarrierActivity, useAcknowledgeLateCarrierActivity, LATE_CARRIER_ACTIVITY_KEY } =
    await import('./useLateCarrierActivity');

  beforeEach(() => {
    queryState = { data: undefined, isLoading: false, isError: false };
    mutationPending = false;
    invalidations.length = 0;
    toasts.length = 0;
    acknowledgeCalls.length = 0;
    acknowledgeError = null;
    acknowledgeResult = { acknowledgedAt: '2026-10-22T12:00:00.000Z', note: 'ok', alreadyAcknowledged: false };
  });

  it('queries the service under a stable key', async () => {
    useLateCarrierActivity();
    expect(queryOptions.queryKey).toEqual(['late-carrier-activity']);
    expect(LATE_CARRIER_ACTIVITY_KEY).toEqual(['late-carrier-activity']);
    expect(await queryOptions.queryFn()).toEqual([{ shipmentId: 'ship-1' }]);
  });

  it('keeps unknown data apart from an empty list so counts are never invented', () => {
    queryState = { data: undefined, isLoading: true, isError: false };
    const loading = useLateCarrierActivity();
    expect(loading.isLoading).toBe(true);
    expect(loading.count).toBeNull();
    expect(loading.cases).toEqual([]);
    queryState = { data: [], isLoading: false, isError: false };
    expect(useLateCarrierActivity().count).toBe(0);
    queryState = { data: [{ shipmentId: 'a' }, { shipmentId: 'b' }], isLoading: false, isError: false };
    expect(useLateCarrierActivity().count).toBe(2);
    queryState = { data: undefined, isLoading: false, isError: true };
    const failed = useLateCarrierActivity();
    expect(failed.isError).toBe(true);
    expect(failed.count).toBeNull();
  });

  it('acknowledges with the exact arguments, invalidates the query and confirms', async () => {
    const { acknowledge } = useAcknowledgeLateCarrierActivity();
    expect(await acknowledge('ship-1', 'ok')).toEqual(acknowledgeResult);
    expect(acknowledgeCalls).toEqual([['ship-1', 'ok']]);
    expect(invalidations).toEqual([{ queryKey: ['late-carrier-activity'] }]);
    expect(toasts).toEqual([['success', 'Caso marcado como revisado']]);
  });

  it('does not invalidate or confirm when the server rejects', async () => {
    acknowledgeError = new Error('LATE_CARRIER_ACTIVITY_NOT_FOUND');
    const { acknowledge } = useAcknowledgeLateCarrierActivity();
    await expect(acknowledge('ship-1', 'ok')).rejects.toThrow('LATE_CARRIER_ACTIVITY_NOT_FOUND');
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('exposes the pending state', () => {
    mutationPending = true;
    expect(useAcknowledgeLateCarrierActivity().isPending).toBe(true);
  });
}
