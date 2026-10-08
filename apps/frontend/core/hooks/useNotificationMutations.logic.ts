import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { Database } from '@selene/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Pure helpers and mutation option builders
// ---------------------------------------------------------------------------
// These functions are side-effect free at import time (no react-native or
// supabase instance loaded) so they can be unit-tested in bun:test.

export function invalidateNotificationKeys(
  queryClient: QueryClient,
  userId: string | undefined,
): void {
  if (!userId) return;
  queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
  queryClient.invalidateQueries({
    queryKey: ['unread-notifications', userId],
  });
}

export async function countUnreadNotifications(
  client: SupabaseClient<Database>, userId: string,
): Promise<number> {
  const { count, error } = await client.from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId).is('deleted_at', null)
    .or('read.eq.false,read.is.null');
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationAsRead(
  client: SupabaseClient<Database>,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) throw error;
}

export async function markAllNotificationsAsRead(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .or('read.eq.false,read.is.null');

  if (error) throw error;
}

export async function dismissNotification(
  client: SupabaseClient<Database>,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('notifications')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) throw error;
}

export async function dismissAllNotifications(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('notifications')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) throw error;
}

export interface BadgeContext {
  previousUnread: number;
}

export async function snapshotBadge(
  queryClient: QueryClient,
  userId: string | undefined,
): Promise<BadgeContext> {
  await queryClient.cancelQueries({ queryKey: ['unread-notifications', userId] });
  const previousUnread = queryClient.getQueryData<number>([
    'unread-notifications',
    userId,
  ]) ?? 0;
  return { previousUnread };
}

export function rollbackBadge(
  queryClient: QueryClient,
  userId: string | undefined,
  context: BadgeContext | undefined,
): void {
  if (!context) return;
  queryClient.setQueryData(['unread-notifications', userId], context.previousUnread);
}

export function createMarkAsReadMutationOptions(
  queryClient: QueryClient,
  userId: string | undefined,
  _t: TFunction,
  showError: () => void,
) {
  return {
    mutationFn: async (id: string) => {
      if (!userId) throw new Error('AUTH_REQUIRED');
      const { supabase } = await import('../db/supabase');
      await markNotificationAsRead(supabase, userId, id);
    },
    onSuccess: () => invalidateNotificationKeys(queryClient, userId),
    onError: (error: Error) => {
      console.error('[NOTIFICATIONS] Error marking as read:', error);
      showError();
    },
  };
}

export function createMarkAllAsReadMutationOptions(
  queryClient: QueryClient,
  userId: string | undefined,
  _t: TFunction,
  showError: () => void,
) {
  return {
    mutationFn: async () => {
      if (!userId) throw new Error('AUTH_REQUIRED');
      const { supabase } = await import('../db/supabase');
      await markAllNotificationsAsRead(supabase, userId);
    },
    onSuccess: () => invalidateNotificationKeys(queryClient, userId),
    onError: (error: Error) => {
      console.error('[NOTIFICATIONS] Error marking all as read:', error);
      showError();
    },
  };
}

export function createDismissNotificationMutationOptions(
  queryClient: QueryClient,
  userId: string | undefined,
  _t: TFunction,
  showError: () => void,
) {
  return {
    mutationFn: async (id: string) => {
      if (!userId) throw new Error('AUTH_REQUIRED');
      const { supabase } = await import('../db/supabase');
      await dismissNotification(supabase, userId, id);
    },
    onMutate: async (id: string): Promise<BadgeContext> => {
      const ctx = await snapshotBadge(queryClient, userId);
      const pages = queryClient.getQueryData<{ pages: { items: { id: string; read: boolean | null; deleted_at: string | null }[] }[] }>(['notifications', userId]);
      const item = pages?.pages.flatMap((page) => page.items).find((row) => row.id === id);
      if (item && !item.read && item.deleted_at === null) {
        queryClient.setQueryData(
          ['unread-notifications', userId],
          Math.max(0, ctx.previousUnread - 1),
        );
      }
      return ctx;
    },
    onError: (error: Error, id: string, context?: BadgeContext) => {
      void id;
      console.error('[NOTIFICATIONS] Error dismissing notification:', error);
      rollbackBadge(queryClient, userId, context);
      // Another dismiss may have succeeded since this snapshot was taken.
      // The restored count is provisional until both owner-scoped caches refetch.
      invalidateNotificationKeys(queryClient, userId);
      showError();
    },
    onSuccess: () => invalidateNotificationKeys(queryClient, userId),
  };
}

export function createDismissAllMutationOptions(
  queryClient: QueryClient,
  userId: string | undefined,
  _t: TFunction,
  showError: () => void,
) {
  return {
    mutationFn: async () => {
      if (!userId) throw new Error('AUTH_REQUIRED');
      const { supabase } = await import('../db/supabase');
      await dismissAllNotifications(supabase, userId);
    },
    onMutate: async (): Promise<BadgeContext> => {
      const ctx = await snapshotBadge(queryClient, userId);
      queryClient.setQueryData(['unread-notifications', userId], 0);
      return ctx;
    },
    onError: (error: Error, vars: undefined, context?: BadgeContext) => {
      void vars;
      console.error('[NOTIFICATIONS] Error clearing all notifications:', error);
      rollbackBadge(queryClient, userId, context);
      // A concurrent individual dismiss can make this snapshot stale.
      invalidateNotificationKeys(queryClient, userId);
      showError();
    },
    onSuccess: () => invalidateNotificationKeys(queryClient, userId),
  };
}
