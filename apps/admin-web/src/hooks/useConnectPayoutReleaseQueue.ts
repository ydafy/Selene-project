import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
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
import { formatConnectPayoutReleaseError } from '../lib/connectPayoutReleaseErrors';

export const CONNECT_PAYOUT_RELEASE_QUEUE_KEY = [
  'connect-payout-release-queue',
] as const;

interface ReleaseSelectedShipmentsInput {
  batch: ReleaseQueueBatch;
  shipmentIds: string[];
}

async function fetchConnectPayoutReleaseQueue(search: string) {
  const trimmedSearch = search.trim();
  const { data, error } =
    await supabase.functions.invoke<ConnectPayoutReleaseQueueResponse>(
      'get-connect-payout-release-queue',
      { body: trimmedSearch ? { search: trimmedSearch } : {} },
    );

  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.error ?? 'CONNECT_PAYOUT_RELEASE_QUEUE_FAILED');
  }

  return mapConnectPayoutReleaseQueue(data.rows ?? []);
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

export function useConnectPayoutReleaseQueue(search: string) {
  const queryClient = useQueryClient();
  const queueQuery = useQuery({
    queryKey: [...CONNECT_PAYOUT_RELEASE_QUEUE_KEY, search],
    queryFn: () => fetchConnectPayoutReleaseQueue(search),
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
    batches: queueQuery.data?.releaseBatches ?? [],
    processingRuns: queueQuery.data?.processingRuns ?? [],
    actionRequiredRuns: queueQuery.data?.actionRequiredRuns ?? [],
    historyRuns: queueQuery.data?.historyRuns ?? [],
    isLoading: queueQuery.isLoading,
    isError: queueQuery.isError,
    error: queueQuery.error,
    refetch: queueQuery.refetch,
    releaseSelectedShipments: releaseMutation.mutateAsync,
    isReleasing: releaseMutation.isPending,
    retryFailedPayout: retryMutation.mutateAsync,
    isRetrying: retryMutation.isPending,
  };
}
