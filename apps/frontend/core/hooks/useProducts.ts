/**
 * @file core/hooks/useProducts.ts
 * Hook flexible para traer listas de productos con filtros opcionales.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import type { Product } from '@selene/types';
import {
  resolveProductsQueryEnabled,
  type UseProductsOptions,
} from './useProducts.helpers';

const fetchProducts = async (
  options?: UseProductsOptions,
): Promise<Product[]> => {
  try {
    let query = supabase
      .from('products')
      .select('*')
      .is('deleted_at', null) // Integridad: No mostrar borrados
      .neq('status', 'HIDDEN')
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
    return (data as Product[]) || [];
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
