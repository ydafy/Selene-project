import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase';
import { fetchMyFavorites } from './fetch-my-favorites';

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
