import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { EdgeFunctionRegistry } from '@selene/types';
import {
  normalizeSellerOnboardingRow,
  type SellerOnboardingRow,
  type SellerOnboardingViewRow,
} from '../lib/connectOnboarding';

type SellerOnboardingResponse =
  | { success: true; rows: SellerOnboardingViewRow[] }
  | { success: false; error?: string };

export const SELLER_ONBOARDING_REFETCH_INTERVAL_MS = 30_000;

export function useSellerOnboarding() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['seller-onboarding'],
    queryFn: async () => {
      const { data, error } =
        await supabase.functions.invoke<SellerOnboardingResponse>(
          'get-seller-onboarding',
          { body: {} },
        );

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('SELLER_ONBOARDING_FETCH_FAILED');
      }

      if (!data.success) {
        throw new Error(data.error ?? 'SELLER_ONBOARDING_FETCH_FAILED');
      }

      return data.rows
        .map(normalizeSellerOnboardingRow)
        .filter((row): row is SellerOnboardingRow => row !== null);
    },
    refetchInterval: SELLER_ONBOARDING_REFETCH_INTERVAL_MS,
  });

  const refreshSellerMutation = useMutation({
    mutationFn: async (sellerId: string) => {
      const { data, error } = await supabase.functions.invoke<
        EdgeFunctionRegistry['refresh-connect-account-status']['response']
      >('refresh-connect-account-status', {
        body: { sellerId, force: true } satisfies EdgeFunctionRegistry['refresh-connect-account-status']['payload'],
      });

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('CONNECT_STATUS_REFRESH_FAILED');
      }

      if (data.error) {
        throw new Error(data.error);
      }

      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-onboarding'] });
    },
  });

  return {
    ...query,
    refreshSeller: refreshSellerMutation.mutateAsync,
    isRefreshingSeller: refreshSellerMutation.isPending,
    refreshingSellerId: refreshSellerMutation.variables,
  };
}
