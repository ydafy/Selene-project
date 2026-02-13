import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Address } from '@selene/types';

export const useAddresses = () => {
  const { session } = useAuthContext();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  // 1. FETCH
  const {
    data: addresses = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['addresses', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error: dbError } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', userId)
        .order('is_default', { ascending: false });

      if (dbError) throw dbError;
      return data as Address[];
    },
    enabled: !!userId,
  });

  // 2. ADD
  const addAddressMutation = useMutation({
    mutationFn: async (newAddress: Omit<Address, 'id' | 'user_id'>) => {
      if (!userId) throw new Error('No user authenticated');

      const isFirst = addresses.length === 0;
      const { data, error: dbError } = await supabase
        .from('addresses')
        .insert({
          ...newAddress,
          user_id: userId,
          is_default: isFirst ? true : newAddress.is_default,
        })
        .select()
        .single();

      if (dbError) throw dbError;
      return data;
    },
    onSuccess: async () => {
      console.log('[useAddresses] Invalidadndo caché de direcciones...');
      return await queryClient.invalidateQueries({
        queryKey: ['addresses', userId],
      });
    },
  });

  // 3. DELETE (WITH OPTIMISTIC UPDATE)
  const deleteAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      const { error: dbError } = await supabase
        .from('addresses')
        .delete()
        .eq('id', addressId);
      if (dbError) throw dbError;
    },
    onMutate: async (addressId) => {
      await queryClient.cancelQueries({ queryKey: ['addresses', userId] });
      const previousAddresses = queryClient.getQueryData(['addresses', userId]);

      queryClient.setQueryData(
        ['addresses', userId],
        (old: Address[] | undefined) => old?.filter((a) => a.id !== addressId),
      );

      return { previousAddresses };
    },
    onError: (err, id, context) => {
      queryClient.setQueryData(
        ['addresses', userId],
        context?.previousAddresses,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses', userId] });
    },
  });

  // 4. SET DEFAULT (WITH OPTIMISTIC UPDATE)
  const setDefaultMutation = useMutation({
    mutationFn: async (addressId: string) => {
      if (!userId) return;

      // We perform a simple two-step update.
      // For high-scale production, a Postgres RPC is recommended.
      const { error: resetError } = await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId);

      if (resetError) throw resetError;

      const { error: setError } = await supabase
        .from('addresses')
        .update({ is_default: true })
        .eq('id', addressId);

      if (setError) throw setError;
    },
    onMutate: async (addressId) => {
      await queryClient.cancelQueries({ queryKey: ['addresses', userId] });
      const previousAddresses = queryClient.getQueryData(['addresses', userId]);

      queryClient.setQueryData(
        ['addresses', userId],
        (old: Address[] | undefined) =>
          old?.map((a) => ({ ...a, is_default: a.id === addressId })),
      );

      return { previousAddresses };
    },
    onError: (err, id, context) => {
      queryClient.setQueryData(
        ['addresses', userId],
        context?.previousAddresses,
      );
    },
    onSettled: () => {
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
    isSettingDefault: setDefaultMutation.isPending,
  };
};
