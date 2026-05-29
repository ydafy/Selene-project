import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { AccountStatus } from '@selene/types';

export const useUsers = (
  search: string,
  page: number = 0,
  status: string = 'all',
  sortBy: string = 'newest',
) => {
  const PAGE_SIZE = 20;

  return useQuery({
    queryKey: ['users', search, page, status, sortBy],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('admin_user_directory_view')
        .select('*', { count: 'exact' });

      // 1. Filtro de Búsqueda
      if (search.trim()) {
        const isUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            search,
          );
        if (isUUID) {
          query = query.eq('id', search);
        } else {
          // Importante: ilike para que no importe mayúsculas/minúsculas
          query = query.or(
            `username.ilike.%${search}%,email.ilike.%${search}%`,
          );
        }
      }

      // 2. Filtros de Estado
      if (status !== 'all') {
        if (status === 'vip') {
          query = query.eq('is_verified_seller', true).neq('status', 'banned');
        } else {
          query = query.eq('status', status as NonNullable<AccountStatus>);
        }
      }

      // 3. Ordenamiento
      switch (sortBy) {
        case 'oldest':
          query = query.order('created_at', { ascending: true });
          break;
        case 'balance':
          query = query.order('available_balance', { ascending: false });
          break;
        case 'sales':
          query = query.order('sold_count', { ascending: false });
          break;
        default:
          query = query.order('created_at', { ascending: false });
          break;
      }

      const { data, error, count } = await query.range(from, to);

      if (error) {
        console.error('❌ Error en Supabase:', error.message);
        throw error;
      }

      return { users: data, totalCount: count || 0, pageSize: PAGE_SIZE };
    },
    placeholderData: (previousData) => previousData,
  });
};
