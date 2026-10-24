/**
 * @file core/hooks/useProducts.ts
 * Hook flexible para traer listas de productos con filtros opcionales.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import type { PublicProduct } from '@selene/types';
import {
  resolveProductsQueryEnabled,
  resolveProductStatuses,
  type UseProductsOptions,
} from './useProducts.helpers';

const fetchProducts = async (
  options?: UseProductsOptions,
): Promise<PublicProduct[]> => {
  try {
    let query = supabase
      .from('products_public') // The view already hides deleted and HIDDEN rows
      .select('*')
      .in('status', resolveProductStatuses(options)) // Do not rely on the view to pick the screen's statuses
      .order('created_at', { ascending: false });

    if (options?.sellerId) {
      query = query.eq('seller_id', options.sellerId);
    }

    if (options?.verifiedOnly) {
      query = query.eq('status', 'VERIFIED');
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data as PublicProduct[]) || [];
  } catch (err: unknown) {
    // Transformamos el error para que sea legible
    const message =
      err instanceof Error ? err.message : 'FALLO_CONEXION_CATALOGO';
    console.error('[useProducts] Error en fetch:', message);
    throw new Error(message);
  }
};

export const useProducts = (options?: UseProductsOptions) => {
  return useQuery({
    // La queryKey debe incluir las opciones para que React Query sepa que es una lista diferente
    queryKey: ['products', options],
    queryFn: () => fetchProducts(options),
    enabled: resolveProductsQueryEnabled(options),
    staleTime: 1000 * 60 * 5,
  });
};
