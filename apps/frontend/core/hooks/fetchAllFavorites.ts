import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@selene/types';
import { Product } from '@selene/types';

export const PAGE_SIZE = 20;

export const fetchAllFavorites = async (
  userId: string,
  pageParam: number,
  client: SupabaseClient<Database>,
): Promise<{ data: Product[]; nextPage: number | undefined }> => {
  const from = pageParam * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await client
    .from('favorites')
    .select('product:products!inner (*)', { count: 'exact' })
    .eq('user_id', userId)
    .is('products.deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;

  const products = data
    .map((item: { product: Product }) => item.product)
    .filter(Boolean) as Product[];

  return {
    data: products,
    nextPage: count && to < count - 1 ? pageParam + 1 : undefined,
  };
};
