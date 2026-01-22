import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';

export const useUnreadNotifications = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['unread-notifications', userId],
    queryFn: async () => {
      if (!userId) return 0;

      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true }) // head: true = Solo cuenta, no baja datos
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!userId,
    refetchInterval: 30000, // Refresca cada 30s automáticamente (Polling suave)
  });
};
