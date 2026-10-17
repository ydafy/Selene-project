import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ConnectPayoutQueueBucket,
  ConnectPayoutReleaseQueueResponse,
  ConnectPayoutReleaseRequest,
  ReleaseConnectPayoutResponse,
} from '@selene/types';

import { supabase } from '../lib/supabase';
import {
  buildReleasePayload,
  createReleaseIdempotencyKey,
  mapConnectPayoutReleaseQueue,
  type ReleaseQueueBatch,
} from '../lib/connectPayoutReleaseQueue';
import { validatePayoutQueueResponse, type PayoutQueueRequest } from '../lib/connectPayoutQueuePagination';
import { formatConnectPayoutReleaseError } from '../lib/connectPayoutReleaseErrors';

export const CONNECT_PAYOUT_RELEASE_QUEUE_KEY = [
  'connect-payout-release-queue',
] as const;

interface ReleaseSelectedShipmentsInput {
  batch: ReleaseQueueBatch;
  shipmentIds: string[];
}

// Opaque read identities, not timestamps or claims about server snapshot order.
let queueReadRevision = 0;

async function fetchConnectPayoutReleaseQueue(search: string, request?: PayoutQueueRequest) {
  const revision = ++queueReadRevision;
  const trimmedSearch = search.trim();
  const { data, error } =
    await supabase.functions.invoke<ConnectPayoutReleaseQueueResponse>(
      'get-connect-payout-release-queue',
      { body: { ...(trimmedSearch ? { search: trimmedSearch } : {}), ...request } },
    );

  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.error ?? 'CONNECT_PAYOUT_RELEASE_QUEUE_FAILED');
  }

  if (request) {
    const pagination = validatePayoutQueueResponse(data, request);
    return { ...mapConnectPayoutReleaseQueue(pagination.rows), pagination, revision };
  }
  return { ...mapConnectPayoutReleaseQueue(data.rows ?? []), pagination: undefined, revision: undefined };
}

async function releaseConnectPayout(payload: ConnectPayoutReleaseRequest) {
  const { data, error } =
    await supabase.functions.invoke<ReleaseConnectPayoutResponse>(
      'release-connect-payout',
      { body: payload },
    );

  if (error) throw error;
  if (!data?.success) {
    throw new Error(
      data
        ? formatConnectPayoutReleaseError(data)
        : 'CONNECT_PAYOUT_RELEASE_FAILED',
    );
  }

  return data;
}

export function useConnectPayoutReleaseQueue(search: string, options?: { bucket: ConnectPayoutQueueBucket; page: number }) {
  const queryClient = useQueryClient();
  const queueQuery = useQuery({
    queryKey: [...CONNECT_PAYOUT_RELEASE_QUEUE_KEY, search, ...(options ? [options.bucket, options.page] : [])],
    queryFn: () => fetchConnectPayoutReleaseQueue(search, options ? { ...options, scope: 'page' } : undefined),
    refetchInterval: 30000,
  });

  const releaseMutation = useMutation({
    mutationFn: ({ batch, shipmentIds }: ReleaseSelectedShipmentsInput) => {
      const idempotencyKey = createReleaseIdempotencyKey(
        batch.sellerId,
        shipmentIds,
      );

      return releaseConnectPayout(
        buildReleasePayload({
          batch,
          selectedShipmentIds: shipmentIds,
          idempotencyKey,
        }),
      );
    },
    onSuccess: async (result) => {
      toast.success(`Payout release queued: ${result.runId}`);
      await queryClient.invalidateQueries({
        queryKey: CONNECT_PAYOUT_RELEASE_QUEUE_KEY,
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Connect payout release failed',
      );
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ retryRunId }: { retryRunId: string }) =>
      releaseConnectPayout({ retryRunId }),
    onSuccess: async (result) => {
      toast.success(`Payout retry queued: ${result.runId}`);
      await queryClient.invalidateQueries({
        queryKey: CONNECT_PAYOUT_RELEASE_QUEUE_KEY,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Payout retry failed: ${message}`);
    },
  });

  return {
    lastSuccessfulFetchAt: queueQuery.dataUpdatedAt > 0 ? queueQuery.dataUpdatedAt : null,
    pageRevision: queueQuery.data?.revision,
    pagination: queueQuery.data?.pagination,
    counts: queueQuery.data?.pagination?.counts,
    fetchSelection: () => {
      if (!options) throw new Error('La selección completa requiere una consulta paginada.');
      return fetchConnectPayoutReleaseQueue(search, { bucket: options.bucket, page: 0, scope: 'selection' });
    },
    batches: queueQuery.data?.releaseBatches ?? [],
    processingRuns: queueQuery.data?.processingRuns ?? [],
    actionRequiredRuns: queueQuery.data?.actionRequiredRuns ?? [],
    historyRuns: queueQuery.data?.historyRuns ?? [],
    isLoading: queueQuery.isLoading,
    isFetching: queueQuery.isFetching,
    isError: queueQuery.isError,
    error: queueQuery.error,
    refetch: queueQuery.refetch,
    releaseSelectedShipments: releaseMutation.mutateAsync,
    isReleasing: releaseMutation.isPending,
    retryFailedPayout: retryMutation.mutateAsync,
    isRetrying: retryMutation.isPending,
  };
}
