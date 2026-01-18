import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

export type ProfileStats = {
  sales_count: number;
  rating_average: number;
  reviews_count: number;
};

export const useProfileStats = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['profile-stats', userId],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await supabase.rpc('get_profile_stats', {
        target_user_id: userId,
      });

      if (error) throw error;
      return data as ProfileStats;
    },
    enabled: !!userId,
  });
};
