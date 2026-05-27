import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const useActiveDisputes = (
  filter: 'open' | 'resolved' | 'all' = 'open',
  search: string = '',
  sortBy: string = 'newest',
) => {
  return useQuery({
    queryKey: ['admin-disputes', filter, search, sortBy],
    queryFn: async () => {
      let query = supabase.from('admin_disputes_monitor_view').select('*');

      // 1. Filtro de Estado
      if (filter === 'open')
        query = query.in('dispute_status', [
          'open',
          'under_review',
          'waiting_return',
        ]);
      else if (filter === 'resolved')
        query = query.in('dispute_status', ['resolved', 'rejected']);

      // 2. Buscador (MVP++)
      if (search.trim()) {
        const isUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            search,
          );
        if (isUUID) {
          query = query.or(`dispute_id.eq.${search},order_id.eq.${search}`);
        } else {
          query = query.or(
            `buyer_username.ilike.%${search}%,seller_username.ilike.%${search}%`,
          );
        }
      }

      // 3. Ordenamiento (MVP++)
      switch (sortBy) {
        case 'amount_desc':
          query = query.order('total_amount', { ascending: false });
          break;
        case 'amount_asc':
          query = query.order('total_amount', { ascending: true });
          break;
        case 'oldest':
          query = query.order('dispute_date', { ascending: true });
          break;
        default:
          query = query.order('dispute_date', { ascending: false });
          break;
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });
};
