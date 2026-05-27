import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Address } from '@selene/types';

// Definimos la interfaz de lo que recibe la función
interface GenerateLabelParams {
  originAddress: Address;
  shippingEvidence: { images: string[] };
}

export const useOrderActions = (orderId: string) => {
  const queryClient = useQueryClient();
  const generateLabel = useMutation({
    mutationFn: async (params: GenerateLabelParams) => {
      const { data, error } = await supabase.functions.invoke(
        'generate-shipping-label',
        {
          body: {
            orderId,
            originAddress: params.originAddress,
            shippingEvidence: params.shippingEvidence,
          },
        },
      );

      if (error) {
        // Extraemos el mensaje real del body de la respuesta
        const errorBody = await error.context.json();
        throw new Error(errorBody?.error || error.message);
      }
      return data as {
        success: boolean;
        trackingNumber: string;
        labelUrl: string;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
    },
  });

  // 2. Confirmar Entrega (Comprador)
  const confirmDelivery = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_confirm_delivery', {
        p_order_id: orderId,
      });
      if (error) throw error;
      if (data && !data[0]?.success) throw new Error(data[0]?.error_message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-purchases'] });
    },
  });

  // 3. Cancelar Orden (Comprador)
  const cancelOrder = useMutation({
    mutationFn: async (params: { reason?: string }) => {
      // LLAMADA A LA EDGE FUNCTION (Orquestador de Reembolso)
      const { data, error } = await supabase.functions.invoke('cancel-order', {
        body: {
          orderId,
          reason: params.reason || 'Cancelación solicitada por el usuario',
        },
      });

      if (error) {
        // Extraemos el mensaje real del body de la respuesta
        const errorBody = await error.context.json();
        throw new Error(errorBody?.error || error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
    },
  });

  // 4. Abrir Disputa (Comprador)
  const openDispute = useMutation({
    mutationFn: async (params: {
      reason: string;
      description: string;
      images: string[];
      checklist: Record<string, boolean>;
      videoUrl: string | null;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        'create-dispute',
        {
          body: {
            orderId,
            reason: params.reason,
            description: params.description,
            evidence: {
              images: params.images,
              tech_checklist: params.checklist,
              video_url: params.videoUrl,
            },
          },
        },
      );

      if (error) {
        // Extraemos el mensaje real del body de la respuesta
        const errorBody = await error.context.json();
        throw new Error(errorBody?.error || error.message);
      }
      if (!data.success)
        throw new Error(data.error || 'Failed to open dispute');

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-purchases'] });
    },
  });

  // 5. Enviar Evidencia de Retorno (Comprador)
  const submitReturnEvidence = useMutation({
    mutationFn: async (params: { disputeId: string; images: string[] }) => {
      const { data, error } = await supabase.rpc(
        'fn_buyer_submit_return_evidence',
        {
          p_dispute_id: params.disputeId,
          p_images: params.images,
        },
      );

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Refrescamos la orden para que el botón de "Preparar" cambie a "Descargar Guía"
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  // 6. Generar Guía de Retorno (Vendedor - Tras pagar)
  const generateReturnLabel = useMutation({
    mutationFn: async (params: { disputeId: string }) => {
      const { data, error } = await supabase.functions.invoke(
        'generate-return-label',
        {
          body: { disputeId: params.disputeId },
        },
      );
      if (error) {
        // Extraemos el mensaje real del body de la respuesta
        const errorBody = await error.context.json();
        throw new Error(errorBody?.error || error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      // Aquí podrías disparar un Toast de éxito
    },
  });
  const confirmReturnReceipt = useMutation({
    mutationFn: async (params: { disputeId: string }) => {
      const { data, error } = await supabase.rpc('fn_confirm_return_receipt', {
        p_dispute_id: params.disputeId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  const resolveDisputeRefund = useMutation({
    mutationFn: async (params: { orderId: string; disputeId: string }) => {
      const { data, error } = await supabase.functions.invoke(
        'resolve-dispute-refund',
        {
          body: { orderId: params.orderId, disputeId: params.disputeId },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  const submitSellerReturnEvidence = useMutation({
    mutationFn: async (params: {
      disputeId: string;
      images: string[];
      videoUrl: string | null;
    }) => {
      const { data, error } = await supabase.rpc(
        'fn_seller_submit_return_evidence',
        {
          p_dispute_id: params.disputeId,
          p_images: params.images,
          p_video_url: params.videoUrl ?? undefined,
        },
      );

      if (error) throw error;
      if (data && !data[0]?.success) throw new Error(data[0]?.error_message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
    },
  });

  return {
    generateLabel: {
      execute: generateLabel.mutateAsync,
      isLoading: generateLabel.isPending,
      error: generateLabel.error,
    },
    confirmDelivery: {
      execute: confirmDelivery.mutateAsync,
      isLoading: confirmDelivery.isPending,
      error: confirmDelivery.error,
    },
    cancelOrder: {
      execute: cancelOrder.mutateAsync,
      isLoading: cancelOrder.isPending,
      error: cancelOrder.error,
    },
    openDispute: {
      execute: openDispute.mutateAsync,
      isLoading: openDispute.isPending,
      error: openDispute.error,
    },
    submitReturnEvidence: {
      execute: submitReturnEvidence.mutateAsync,
      isLoading: submitReturnEvidence.isPending,
    },
    confirmReturnReceipt: {
      execute: confirmReturnReceipt.mutateAsync,
      isLoading: confirmReturnReceipt.isPending,
    },
    resolveDisputeRefund: {
      execute: resolveDisputeRefund.mutateAsync,
      isLoading: resolveDisputeRefund.isPending,
    },

    submitSellerReturnEvidence: {
      execute: submitSellerReturnEvidence.mutateAsync,
      isLoading: submitSellerReturnEvidence.isPending,
    },

    generateReturnLabel: {
      execute: generateReturnLabel.mutateAsync,
      isLoading: generateReturnLabel.isPending,
    },
  };
};
