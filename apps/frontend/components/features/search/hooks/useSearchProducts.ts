/**
 * @file core/hooks/useSearchProducts.ts
 * @description Motor de búsqueda principal de Selene. Maneja paginación infinita,
 * Full Text Search y filtrado avanzado sobre columnas JSONB.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../../../core/db/supabase';
import { Product } from '@selene/types';

export type SearchFilters = {
  query?: string;
  category?: string;
  priceRange?: [number, number];
  conditions?: string[];
  specs?: Record<string, string[]>;
  orderBy?: 'newest' | 'price_asc' | 'price_desc';
  verifiedOnly?: boolean;
};

const PAGE_SIZE = 20;

export const useSearchProducts = (filters: SearchFilters) => {
  return useInfiniteQuery({
    /**
     * Usamos una representación estable de los filtros en la key.
     * Si pasas un objeto nuevo con los mismos valores, React Query no re-lanzará la petición.
     */
    queryKey: ['search-products', JSON.stringify(filters)],

    queryFn: async ({ pageParam = 0 }) => {
      let queryBuilder = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .neq('status', 'HIDDEN');

      // 1. Full Text Search
      if (filters.query?.trim()) {
        queryBuilder = queryBuilder.textSearch('fts', filters.query.trim(), {
          config: 'simple',
          type: 'websearch',
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
          if (!values || values.length === 0) return;

          const arr = Array.isArray(values) ? values : [values];
          /**
           * FIX SEGURIDAD: Sanitizamos los valores para evitar errores con comillas
           * y construimos el filtro PostgREST 'in'.
           */
          const sanitizedValues = arr
            .map((v) => `"${String(v).replace(/"/g, '')}"`)
            .join(',');
          queryBuilder = queryBuilder.filter(
            `specifications->>${key}`,
            'in',
            `(${sanitizedValues})`,
          );
        });
      }

      // 6. Filtro de Verificados
      if (filters.verifiedOnly) {
        queryBuilder = queryBuilder.eq('status', 'VERIFIED');
      }

      // 7. Ordenamiento
      const sortMap = {
        price_asc: { col: 'price', asc: true },
        price_desc: { col: 'price', asc: false },
        newest: { col: 'created_at', asc: false },
      };

      const sort = sortMap[filters.orderBy || 'newest'] || sortMap.newest;
      queryBuilder = queryBuilder.order(sort.col, { ascending: sort.asc });

      // 8. Paginación
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await queryBuilder.range(from, to);

      if (error) throw error;

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
