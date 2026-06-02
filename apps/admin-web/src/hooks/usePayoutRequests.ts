import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Enums } from '@selene/types';

export interface PayoutOverviewRow {
  id: string;
  user_id: string;
  seller_name: string;
  amount: number;
  status: Enums<'payout_status'>;
  clabe: string;
  bank_name: string;
  is_verified: boolean;
  account_holder_name: string;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  completed_at: string | null;
  rejected_reason: string | null;
  rejected_at: string | null;
  processed_by_name: string | null;
}

export type PayoutStatus = Enums<'payout_status'>;
export type SortField = 'amount' | 'requested_at';
export type SortDir = 'asc' | 'desc';

export interface UsePayoutRequestsParams {
  status: PayoutStatus | 'all';
  search: string;
  sortBy: SortField;
  sortDir: SortDir;
}

export function usePayoutRequests(params: UsePayoutRequestsParams) {
  return useQuery({
    queryKey: ['admin-payments', params.status, params.search, params.sortBy, params.sortDir],
    queryFn: async () => {
      let query = supabase
        .from('admin_payments_overview')
        .select('*');

      // Filter by status
      if (params.status !== 'all') {
        query = query.eq('status', params.status);
      }

      // Search by seller name
      if (params.search.trim()) {
        query = query.ilike('seller_name', `%${params.search.trim()}%`);
      }

      // Sort
      query = query.order(params.sortBy, {
        ascending: params.sortDir === 'asc',
      });

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PayoutOverviewRow[];
    },
    refetchInterval: 30000,
  });
}
