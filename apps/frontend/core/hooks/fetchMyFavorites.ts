import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@selene/types';
import { Product } from '@selene/types';

export const fetchMyFavorites = async (
  userId: string,
  limit: number | undefined,
  client: SupabaseClient<Database>,
): Promise<Product[]> => {
  let query = client
    .from('favorites')
    .select(
      `
      product:products!inner (*)
    `,
    )
    .eq('user_id', userId)
    .is('products.deleted_at', null)
    .order('created_at', { ascending: false });

  const effectiveLimit = limit ?? 6;
  if (effectiveLimit > 0) {
    query = query.limit(effectiveLimit);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data
    .map((item: { product: Product }) => item.product)
    .filter(Boolean) as Product[];
};
