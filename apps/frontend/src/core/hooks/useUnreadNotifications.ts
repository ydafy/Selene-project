import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { countUnreadNotifications } from './useNotificationMutations.logic';

export const useUnreadNotifications = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['unread-notifications', userId],
    queryFn: async () => {
      if (!userId) return 0;
      return countUnreadNotifications(supabase, userId);
    },
    enabled: !!userId,
    staleTime: 1000 * 30, // 30 segundos
  });
};
