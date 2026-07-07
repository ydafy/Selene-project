import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { invokeEdge } from '../services/edge-client';
import { Address } from '@selene/types';
import {
  buildOpenDisputeRequest,
  getOpenDisputeInvalidationKeys,
} from '../utils/disputeShipmentContext';
import type { OpenDisputeParams } from '../utils/disputeShipmentContext';

// Definimos la interfaz de lo que recibe la función
interface GenerateLabelParams {
  originAddress: Address;
  shippingEvidence: { images: string[] };
  shipmentId?: string; // shipment-level label generation
}

export const useOrderActions = (orderId: string) => {
  const queryClient = useQueryClient();
  const generateLabel = useMutation({
    mutationFn: async (params: GenerateLabelParams) => {
      return invokeEdge('generate-shipping-label', {
        ...(params.shipmentId
          ? { shipmentId: params.shipmentId }
          : { orderId }),
        originAddress: params.originAddress,
        shippingEvidence: params.shippingEvidence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', orderId] });
    },
  });

  // 2. Confirmar Entrega (Comprador)
  const confirmDelivery = useMutation({
    mutationFn: async (params?: { shipmentId?: string }) => {
      if (params?.shipmentId) {
        // Shipment-level confirm delivery
        const { data, error } = await supabase.rpc(
          'fn_confirm_shipment_delivery',
          {
            p_shipment_id: params.shipmentId,
          },
        );
        if (error) throw error;
        if (data && !data[0]?.success) throw new Error(data[0]?.error_message);
        return data;
      }
      // Fallback: order-level (backward compat)
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
      queryClient.invalidateQueries({ queryKey: ['shipments', orderId] });
    },
  });

  // 3. Cancelar Orden (Comprador)
  const cancelOrder = useMutation({
    mutationFn: async (params: { reason?: string }) => {
      return invokeEdge('cancel-order', {
        orderId,
        reason: params.reason || 'Cancelación solicitada por el usuario',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
    },
  });

  // 4. Abrir Disputa (Comprador)
  const openDispute = useMutation({
    mutationFn: async (params: OpenDisputeParams) => {
      return invokeEdge('create-dispute', buildOpenDisputeRequest(orderId, params));
    },
    onSuccess: (_data, params) => {
      getOpenDisputeInvalidationKeys(orderId, params.shipmentId).forEach(
        (queryKey) => {
          queryClient.invalidateQueries({ queryKey });
        },
      );
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
      return invokeEdge('generate-return-label', {
        disputeId: params.disputeId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
    },
  });
  const resolveDisputeRefund = useMutation({
    mutationFn: async (params: { orderId: string; disputeId: string }) => {
      return invokeEdge('resolve-dispute-refund', {
        orderId: params.orderId,
        disputeId: params.disputeId,
      });
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
