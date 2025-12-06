import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../../../core/db/supabase';
import { Product } from '@selene/types';

// Definición completa de todos los filtros posibles
export type SearchFilters = {
  query?: string;
  category?: string;
  priceRange?: [number, number];
  conditions?: string[];
  specs?: Record<string, string[]>;
  // --- NUEVOS ---
  orderBy?: 'newest' | 'price_asc' | 'price_desc';
  verifiedOnly?: boolean;
};

const PAGE_SIZE = 20;

export const useSearchProducts = (filters: SearchFilters) => {
  return useInfiniteQuery({
    // La key incluye TODOS los filtros. Si cambia algo (ej. orden), recarga.
    queryKey: ['search-products', filters],

    queryFn: async ({ pageParam = 0 }) => {
      let queryBuilder = supabase
        .from('products')
        .select('*', { count: 'exact' });

      // 1. Filtro de Texto (Full Text Search)
      if (filters.query) {
        const cleanQuery = filters.query.trim();
        const formattedQuery = cleanQuery.split(/\s+/).join(' & ');
        queryBuilder = queryBuilder.textSearch('fts', formattedQuery, {
          config: 'english',
          type: 'plain',
        });
      }

      // 2. Filtro de Categoría
      if (filters.category && filters.category !== 'All') {
        queryBuilder = queryBuilder.eq('category', filters.category);
      }

      // 3. Filtro de Precio
      if (filters.priceRange) {
        queryBuilder = queryBuilder
          .gte('price', filters.priceRange[0])
          .lte('price', filters.priceRange[1]);
      }

      // 4. Filtro de Condición
      if (filters.conditions && filters.conditions.length > 0) {
        queryBuilder = queryBuilder.in('condition', filters.conditions);
      }

      // 5. Filtros de Especificaciones (JSONB)
      if (filters.specs) {
        Object.entries(filters.specs).forEach(([key, values]) => {
          if (values && values.length > 0) {
            const formattedValues = `(${values.map((v) => `"${v}"`).join(',')})`;
            queryBuilder = queryBuilder.filter(
              `specifications->>${key}`,
              'in',
              formattedValues,
            );
          }
        });
      }

      // 6. NUEVO: Filtro de Verificados
      if (filters.verifiedOnly) {
        queryBuilder = queryBuilder.eq('status', 'VERIFIED');
      }

      // 7. NUEVO: Ordenamiento
      switch (filters.orderBy) {
        case 'price_asc':
          queryBuilder = queryBuilder.order('price', { ascending: true });
          break;
        case 'price_desc':
          queryBuilder = queryBuilder.order('price', { ascending: false });
          break;
        case 'newest':
        default:
          // Por defecto, los más nuevos primero
          queryBuilder = queryBuilder.order('created_at', { ascending: false });
          break;
      }

      // 8. Paginación
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await queryBuilder.range(from, to);

      if (error) throw new Error(error.message);

      return {
        data: data as Product[],
        nextPage: count && to < count - 1 ? pageParam + 1 : undefined,
      };
    },

    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 1000 * 60 * 5,
  });
};
