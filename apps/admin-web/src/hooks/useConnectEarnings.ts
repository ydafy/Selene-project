import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '@selene/types';

type ConnectEarningsViewRow =
  Database['public']['Views']['admin_connect_earnings_view']['Row'];

type ConnectEarningsResponse =
  | { success: true; rows: ConnectEarningsViewRow[] }
  | { success: false; error?: string };

export interface ConnectEarningsRow {
  id: string;
  seller_id: string;
  seller_name: string | null;
  stripe_payment_intent_id: string;
  amount: number;
  application_fee_amount: number;
  status: 'succeeded' | 'refunded' | 'failed';
  created_at: string | null;
}

function normalizeStatus(
  status: string | null,
): ConnectEarningsRow['status'] {
  if (status === 'succeeded' || status === 'refunded' || status === 'failed') {
    return status;
  }

  return 'failed';
}

function normalizeConnectEarningsRow(
  row: ConnectEarningsViewRow,
): ConnectEarningsRow | null {
  if (!row.id || !row.seller_id || !row.stripe_payment_intent_id) {
    return null;
  }

  return {
    id: row.id,
    seller_id: row.seller_id,
    seller_name: row.seller_name,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
    amount: row.amount ?? 0,
    application_fee_amount: row.application_fee_amount ?? 0,
    status: normalizeStatus(row.status),
    created_at: row.created_at,
  };
}

export function useConnectEarnings(search: string) {
  return useQuery({
    queryKey: ['connect-earnings', search],
    queryFn: async () => {
      const trimmedSearch = search.trim();

      const { data, error } =
        await supabase.functions.invoke<ConnectEarningsResponse>(
          'get-connect-earnings',
          { body: trimmedSearch ? { search: trimmedSearch } : {} },
        );

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('CONNECT_EARNINGS_FETCH_FAILED');
      }

      if (!data.success) {
        throw new Error(data.error ?? 'CONNECT_EARNINGS_FETCH_FAILED');
      }

      return data.rows
        .map(normalizeConnectEarningsRow)
        .filter((row): row is ConnectEarningsRow => row !== null);
    },
    refetchInterval: 30000,
  });
}
