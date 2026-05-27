import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback } from 'react';
import { supabase } from '../db/supabase';
import { Notification } from '@selene/types';

export const useNotifications = (userId: string | undefined) => {
  const queryClient = useQueryClient();

const query = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as Notification[];
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  // Mutación de lectura segura (Blindada con userId)
  const markAsRead = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        const { error } = await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', id)
          .eq('user_id', userId); // Seguridad: solo las tuyas

        if (error) throw error;

        // Actualización local para rapidez visual
        queryClient.invalidateQueries({
          queryKey: ['unread-notifications', userId],
        });
      } catch (error) {
        console.error('[NOTIFICATIONS] Error marking as read:', error);
      }
    },
    [userId, queryClient],
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false)
        .is('deleted_at', null);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
      queryClient.invalidateQueries({
        queryKey: ['unread-notifications', userId],
      });
    } catch (error) {
      console.error('[NOTIFICATIONS] Error marking all as read:', error);
    }
  }, [userId, queryClient]);

  // Escucha Realtime Centralizada
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications_hooks_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['notifications', userId],
          });
          queryClient.invalidateQueries({
            queryKey: ['unread-notifications', userId],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return { ...query, markAsRead, markAllAsRead };
};
