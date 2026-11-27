/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase';
import { toast } from 'sonner';
import type { PendingProduct } from '@selene/types';
import {
  VERIFICATION_NOT_OPEN_MESSAGE,
  isVerificationNotOpen,
  resolveVerdictPayload,
  type ProductVerdict,
} from '../logic/resolve-verdict';

const notOpenError = () =>
  Object.assign(new Error(VERIFICATION_NOT_OPEN_MESSAGE), {
    code: 'VERIFICATION_NOT_OPEN',
  });

export const usePendingProducts = () => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['pending-products'],
    queryFn: async () => {
      // QUERY 1: open verification attempts (lock, proofs, last rejection) + seller.
      // The view lists only in_review products with an open attempt, for admins.
      const { data: rawProducts, error: pError } = await supabase
        .from('admin_product_queue_view')
        .select(
          'id, name, price_cents, category, condition, images, description, specifications, status, created_at, seller_id, aspect_ratio, views, verification_id, submitted_at, benchmark_score, locked_by, locked_at, last_rejection_note, evidence, seller:profiles!products_seller_id_fkey(username, avatar_url, id, is_verified_seller)',
        )
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

      // Unir en memoria
      return products.map((p) => {
        const s = sellerStats?.find((stat) => stat.seller_id === p.seller_id);

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
      verdict: ProductVerdict;
      note?: string;
      product: PendingProduct;
    }) => {
      // The verdict decides the attempt the queue showed, never a newer one.
      // Llamada atómica y segura a la base de datos que orquesta toda la aprobación
      const { data, error } = await supabase.rpc('fn_resolve_product_verdict', {
        p_product_id: id,
        p_verification_id: product.verification_id,
        ...resolveVerdictPayload(verdict, note),
        p_private_note: undefined,
      });

      if (error) {
        // Mapeo amigable de errores de negocio que devuelve Postgres
        if (isVerificationNotOpen(error)) throw notOpenError();
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
      if (error?.code === 'VERIFICATION_NOT_OPEN') {
        queryClient.invalidateQueries({ queryKey: ['pending-products'] });
      }
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
