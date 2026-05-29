import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from 'sonner';

// --- HOOK 1: GESTIÓN DE BLOQUEO (SOFT LOCK) ---
export const useDisputeLock = () => {
  const { user } = useAuthStore();
  const [lockStatus, setLockStatus] = useState({
    isLockedByOther: false,
    lockerName: null as string | null,
  });
  const [isLocking, setIsLocking] = useState(false);

  const acquireLock = useCallback(
    async (disputeId: string): Promise<boolean> => {
      if (!user?.id || !disputeId) return false;
      setIsLocking(true);
      try {
        const { data, error } = await supabase.rpc('fn_lock_dispute', {
          p_dispute_id: disputeId,
          p_admin_id: user.id,
        });
        if (error) throw error;
        const result = data[0];

        if (result.success) {
          setLockStatus({ isLockedByOther: false, lockerName: null });
          return true; // <--- VITAL: Informar éxito
        } else {
          setLockStatus({
            isLockedByOther: true,
            lockerName: result.current_locker_name,
          });
          toast.warning(`Caso en revisión por ${result.current_locker_name}`);
          return false; // <--- VITAL: Informar bloqueo
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error lock:', message);
        return false;
      } finally {
        setIsLocking(false);
      }
    },
    [user?.id],
  );

  const releaseLock = useCallback(
    async (disputeId: string) => {
      if (!user?.id || !disputeId) return;
      try {
        await supabase.rpc('fn_unlock_dispute', {
          p_dispute_id: disputeId,
          p_admin_id: user.id,
        });
        setLockStatus({ isLockedByOther: false, lockerName: null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error unlock:', message);
      }
    },
    [user?.id],
  );

  return { acquireLock, releaseLock, lockStatus, isLocking };
};

// --- HOOK 2: ACCIONES DE RESOLUCIÓN ---
export const useDisputeActions = (disputeId: string) => {
  const queryClient = useQueryClient();

  const resolveDispute = useMutation({
    mutationFn: async (params: {
      verdict: 'seller' | 'buyer' | 'insurance';
      adminNote: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        'resolve-dispute',
        {
          body: {
            disputeId,
            verdict: params.verdict,
            adminNote: params.adminNote,
          },
        },
      );

      if (error) throw error;
      if (!data.success)
        throw new Error(data.error || 'Error en la resolución');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['dispute-detail', disputeId],
      });
      queryClient.invalidateQueries({ queryKey: ['admin-disputes'] });
      toast.success('Veredicto emitido con éxito.');
    },
    onError: (error: Error) => {
      toast.error(`Error al resolver: ${error.message}`);
    },
  });

  return {
    resolveDispute: resolveDispute.mutateAsync,
    isLoading: resolveDispute.isPending,
  };
};
