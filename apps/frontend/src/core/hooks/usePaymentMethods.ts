import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeEdge } from '../services/edge-client';
import { PaymentMethod } from '@selene/types';
import { useAuthContext } from '@/components/auth/AuthProvider';

const logDebug = (context: string, data?: unknown, error?: unknown) => {
  if (__DEV__) {
    console.log(`--- [PAYMENT METHODS] ${context} ---`);
    if (data) console.log('Data:', data);
    if (error) console.error('Error:', error);
  }
};

export const usePaymentMethods = () => {
  const queryClient = useQueryClient();
  const { session } = useAuthContext(); // Obtenemos la sesión

  // 1. Listar métodos de pago
  const {
    data: methods = [],
    isLoading: isLoadingMethods,
    error: listError,
    refetch: refreshMethods,
  } = useQuery({
    queryKey: ['paymentMethods'],
    enabled: !!session?.user?.id,
    retry: 2,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      logDebug('Fetching list');
      const data = await invokeEdge('manage-payment-methods', {
        action: 'list_payment_methods',
      });
      return (data.methods || []) as PaymentMethod[];
    },
  });

  // 2. Obtener configuración para SetupIntent
  const setupConfigMutation = useMutation({
    mutationFn: async () => {
      try {
        return await invokeEdge('manage-payment-methods', {
          action: 'get_setup_config',
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('PAYMENT_LIMIT_REACHED')
        )
          throw new Error('limit_reached');
        throw error;
      }
    },
  });

  // 3. Borrar método de pago (CON UPDATE OPTIMISTA)
  const deleteMethodMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      await invokeEdge('manage-payment-methods', {
        action: 'delete_payment_method',
        paymentMethodId,
      });
    },
    // Aquí ocurre la magia: actualizamos la UI antes de que el server responda
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['paymentMethods'] });
      const previousMethods = queryClient.getQueryData<PaymentMethod[]>([
        'paymentMethods',
      ]);

      queryClient.setQueryData(
        ['paymentMethods'],
        (old: PaymentMethod[] | undefined) => old?.filter((m) => m.id !== id),
      );

      return { previousMethods };
    },
    // Si algo falla, revertimos al estado anterior
    onError: (err, id, context) => {
      if (context?.previousMethods) {
        queryClient.setQueryData(['paymentMethods'], context.previousMethods);
      }
      logDebug('Delete Error', null, err);
    },
    // Siempre refrescar al final para asegurar sincronía
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentMethods'] });
    },
  });

  return {
    methods,
    isLoadingMethods,
    listError,
    refreshMethods,
    getSetupConfig: setupConfigMutation.mutateAsync,
    isConfiguring: setupConfigMutation.isPending,
    deleteMethod: deleteMethodMutation.mutateAsync,
    isDeleting: deleteMethodMutation.isPending,
  };
};
