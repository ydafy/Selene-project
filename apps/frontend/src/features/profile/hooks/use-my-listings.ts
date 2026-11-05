import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../shared/lib/supabase';
import { Product } from '@selene/types';
import { useAuthContext } from '../../../shared/lib/auth/auth-provider';

export const useMyListings = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['my-listings', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('seller_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Product[];
    },
    enabled: !!userId,
  });
};
