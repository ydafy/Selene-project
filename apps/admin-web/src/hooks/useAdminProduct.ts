import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from 'sonner';
import type { ProductStatus } from '@selene/types';

export interface AdminProduct {
  id: string;
  name: string;
  price: number;
  status: string;
  category: string;
  condition: string;
  created_at: string;
  deleted_at: string | null;
  locked_by: string | null;
  seller_id: string;
  seller: { username: string | null } | null;
  locker: { username: string | null } | null;
}

export type ProductTab = 'active' | 'history';

export const ACTIVE_STATUSES = ['VERIFIED', 'RESERVED', 'IN_DISPUTE'] as const;

export const HISTORY_STATUSES = ['SOLD', 'REJECTED', 'HIDDEN'] as const;

const STATUS_GROUPS: Record<ProductTab, readonly ProductStatus[]> = {
  active: ACTIVE_STATUSES,
  history: HISTORY_STATUSES,
};

const PAGE_SIZE = 20;

/** Escape PostgREST special chars in search input to prevent query errors. */
const sanitizeSearch = (term: string): string =>
  term.replace(/[%_*']/g, '').trim();

export const useAdminProduct = (tab: ProductTab, search: string) => {
  const queryClient = useQueryClient();
  const { user, profile, initialized } = useAuthStore();

  const isAdmin = initialized && !!user && profile?.role === 'admin';

  const query = useInfiniteQuery({
    queryKey: ['admin-products', tab, search],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const filterStatuses = STATUS_GROUPS[tab];

      let queryBuilder = supabase
        .from('products')
        .select(
          '*, seller:profiles!products_seller_id_fkey(username), locker:profiles!products_locked_by_fkey(username)',
          { count: 'exact' },
        )
        .in('status', filterStatuses)
        .order('created_at', { ascending: false });

      const safeSearch = sanitizeSearch(search);

      if (safeSearch) {
        queryBuilder = queryBuilder.textSearch('fts', safeSearch, {
          config: 'simple',
          type: 'websearch',
        });
      }

      queryBuilder = queryBuilder.range(from, to);

      const { data, error, count } = await queryBuilder;

      if (error) throw error;

      return {
        data: (data ?? []) as unknown as AdminProduct[],
        nextPage: count && to < count - 1 ? pageParam + 1 : undefined,
        total: count ?? 0,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: isAdmin,
    staleTime: 1000 * 60 * 2,
    placeholderData: keepPreviousData,
  });

  const products = query.data?.pages.flatMap((p) => p.data) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  const softDeleteMutation = useMutation({
    mutationFn: async ({
      productId,
      reason,
    }: {
      productId: string;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc(
        'fn_admin_soft_delete_product',
        {
          p_product_id: productId,
          p_reason: reason,
        },
      );

      if (error) throw error;
      if (data === false) {
        throw new Error('Producto ya estaba oculto.');
      }
      return data;
    },
    onSuccess: () => {
      toast.success('Producto ocultado correctamente.');
      queryClient.invalidateQueries({ queryKey: ['admin-products', tab] });
      queryClient.invalidateQueries({
        queryKey: ['admin-products-counts'],
      });
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { data, error } = await supabase.rpc('fn_admin_restore_product', {
        p_product_id: productId,
      });

      if (error) throw error;
      if (data === false) {
        throw new Error('Producto no encontrado o no estaba oculto.');
      }
      return data;
    },
    onSuccess: () => {
      toast.success('Producto restaurado correctamente.');
      queryClient.invalidateQueries({ queryKey: ['admin-products', tab] });
      queryClient.invalidateQueries({
        queryKey: ['admin-products-counts'],
      });
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  return {
    products,
    total,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    softDelete: softDeleteMutation.mutateAsync,
    isDeleting: softDeleteMutation.isPending,
    restoreProduct: restoreMutation.mutateAsync,
    isRestoring: restoreMutation.isPending,
  };
};
