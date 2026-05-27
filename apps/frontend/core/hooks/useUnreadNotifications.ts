import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

export const useUnreadNotifications = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['unread-notifications', userId],
    queryFn: async () => {
      if (!userId) return 0;
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false)
        .is('deleted_at', null);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!userId,
    staleTime: 1000 * 30, // 30 segundos
  });
};
