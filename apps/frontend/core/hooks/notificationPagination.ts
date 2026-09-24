import type { Notification, Database } from '@selene/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotificationCursor { created_at: string; id: string }
export interface NotificationsListPage { items: Notification[]; cursor: NotificationCursor | null }

export async function fetchNotificationPage(
  client: SupabaseClient<Database>, userId: string, cursor: NotificationCursor | null,
): Promise<NotificationsListPage> {
  let query = client.from('notifications').select('*')
    .eq('user_id', userId).is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false }).limit(21);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []).slice(0, 20);
  const last = items[items.length - 1];
  return {
    items,
    cursor: (data?.length ?? 0) > 20 ? { created_at: last.created_at, id: last.id } : null,
  };
}
