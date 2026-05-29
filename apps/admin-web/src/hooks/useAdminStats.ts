import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

function calcTrend(current: number, previous: number) {
  if (previous === 0) return { direction: 'neutral' as const, percentage: 0 };
  const pct = Math.round(((current - previous) / previous) * 100);
  return {
    direction: (pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral') as 'up' | 'down' | 'neutral',
    percentage: Math.abs(pct),
  };
}

export const useAdminStats = () => {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
      );
      const startOfLastMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0),
      );
      const [
        pendingResult,
        prevPendingResult,
        disputeResult,
        prevDisputeResult,
        walletResult,
        salesResult,
        prevSalesResult,
        usersResult,
        totalProductsResult,
        verifiedProductsResult,
      ] = await Promise.all([
        // Current pending products (snapshot)
        supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'IN_REVIEW'),
        // Previous period pending inflow
        supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'IN_REVIEW')
          .gte('created_at', startOfLastMonth.toISOString())
          .lt('created_at', startOfMonth.toISOString()),
        // Current active disputes (snapshot)
        supabase
          .from('disputes')
          .select('*', { count: 'exact', head: true })
          .in('status', ['open', 'under_review']),
        // Previous period dispute inflow
        supabase
          .from('disputes')
          .select('*', { count: 'exact', head: true })
          .in('status', ['open', 'under_review'])
          .gte('created_at', startOfLastMonth.toISOString())
          .lt('created_at', startOfMonth.toISOString()),
        // Total available balance
        supabase.from('wallets').select('sum:available_balance'),
        // Current month sales
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startOfMonth.toISOString())
          .not('status', 'eq', 'cancelled')
          .not('status', 'eq', 'refunded'),
        // Previous month sales
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startOfLastMonth.toISOString())
          .lt('created_at', startOfMonth.toISOString())
          .not('status', 'eq', 'cancelled')
          .not('status', 'eq', 'refunded'),
        // Total registered users
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true }),
        // Total products
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .not('status', 'eq', 'HIDDEN'),
        // Verified products
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'VERIFIED'),
      ]);

      const totalToPay = walletResult.data?.[0]?.sum ?? 0;
      const pendingProducts = pendingResult.count || 0;
      const prevPendingProducts = prevPendingResult.count || 0;
      const activeDisputes = disputeResult.count || 0;
      const prevActiveDisputes = prevDisputeResult.count || 0;
      const monthlySalesCount = salesResult.count || 0;
      const prevMonthlySalesCount = prevSalesResult.count || 0;

      return {
        pendingProducts,
        activeDisputes,
        totalToPay,
        monthlySalesCount,
        trends: {
          pendingProducts: calcTrend(pendingProducts, prevPendingProducts),
          activeDisputes: calcTrend(activeDisputes, prevActiveDisputes),
          monthlySales: calcTrend(monthlySalesCount, prevMonthlySalesCount),
        },
        totalUsers: usersResult.count || 0,
        totalProducts: totalProductsResult.count || 0,
        verifiedProducts: verifiedProductsResult.count || 0,
      };
    },
    refetchInterval: 1000 * 60 * 2, // Auto-refrescar cada 2 min
  });
};
