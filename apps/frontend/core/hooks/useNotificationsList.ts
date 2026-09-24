import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { fetchNotificationPage, type NotificationsListPage, type NotificationCursor } from './notificationPagination';

export const useNotificationsList = (userId: string | undefined) => {
  const query = useInfiniteQuery<NotificationsListPage, Error>({
    queryKey: ['notifications', userId],
    queryFn: async ({ pageParam }) => {
      if (!userId) return { items: [], cursor: null };

      return fetchNotificationPage(supabase, userId, pageParam as NotificationCursor | null);
    },
    initialPageParam: null as NotificationCursor | null,
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