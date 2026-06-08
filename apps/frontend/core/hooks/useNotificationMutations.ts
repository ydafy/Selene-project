import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

export const useNotificationMutations = (userId: string | undefined) => {
  const queryClient = useQueryClient();

  const invalidateNotificationKeys = () => {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    queryClient.invalidateQueries({
      queryKey: ['unread-notifications', userId],
    });
  };

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error('AUTH_REQUIRED');

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: invalidateNotificationKeys,
    onError: (error) => {
      console.error('[NOTIFICATIONS] Error marking as read:', error);
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('AUTH_REQUIRED');

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false)
        .is('deleted_at', null);

      if (error) throw error;
    },
    onSuccess: invalidateNotificationKeys,
    onError: (error) => {
      console.error('[NOTIFICATIONS] Error marking all as read:', error);
    },
  });

  return {
    markAsRead: markAsReadMutation.mutateAsync,
    markAllAsRead: markAllAsReadMutation.mutateAsync,
    isMarkingRead: markAsReadMutation.isPending,
    isMarkingAllRead: markAllAsReadMutation.isPending,
  };
};