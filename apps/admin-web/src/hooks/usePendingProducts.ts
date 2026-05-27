/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { useAuthStore } from '../store/useAuthStore';

export const usePendingProducts = () => {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['pending-products'],
    queryFn: async () => {
      console.log('[Products] Query 1: Cargando productos...');

      // QUERY 1: Productos + Vendedor
      const { data: products, error: pError } = await supabase
        .from('products')
        .select(
          '*, seller:profiles!products_seller_id_fkey(username, avatar_url, id, status,is_verified_seller )',
        )
        .eq('status', 'IN_REVIEW')
        .order('created_at', { ascending: false });

      console.log('[Products] Query 1 result:', {
        count: products?.length,
        error: pError,
      });

      if (pError) throw pError;
      if (!products?.length) return [];

      // QUERY 2: Stats de vendedores (vista)
      const sellerIds = products.map((p) => p.seller_id);
      console.log(
        '[Products] Query 2: Cargando stats para sellers:',
        sellerIds,
      );

      const { data: sellerStats, error: statsError } = await supabase
        .from('seller_trust_stats')
        .select('*')
        .in('seller_id', sellerIds);

      console.log('[Products] Query 2 result:', {
        count: sellerStats?.length,
        error: statsError,
      });

      // QUERY 3: Notas de vendedores
      console.log('[Products] Query 3: Cargando notas...');
      const { data: allNotes, error: notesError } = await supabase
        .from('admin_user_notes')
        .select(
          'content, created_at, user_id, admin:profiles!admin_id(username)',
        )
        .in('user_id', sellerIds)
        .order('created_at', { ascending: false });

      console.log('[Products] Query 3 result:', {
        count: allNotes?.length,
        error: notesError,
      });

      // QUERY 4: Último rechazo de cada producto (para ver por qué volvió a revisión)
      const productIds = products.map((p) => p.id);
      console.log('[Products] Query 4: Cargando históricos de rechazos...');

      const { data: rejectionHistory, error: historyError } = await supabase
        .from('admin_audit_logs')
        .select('target_id, details, created_at')
        .eq('action_type', 'PRODUCT_REJECT')
        .in('target_id', productIds)
        .order('created_at', { ascending: false });

      console.log('[Products] Query 4 result:', {
        count: rejectionHistory?.length,
        error: historyError,
      });

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
      product,
    }: {
      id: string;
      verdict: string;
      note?: string;
      product: any;
    }) => {
      const { user } = useAuthStore.getState();
      const isRejection = verdict === 'REJECT';

      //  Actualizar Producto
      const { error: prodError } = await supabase
        .from('products')
        .update({
          status: isRejection ? 'REJECTED' : 'VERIFIED',
          rejection_reason: isRejection ? note : null,
          verified_at: !isRejection ? new Date().toISOString() : null,
        })
        .eq('id', id);

      if (prodError) throw prodError;

      //  INSERTAR EN AUDIT LOG (MVP++)
      const { error: logError } = await supabase
        .from('admin_audit_logs')
        .insert({
          admin_id: user?.id,
          action_type:
            verdict === 'REJECT' ? 'PRODUCT_REJECT' : 'PRODUCT_APPROVE',
          target_id: id,
          details: {
            product_name: product.name,
            seller_name: product.seller?.username,
            admin_note: note,
            verdict: verdict,
          },
        });

      if (logError)
        console.error('Error guardando bitácora:', logError.message);

      //  Crear Notificación
      const notifications: any = {
        REJECT: {
          title: 'Producto Rechazado',
          type: 'error',
          msg: `Tu producto "${product.name}" ha sido rechazado. Motivo: ${note}`,
        },
        APPROVE_NOTE: {
          title: 'Producto Verificado',
          type: 'warning',
          msg: `¡Listo! Tu producto "${product.name}" ya está a la venta. Nota: ${note}`,
        },
        APPROVE: {
          title: 'Producto Verificado',
          type: 'success',
          msg: `¡Felicidades! Tu producto "${product.name}" ha sido aprobado.`,
        },
      };

      const config = notifications[verdict];

      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: product.seller_id,
          title: config.title,
          message: config.msg,
          type: config.type,
          read: false,
          action_path: isRejection ? `/verify/${id}` : '/profile/listings',
        });

      if (notifError) {
        console.error('⚠️ Error enviando notificación:', notifError);
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
