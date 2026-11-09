import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase';
import { Product } from '@selene/types';
import { fetchAllFavorites } from './fetch-all-favorites';

export const useAllFavorites = (userId: string | undefined) => {
  return useInfiniteQuery({
    queryKey: ['all-favorites', userId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) return { data: [] as Product[], nextPage: undefined };
      return fetchAllFavorites(userId, pageParam, supabase);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 1000 * 60 * 5,
    enabled: !!userId,
  });
};
