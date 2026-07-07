/**
 * @file core/hooks/useSellerReviews.ts
 * @description Hook de lectura para obtener las opiniones y calificaciones del vendedor.
 * Realiza un Join relacional para traer el perfil del comprador y el nombre del producto vendido.
 *
 * Saneamiento de Auditoría:
 * - Cache key unificada a ['seller-reviews', sellerId] para evitar colisiones destructivas con las estadísticas.
 * - Corrección de firmas de TypeScript (se lee 'sellerId!', no el 'userId' inexistente).
 * - StaleTime de 15 minutos (sweet spot de rendimiento de red para datos hiper-estáticos).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import {
  normalizeSellerReviewRows,
  type SellerReview,
  type SellerReviewRow,
} from './useSellerReviews.helpers';

export type { SellerReview } from './useSellerReviews.helpers';

const fetchSellerReviews = async (
  sellerId: string,
): Promise<SellerReview[]> => {
  const { data, error } = await supabase
    .from('reviews')
    .select(
      `
      id,
      created_at,
      rating,
      comment,
      shipment_id,
      product_id,
      reviewer:profiles!reviewer_id(username, avatar_url),
      product:products(name)
    `,
    )
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[useSellerReviews] Error fetching reviews:', error.message);
    throw error;
  }

  return normalizeSellerReviewRows(
    (data as unknown as SellerReviewRow[]) || [],
  );
};

export const useSellerReviews = (sellerId: string | undefined) => {
  return useQuery({
    //  FIX: Cache Key única para evitar colisiones con el perfil
    queryKey: ['seller-reviews', sellerId],
    //  FIX: Pasamos el argumento correcto (sellerId, no el userId inexistente)
    queryFn: () => fetchSellerReviews(sellerId!),
    enabled: !!sellerId,
    staleTime: 1000 * 60 * 15,
  });
};
