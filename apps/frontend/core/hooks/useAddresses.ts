import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Address } from '@selene/types';

export const useAddresses = () => {
  const { session } = useAuthContext();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  // 1. FETCH (Leer direcciones)
  const {
    data: addresses,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['addresses', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', userId)
        .order('is_default', { ascending: false }); // La default primero

      if (error) throw error;
      return data as Address[];
    },
    enabled: !!userId,
  });

  // 2. ADD (Crear dirección)
  const addAddressMutation = useMutation({
    mutationFn: async (newAddress: Omit<Address, 'id' | 'user_id'>) => {
      if (!userId) throw new Error('No user');

      // Si es la primera dirección, la hacemos default automáticamente
      const isFirst = addresses && addresses.length === 0;

      const { data, error } = await supabase
        .from('addresses')
        .insert({
          ...newAddress,
          user_id: userId,
          is_default: isFirst ? true : newAddress.is_default,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses', userId] });
    },
  });

  // 3. DELETE (Borrar dirección)
  const deleteAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      const { error } = await supabase
        .from('addresses')
        .delete()
        .eq('id', addressId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses', userId] });
    },
  });

  // 4. SET DEFAULT (Marcar como principal)
  const setDefaultMutation = useMutation({
    mutationFn: async (addressId: string) => {
      if (!userId) return;

      // Transacción: Primero quitamos default a todas, luego ponemos a una
      // Nota: Supabase no soporta transacciones directas en cliente JS fácilmente,
      // así que hacemos dos updates secuenciales (o usamos una RPC, pero esto basta por ahora).

      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId);

      const { error } = await supabase
        .from('addresses')
        .update({ is_default: true })
        .eq('id', addressId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses', userId] });
    },
  });

  return {
    addresses,
    isLoading,
    error,
    addAddress: addAddressMutation.mutateAsync,
    deleteAddress: deleteAddressMutation.mutateAsync,
    setDefault: setDefaultMutation.mutateAsync,
    isAdding: addAddressMutation.isPending,
  };
};
