import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { ACTIVE_STATUSES, HISTORY_STATUSES } from './useAdminProduct';

export const useAdminProductCounts = () => {
  const { user, profile, initialized } = useAuthStore();
  const isAdmin = initialized && !!user && profile?.role === 'admin';

  const activeQuery = useQuery({
    queryKey: ['admin-products-counts', 'active'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .in('status', ACTIVE_STATUSES);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin,
    staleTime: 1000 * 60 * 2,
  });

  const historyQuery = useQuery({
    queryKey: ['admin-products-counts', 'history'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .in('status', HISTORY_STATUSES);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin,
    staleTime: 1000 * 60 * 2,
  });

  return {
    activeCount: activeQuery.data ?? null,
    historyCount: historyQuery.data ?? null,
    isLoading: activeQuery.isLoading || historyQuery.isLoading,
  };
};