import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const useAdminStats = () => {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      // 1. Productos pendientes de verificación
      const { count: pendingProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'IN_REVIEW');

      // 2. Disputas activas (Abiertas o en revisión)
      const { count: activeDisputes } = await supabase
        .from('disputes')
        .select('*', { count: 'exact', head: true })
        .in('status', ['open', 'under_review']);

      // 3. Dinero por dispersar (Suma de balances disponibles en wallets)
      const { data: wallets } = await supabase
        .from('wallets')
        .select('available_balance');

      const totalToPay =
        wallets?.reduce((acc, w) => acc + w.available_balance, 0) || 0;

      // 4. Ventas del mes actual

      const now = new Date();
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
      );

      const { data: monthlyOrders, error: salesError } = await supabase
        .from('orders')
        .select('id') // Solo necesitamos contar registros, no traer toda la data
        .gte('created_at', startOfMonth.toISOString())
        // Filtro más limpio: excluimos cancelados y reembolsados individualmente
        .not('status', 'eq', 'cancelled')
        .not('status', 'eq', 'refunded');

      if (salesError) console.error('Error en Ventas:', salesError.message);

      const monthlySalesCount = monthlyOrders?.length || 0;

      return {
        pendingProducts: pendingProducts || 0,
        activeDisputes: activeDisputes || 0,
        totalToPay,
        monthlySalesCount,
      };
    },
    refetchInterval: 1000 * 60 * 2, // Auto-refrescar cada 2 min
  });
};
