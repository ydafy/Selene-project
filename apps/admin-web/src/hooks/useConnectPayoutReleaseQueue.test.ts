import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { formatConnectPayoutReleaseError } from '../lib/connectPayoutReleaseErrors';
import type {
  ReleaseConnectPayoutResponse,
  ConnectPayoutReleaseQueueResponse,
  ConnectPayoutReleaseQueueRow,
} from '@selene/types';
import type { ReleaseQueueBatch } from '../lib/connectPayoutReleaseQueue';

// Keep query/provider mocks out of the shared Bun module cache.
if (process.env.A65_HOOK_CHILD !== '1') {
  it('checks the payout queue hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { A65_HOOK_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
const offlineFetch: typeof fetch = Object.assign(() => {
  throw new Error('Unexpected external request');
}, {
  preconnect: () => { throw new Error('Unexpected external preconnect'); },
});
const denyFetch = spyOn(globalThis, 'fetch').mockImplementation(offlineFetch);
afterAll(() => denyFetch.mockRestore());

type InvocationResult = {
  data: ReleaseConnectPayoutResponse | ConnectPayoutReleaseQueueResponse | null;
  error: Error | null;
};

type MutationOptions = {
  mutationFn: (input: unknown) => Promise<ReleaseConnectPayoutResponse>;
  onSuccess?: (result: ReleaseConnectPayoutResponse) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

const invokeCalls: Array<{ functionName: string; body: unknown }> = [];
const invalidationCalls: unknown[] = [];
const successMessages: string[] = [];
const errorMessages: string[] = [];
let invocationResult: InvocationResult;
type QueryOptions = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; refetchInterval: number };
let queryOptions: QueryOptions;
let queryState = { data: undefined, error: null as Error | null, isError: false, isLoading: false };
const queueRow: ConnectPayoutReleaseQueueRow = {
  completed_at: null, ineligible_reason: null, is_eligible: false, is_retryable: false,
  order_id: 'order-1', payout_run_amount_cents: 12500, payout_run_failed_at: null,
  payout_run_failure_reason: null, payout_run_id: 'run-1', payout_run_status: 'paid',
  release_amount_cents: 12500, requires_manual_review: false, retry_of_run_id: null,
  seller_id: 'seller-1', seller_name: 'Selene Seller', shipment_id: 'shipment-1',
  status: 'completed', stripe_account_id: 'acct_123', stripe_onboarding_status: 'complete',
  stripe_payment_intent_id: 'pi_123', stripe_transfer_id: null, transfer_group: null,
};

mock.module('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      try {
        const result = await options.mutationFn(input);
        await options.onSuccess?.(result);
        return result;
      } catch (error) {
        options.onError?.(error);
        throw error;
      }
    },
  }),
  useQuery: (options: QueryOptions) => {
    queryOptions = options;
    return { ...queryState, refetch: async () => undefined };
  },
  useQueryClient: () => ({
    invalidateQueries: async (filters: unknown) => {
      invalidationCalls.push(filters);
    },
  }),
}));

mock.module('sonner', () => ({
  toast: {
    error: (message: string) => errorMessages.push(message),
    success: (message: string) => successMessages.push(message),
  },
}));

mock.module('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: async (functionName: string, options: { body: unknown }) => {
        if (!['get-connect-payout-release-queue', 'release-connect-payout'].includes(functionName)) {
          throw new Error('Unexpected external request');
        }
        invokeCalls.push({ functionName, body: options.body });
        return invocationResult;
      },
    },
  },
}));

const loadHook = () => import('./useConnectPayoutReleaseQueue');

const releaseBatch: ReleaseQueueBatch = {
  sellerId: 'seller-1',
  sellerName: 'Selene Seller',
  stripeAccountId: 'acct_123',
  totalEligibleAmountCents: 12_500,
  eligibleShipmentCount: 1,
  ineligibleShipmentCount: 0,
  releaseState: 'ready',
  shipments: [
    {
      completedAt: '2026-06-22T10:00:00.000Z',
      ineligibleReason: null,
      isEligible: true,
      orderId: 'order-1',
      releaseAmountCents: 12_500,
      reconciliationIndicator: 'ready_for_release',
      shipmentId: 'shipment-1',
      status: 'completed',
      stripePaymentIntentId: 'pi_123',
    },
  ],
};

beforeEach(() => {
  queryState = { data: undefined, error: null, isError: false, isLoading: false };
  invokeCalls.length = 0;
  invalidationCalls.length = 0;
  successMessages.length = 0;
  errorMessages.length = 0;
  invocationResult = {
    data: {
      success: true,
      runId: 'run-default',
      status: 'pending_reconciliation',
      amount: 12_500,
    },
    error: null,
  };
});

describe('formatConnectPayoutReleaseError', () => {
  it('returns retryable funds-pending guidance for Stripe balance insufficiency', () => {
    const response = {
      success: false,
      error: 'Raw Stripe balance text should not be shown',
      code: 'stripe_balance_insufficient',
      retryable: true,
      required_amount_cents: 10_000,
      available_amount_cents: 7_500,
      currency: 'mxn',
    } satisfies ReleaseConnectPayoutResponse;

    expect(formatConnectPayoutReleaseError(response)).toBe(
      'Funds pending/not yet available in Stripe. Retry when available. Required: MXN 100.00. Available: MXN 75.00.',
    );
  });

  it('falls back to the backend error for non-balance release failures', () => {
    expect(
      formatConnectPayoutReleaseError({
        success: false,
        error: 'SHIPMENT_NOT_COMPLETED',
      }),
    ).toBe('SHIPMENT_NOT_COMPLETED');
  });
});

describe('useConnectPayoutReleaseQueue query pipeline', () => {
  it('executes the real query function, trims search, maps rows, and polls every 30 seconds', async () => {
    invocationResult = { data: { success: true, rows: [queueRow] }, error: null };
    const { useConnectPayoutReleaseQueue } = await loadHook();
    useConnectPayoutReleaseQueue('  Selene Seller  ');
    expect(queryOptions.queryKey).toEqual(['connect-payout-release-queue', '  Selene Seller  ']);
    expect(queryOptions.refetchInterval).toBe(30000);
    const result = await queryOptions.queryFn() as { historyRuns: Array<{ runId: string }> };
    expect(result.historyRuns.map((run) => run.runId)).toEqual(['run-1']);
    expect(invokeCalls).toEqual([{ functionName: 'get-connect-payout-release-queue', body: { search: 'Selene Seller' } }]);
  });

  it('sends no search field for whitespace-only input and maps an empty result', async () => {
    invocationResult = { data: { success: true }, error: null };
    const { useConnectPayoutReleaseQueue } = await loadHook();
    useConnectPayoutReleaseQueue('  ');
    expect(await queryOptions.queryFn()).toEqual({ releaseBatches: [], processingRuns: [], actionRequiredRuns: [], historyRuns: [] });
    expect(invokeCalls).toEqual([{ functionName: 'get-connect-payout-release-queue', body: {} }]);
  });

  it('forwards initial/new-key loading and query errors instead of hiding them behind default arrays', async () => {
    const { useConnectPayoutReleaseQueue } = await loadHook();
    queryState.isLoading = true;
    const initial = useConnectPayoutReleaseQueue('');
    expect(initial.isLoading).toBe(true);
    expect(initial.processingRuns).toEqual([]);
    const search = useConnectPayoutReleaseQueue('new seller');
    expect(search.isLoading).toBe(true);
    expect(queryOptions.queryKey).toEqual(['connect-payout-release-queue', 'new seller']);
    const error = new Error('Queue unavailable');
    queryState = { data: undefined, isLoading: false, isError: true, error };
    const failed = useConnectPayoutReleaseQueue('new seller');
    expect(failed.isError).toBe(true);
    expect(failed.error).toBe(error);
  });

  it('rejects transport, backend, and missing-response failures from the executed query', async () => {
    const { useConnectPayoutReleaseQueue } = await loadHook();
    useConnectPayoutReleaseQueue('');
    invocationResult = { data: null, error: new Error('Transport unavailable') };
    await expect(queryOptions.queryFn()).rejects.toThrow('Transport unavailable');
    invocationResult = { data: { success: false, error: 'Queue denied' }, error: null };
    await expect(queryOptions.queryFn()).rejects.toThrow('Queue denied');
    invocationResult = { data: null, error: null };
    await expect(queryOptions.queryFn()).rejects.toThrow('CONNECT_PAYOUT_RELEASE_QUEUE_FAILED');
  });
});

describe('useConnectPayoutReleaseQueue payout mutations', () => {
  it('sends failed-run retries as a run-scoped request with no client-derived payout fields', async () => {
    const { useConnectPayoutReleaseQueue } = await loadHook();
    const queue = useConnectPayoutReleaseQueue('') as ReturnType<
      typeof useConnectPayoutReleaseQueue
    > & {
      retryFailedPayout?: (input: {
        retryRunId: string;
      }) => Promise<ReleaseConnectPayoutResponse>;
    };

    expect(typeof queue.retryFailedPayout).toBe('function');
    if (!queue.retryFailedPayout) return;

    await queue.retryFailedPayout({ retryRunId: 'run-failed' });

    expect(invokeCalls).toEqual([
      {
        functionName: 'release-connect-payout',
        body: { retryRunId: 'run-failed' },
      },
    ]);
    expect(Object.keys(invokeCalls[0].body as Record<string, unknown>)).toEqual([
      'retryRunId',
    ]);
  });

  it('uses retry-specific success feedback and invalidates the release queue', async () => {
    invocationResult = {
      data: {
        success: true,
        runId: 'run-retry-child',
        status: 'pending_reconciliation',
        amount: 12_500,
      },
      error: null,
    };
    const { CONNECT_PAYOUT_RELEASE_QUEUE_KEY, useConnectPayoutReleaseQueue } =
      await loadHook();
    const queue = useConnectPayoutReleaseQueue('') as ReturnType<
      typeof useConnectPayoutReleaseQueue
    > & {
      retryFailedPayout?: (input: {
        retryRunId: string;
      }) => Promise<ReleaseConnectPayoutResponse>;
    };

    expect(typeof queue.retryFailedPayout).toBe('function');
    if (!queue.retryFailedPayout) return;

    await queue.retryFailedPayout({ retryRunId: 'run-failed' });

    expect(successMessages).toEqual([
      'Payout retry queued: run-retry-child',
    ]);
    expect(invalidationCalls).toEqual([
      { queryKey: CONNECT_PAYOUT_RELEASE_QUEUE_KEY },
    ]);
  });

  it('keeps ordinary release success feedback distinct from failed-run retry feedback', async () => {
    invocationResult = {
      data: {
        success: true,
        runId: 'run-release',
        status: 'pending_reconciliation',
        amount: 12_500,
      },
      error: null,
    };
    const { CONNECT_PAYOUT_RELEASE_QUEUE_KEY, useConnectPayoutReleaseQueue } =
      await loadHook();
    const queue = useConnectPayoutReleaseQueue('');

    await queue.releaseSelectedShipments({
      batch: releaseBatch,
      shipmentIds: ['shipment-1'],
    });

    expect(invokeCalls).toEqual([{ functionName: 'release-connect-payout', body: {
      sellerId: 'seller-1', shipmentIds: ['shipment-1'], idempotencyKey: expect.any(String),
    } }]);
    expect(Object.keys(invokeCalls[0].body as Record<string, unknown>).sort()).toEqual([
      'idempotencyKey', 'sellerId', 'shipmentIds',
    ]);
    expect(successMessages).toEqual(['Payout release queued: run-release']);
    expect(invalidationCalls).toEqual([
      { queryKey: CONNECT_PAYOUT_RELEASE_QUEUE_KEY },
    ]);
  });

  it('uses retry-specific error feedback without falling back to ordinary release messaging', async () => {
    invocationResult = {
      data: null,
      error: new Error('Network unavailable'),
    };
    const { useConnectPayoutReleaseQueue } = await loadHook();
    const queue = useConnectPayoutReleaseQueue('') as ReturnType<
      typeof useConnectPayoutReleaseQueue
    > & {
      retryFailedPayout?: (input: {
        retryRunId: string;
      }) => Promise<ReleaseConnectPayoutResponse>;
    };

    expect(typeof queue.retryFailedPayout).toBe('function');
    if (!queue.retryFailedPayout) return;

    await expect(
      queue.retryFailedPayout({ retryRunId: 'run-failed' }),
    ).rejects.toThrow('Network unavailable');
    expect(errorMessages).toEqual([
      'Payout retry failed: Network unavailable',
    ]);
    expect(successMessages).toEqual([]);
    expect(invalidationCalls).toEqual([]);
  });
});
}

