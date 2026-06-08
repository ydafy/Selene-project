import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Notification } from '@selene/types';

const PAGE_SIZE = 20;

interface NotificationsListPage {
  items: Notification[];
  cursor: { created_at: string; id: string } | null;
}

export const useNotificationsList = (userId: string | undefined) => {
  const query = useInfiniteQuery<NotificationsListPage, Error>({
    queryKey: ['notifications', userId],
    queryFn: async ({ pageParam }) => {
      if (!userId) return { items: [], cursor: null };

      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE + 1);

      // Cursor-based pagination: fetch items after (created_at, id) composite cursor
      if (pageParam) {
        const { created_at, id } = pageParam as {
          created_at: string;
          id: string;
        };
        query = query.lt('created_at', created_at).or(
          `and(created_at.eq.${created_at},id.lt.${id})`,
        );
      }

      const { data, error } = await query;

      if (error) throw error;

      const items = (data as Notification[]) ?? [];
      const hasMore = items.length > PAGE_SIZE;
      const trimmed = hasMore ? items.slice(0, PAGE_SIZE) : items;

      const cursor = hasMore
        ? {
            created_at: trimmed[trimmed.length - 1].created_at,
            id: trimmed[trimmed.length - 1].id,
          }
        : null;

      return { items: trimmed, cursor };
    },
    initialPageParam: null as { created_at: string; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!userId,
    staleTime: 30_000,
  });

  const data = query.data
    ? query.data.pages.flatMap((page) => page.items)
    : [];

  return {
    data,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
};