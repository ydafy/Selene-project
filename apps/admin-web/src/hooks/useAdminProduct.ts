import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from 'sonner';

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

const PAGE_SIZE = 20;

export const useAdminProduct = () => {
  const queryClient = useQueryClient();
  const { user, profile, initialized } = useAuthStore();

  const isAdmin = initialized && !!user && profile?.role === 'admin';

  const query = useInfiniteQuery({
    queryKey: ['admin-products'],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await supabase
        .from('products')
        .select(
          '*, seller:profiles!products_seller_id_fkey(username), locker:profiles!products_locked_by_fkey(username)',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(from, to);

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
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
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
  };

  const restoreMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { data, error } = await supabase.rpc(
        'fn_admin_restore_product',
        { p_product_id: productId },
      );

      if (error) throw error;
      if (data === false) {
        throw new Error('Producto no encontrado o no estaba oculto.');
      }
      return data;
    },
    onSuccess: () => {
      toast.success('Producto restaurado correctamente.');
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
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
