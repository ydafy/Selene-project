import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';
import { fetchAllFavorites, PAGE_SIZE } from './fetchAllFavorites';

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

export { PAGE_SIZE };
