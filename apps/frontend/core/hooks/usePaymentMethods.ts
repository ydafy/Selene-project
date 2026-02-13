import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { supabase } from '../db/supabase';
import { PaymentMethod } from '@selene/types';
import { useAuthContext } from '@/components/auth/AuthProvider'; // Importamos tu contexto

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
    // Solo se ejecuta si hay un usuario logueado
    enabled: !!session?.user?.id,
    retry: 2,
    queryFn: async () => {
      logDebug('Fetching list');
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

  // 2. Obtener configuración para SetupIntent
  const setupConfigMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = Crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke(
        'manage-payment-methods',
        {
          body: { action: 'get_setup_config' },
          headers: { 'idempotency-key': idempotencyKey },
        },
      );

      if (error) {
        if (error.message?.includes('PAYMENT_LIMIT_REACHED'))
          throw new Error('limit_reached');
        throw error;
      }
      return data;
    },
  });

  // 3. Borrar método de pago (CON UPDATE OPTIMISTA)
  const deleteMethodMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const { error } = await supabase.functions.invoke(
        'manage-payment-methods',
        {
          body: { action: 'delete_payment_method', paymentMethodId },
        },
      );
      if (error) throw error;
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
