import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export const usePendingProducts = () => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['pending-products'],
    queryFn: async () => {
      // QUERY 1: Productos + Vendedor (testing join)
      // QUERY 1: Productos + Vendedor
      const { data: rawProducts, error: pError } = await supabase
        .from('products')
        .select(
          'id, name, price, category, condition, images, description, specifications, verification_data, status, created_at, seller_id, locked_by, aspect_ratio, views, seller:profiles!products_seller_id_fkey(username, avatar_url, id, is_verified_seller)',
        )
        .eq('status', 'IN_REVIEW')
        .order('created_at', { ascending: false });

      if (pError) throw pError;
      if (!rawProducts?.length) return [];

      const products = rawProducts as any[];

      // QUERY 2: Stats de vendedores (vista)
      const sellerIds = products.map((p) => p.seller_id);

      const { data: sellerStats } = await supabase
        .from('seller_trust_stats')
        .select('*')
        .in('seller_id', sellerIds);

      // QUERY 3: Notas de vendedores
      const { data: allNotes } = await supabase
        .from('admin_user_notes')
        .select(
          'content, created_at, user_id, admin:profiles!admin_id(username)',
        )
        .in('user_id', sellerIds)
        .order('created_at', { ascending: false });

      // QUERY 4: Último rechazo de cada producto (para ver por qué volvió a revisión)
      const productIds = products.map((p) => p.id);

      const { data: rejectionHistory } = await supabase
        .from('admin_audit_logs')
        .select('target_id, details, created_at')
        .eq('action_type', 'PRODUCT_REJECT')
        .in('target_id', productIds)
        .order('created_at', { ascending: false });

      // Unir en memoria
      return products.map((p) => {
        const s = sellerStats?.find((stat) => stat.seller_id === p.seller_id);

        // Buscar el último rechazo de este producto
        const lastRejection = rejectionHistory?.find(
          (h) => h.target_id === p.id,
        );

        // Calculamos el ratio basado solo en lo ya procesado
        const processed = s?.processed_count || 0;
        const verified = s?.verified_count || 0;
        return {
          ...p,
          seller_stats: {
            verified: verified,
            rejected: s?.rejected_count || 0,
            sold: s?.sold_count || 0,
            total: s?.total_listings || 0,
            ratio: processed > 0 ? Math.round((verified / processed) * 100) : 0,
          },
          internal_notes:
            allNotes?.filter((n) => n.user_id === p.seller_id).slice(0, 3) ||
            [],
          last_rejection: lastRejection || null,
        };
      });
    },
    refetchInterval: 30000,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({
      id,
      verdict,
      note,
    }: {
      id: string;
      verdict: string;
      note?: string;
    }) => {
      // Llamada atómica y segura a la base de datos que orquesta toda la aprobación
      const { data, error } = await supabase.rpc('fn_resolve_product_verdict', {
        p_product_id: id,
        p_verdict: verdict,
        p_public_note: note || undefined, // Satisface el tipo 'string | undefined' de Supabase
        p_private_note: undefined, // Satisface el tipo 'string | undefined' de Supabase
      });

      if (error) {
        // Mapeo amigable de errores de negocio que devuelve Postgres
        if (error.message.includes('LOCK_EXPIRED_OR_STOLEN')) {
          throw new Error(
            'Tu sesión de revisión expiró o el producto fue bloqueado por otro administrador.',
          );
        }
        throw error;
      }

      if (!data) {
        throw new Error('No se pudo completar el veredicto del producto.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-products'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Veredicto enviado correctamente');
    },
    onError: (error: any) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  return {
    products: query.data,
    isLoading: query.isLoading,
    resolve: resolveMutation,
    isError: query.isError,
    refetch: query.refetch,
  };
};
