import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

function calcTrend(current: number, previous: number) {
  if (previous === 0) return { direction: 'neutral' as const, percentage: 0 };
  const pct = Math.round(((current - previous) / previous) * 100);
  return {
    direction: (pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral') as
      'up' | 'down' | 'neutral',
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
        connectPayoutsResult,
        currentOrdersResult,
        prevOrdersResult,
        usersResult,
        totalProductsResult,
        verifiedProductsResult,
      ] = await Promise.all([
        // 1. Productos listos para moderar (IN_REVIEW)
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'IN_REVIEW'),

        // Periodo anterior IN_REVIEW
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'IN_REVIEW')
          .gte('created_at', startOfLastMonth.toISOString())
          .lt('created_at', startOfMonth.toISOString()),

        // 2. Disputas activas
        supabase
          .from('disputes')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'under_review']),

        // Periodo anterior disputas
        supabase
          .from('disputes')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'under_review'])
          .gte('created_at', startOfLastMonth.toISOString())
          .lt('created_at', startOfMonth.toISOString()),

        // 3. Fondos listos para dispersar en Stripe Connect (Vista Real)
        supabase
          .from('admin_connect_payout_release_view')
          .select('release_amount_cents, is_eligible'),

        // 4. Ventas del Mes Actual (GMV, Ganancias de Selene y Conteo)
        supabase
          .from('orders')
          .select('total_amount, service_fee_amount')
          .gte('created_at', startOfMonth.toISOString())
          .not('status', 'eq', 'cancelled')
          .not('status', 'eq', 'refunded'),

        // 5. Ventas del Mes Anterior (Para cálculo de tendencias)
        supabase
          .from('orders')
          .select('total_amount')
          .gte('created_at', startOfLastMonth.toISOString())
          .lt('created_at', startOfMonth.toISOString())
          .not('status', 'eq', 'cancelled')
          .not('status', 'eq', 'refunded'),

        // 6. Usuarios Registrados
        supabase.from('profiles').select('id', { count: 'exact', head: true }),

        // 7. Total Productos Activos
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .not('status', 'eq', 'HIDDEN'),

        // 8. Productos Verificados en Catálogo
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'VERIFIED'),
      ]);

      // --- CÁLCULOS FINANCIEROS Y OPERATIVOS ---

      // A. Total por dispersar a vendedores (Convertido de Centavos a Pesos MXN)
      const totalToPay =
        (connectPayoutsResult.data || [])
          .filter((row) => row.is_eligible)
          .reduce((sum, row) => sum + (row.release_amount_cents || 0), 0) / 100;

      // B. GMV actual y Ganancias de Selene (Comisiones del 6% + fees)
      const currentOrders = currentOrdersResult.data || [];
      const monthlyGmv = currentOrders.reduce(
        (sum, order) => sum + Number(order.total_amount || 0),
        0,
      );
      const monthlyRevenue = currentOrders.reduce(
        (sum, order) => sum + Number(order.service_fee_amount || 0),
        0,
      );
      const monthlySalesCount = currentOrders.length;

      // C. GMV anterior para tendencia
      const prevOrders = prevOrdersResult.data || [];
      const prevMonthlyGmv = prevOrders.reduce(
        (sum, order) => sum + Number(order.total_amount || 0),
        0,
      );
      const prevMonthlySalesCount = prevOrders.length;

      const pendingProducts = pendingResult.count || 0;
      const prevPendingProducts = prevPendingResult.count || 0;
      const activeDisputes = disputeResult.count || 0;
      const prevActiveDisputes = prevDisputeResult.count || 0;

      return {
        // Operativos
        pendingProducts,
        activeDisputes,
        totalToPay,

        // Financieros
        monthlyGmv,
        monthlyRevenue,
        monthlySalesCount,
        averageTicket:
          monthlySalesCount > 0 ? monthlyGmv / monthlySalesCount : 0,

        // Tendencias
        trends: {
          pendingProducts: calcTrend(pendingProducts, prevPendingProducts),
          activeDisputes: calcTrend(activeDisputes, prevActiveDisputes),
          monthlySales: calcTrend(monthlySalesCount, prevMonthlySalesCount),
          monthlyGmv: calcTrend(monthlyGmv, prevMonthlyGmv),
        },

        // Catálogo y Usuarios
        totalUsers: usersResult.count || 0,
        totalProducts: totalProductsResult.count || 0,
        verifiedProducts: verifiedProductsResult.count || 0,
      };
    },
    refetchInterval: 1000 * 60 * 2, // Auto-refrescar cada 2 min
  });
};
