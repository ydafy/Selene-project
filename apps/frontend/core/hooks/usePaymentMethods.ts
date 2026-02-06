import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { PaymentMethod } from '@selene/types';

/**
 * Hook Profesional para la gestión de métodos de pago en Selene.
 * Conecta con la Edge Function 'manage-payment-methods'.
 */
export const usePaymentMethods = () => {
  const queryClient = useQueryClient();

  // 1. Listar métodos de pago guardados en la DB
  const {
    data: methods = [],
    isLoading: isLoadingMethods,
    error: listError,
    refetch: refreshMethods,
  } = useQuery({
    queryKey: ['paymentMethods'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'manage-payment-methods',
        {
          body: { action: 'list_payment_methods' },
        },
      );

      if (error) throw error;
      return data.methods as PaymentMethod[];
    },
  });

  // 2. Obtener configuración para agregar nueva tarjeta (SetupIntent)
  const setupConfigMutation = useMutation({
    mutationFn: async () => {
      // Generamos una llave de idempotencia para esta sesión de "Agregar Tarjeta"
      const idempotencyKey = crypto.randomUUID();

      const { data, error } = await supabase.functions.invoke(
        'manage-payment-methods',
        {
          body: { action: 'get_setup_config' },
          headers: {
            'idempotency-key': idempotencyKey,
          },
        },
      );

      if (error) {
        // Manejo de errores específicos del negocio
        if (error.message?.includes('PAYMENT_LIMIT_REACHED')) {
          throw new Error('limit_reached');
        }
        throw error;
      }

      return data as {
        setupIntent: string;
        ephemeralKey: string;
        customer: string;
        publishableKey: string;
      };
    },
  });

  // 3. Borrar un método de pago
  const deleteMethodMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const { error } = await supabase.functions.invoke(
        'manage-payment-methods',
        {
          body: {
            action: 'delete_payment_method',
            paymentMethodId,
          },
        },
      );

      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidamos el caché para que la lista se actualice sola
      queryClient.invalidateQueries({ queryKey: ['paymentMethods'] });
    },
  });

  return {
    methods,
    isLoadingMethods,
    listError,
    refreshMethods,
    // Acciones
    getSetupConfig: setupConfigMutation.mutateAsync,
    isConfiguring: setupConfigMutation.isPending,
    deleteMethod: deleteMethodMutation.mutateAsync,
    isDeleting: deleteMethodMutation.isPending,
  };
};
