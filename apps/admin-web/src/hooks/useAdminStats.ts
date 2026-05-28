import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const useAdminStats = () => {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
      );

      const [pendingResult, disputeResult, walletResult, salesResult] =
        await Promise.all([
          supabase
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'IN_REVIEW'),
          supabase
            .from('disputes')
            .select('*', { count: 'exact', head: true })
            .in('status', ['open', 'under_review']),
          supabase.from('wallets').select('sum:available_balance'),
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', startOfMonth.toISOString())
            .not('status', 'eq', 'cancelled')
            .not('status', 'eq', 'refunded'),
        ]);

      const totalToPay = walletResult.data?.[0]?.sum ?? 0;

      return {
        pendingProducts: pendingResult.count || 0,
        activeDisputes: disputeResult.count || 0,
        totalToPay,
        monthlySalesCount: salesResult.count || 0,
      };
    },
    refetchInterval: 1000 * 60 * 2, // Auto-refrescar cada 2 min
  });
};
