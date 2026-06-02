import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';
import { fetchMyFavorites } from './fetchMyFavorites';

export const useMyFavorites = (
  userId: string | undefined,
  options?: { limit?: number },
) => {
  return useQuery({
    queryKey: ['my-favorites', userId, options?.limit],
    queryFn: async () => {
      if (!userId) return [];
      return fetchMyFavorites(userId, options?.limit, supabase);
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!userId,
  });
};
