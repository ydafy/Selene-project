import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@selene/types';
import { PublicProduct } from '@selene/types';

export const fetchMyFavorites = async (
  userId: string,
  limit: number | undefined,
  client: SupabaseClient<Database>,
): Promise<PublicProduct[]> => {
  let query = client
    .from('favorites')
    .select(
      `
      product:products_public!inner (*)
    `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const effectiveLimit = limit ?? 6;
  if (effectiveLimit > 0) {
    query = query.limit(effectiveLimit);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data as unknown as { product: PublicProduct }[])
    .map((item) => item.product)
    .filter(Boolean) as PublicProduct[];
};
