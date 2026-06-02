import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

async function logAudit(
  actionType: string,
  targetId: string | null,
  details: Record<string, unknown>,
) {
  const adminId = useAuthStore.getState().user?.id ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('admin_audit_logs').insert({
    action_type: actionType,
    admin_id: adminId,
    target_id: targetId,
    details,
  });
  if (error) {
    console.error('Failed to log audit:', error.message);
  }
}

export function useUpdatePayoutStatus() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
  };

  const markAsProcessing = useMutation({
    mutationFn: async (ids: string[]) => {
      const adminId = useAuthStore.getState().user?.id;
      if (!adminId) throw new Error('Sesión de admin no válida');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updatedRows, error } = await (supabase as any)
        .from('payout_requests')
        .update({
          status: 'processing',
          processed_by: adminId,
          processed_at: new Date().toISOString(),
        })
        .in('id', ids)
        .eq('status', 'pending')
        .select('id');

      if (error) throw error;

      const updatedIds = (updatedRows || []).map((row: { id: string }) => row.id);
      const updated = updatedIds.length;
      const skipped = ids.length - updated;

      await logAudit('payout_mark_processing', ids[0] ?? null, {
        payout_ids: ids,
        updated,
        skipped,
      });

      return { updated, skipped, updatedIds };
    },
    onSuccess: invalidate,
  });

  const markAsCompleted = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('payout_requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'processing')
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se encontró un retiro en proceso para completar');
      }

      await logAudit('payout_mark_completed', id, {
        payout_id: id,
        previous_status: 'processing',
      });
    },
    onSuccess: invalidate,
  });

  const revertToPending = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('payout_requests')
        .update({
          status: 'pending',
          processed_by: null,
          processed_at: null,
        })
        .eq('id', id)
        .eq('status', 'processing')
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se encontró un retiro en proceso para revertir');
      }

      await logAudit('payout_revert_pending', id, {
        payout_id: id,
        previous_status: 'processing',
      });
    },
    onSuccess: invalidate,
  });

  const rejectPayout = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      // 1. Get payout details (including current status)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: payout, error: fetchError } = await (supabase as any)
        .from('payout_requests')
        .select('amount, user_id, status')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;
      if (!payout) throw new Error('Retiro no encontrado');

      const previousStatus = payout.status as string;

      // 2. Update payout status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from('payout_requests')
        .update({
          status: 'rejected',
          rejected_reason: reason,
          rejected_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      // 3. Restore wallet only if the payout was in 'processing' status.
      // For 'pending' payouts, the money never left pending_balance.
      if (previousStatus === 'processing') {
        const { data: wallet } = await supabase
          .from('wallets')
          .select('id, pending_balance, available_balance')
          .eq('user_id', payout.user_id)
          .single();

        if (wallet) {
          await supabase
            .from('wallets')
            .update({
              pending_balance: wallet.pending_balance + payout.amount,
            })
            .eq('id', wallet.id);
        } else {
          // Fallback: wallet not found — log warning for manual review
          console.warn(
            `Wallet no encontrado para usuario ${payout.user_id}. No se pudo restaurar el saldo pendiente.`,
          );
        }
      }

      // 4. Log audit (never include CLABE per NFR-SEC-02)
      await logAudit('payout_reject', id, {
        reason,
        amount: payout.amount,
        user_id: payout.user_id,
        previous_status: previousStatus,
      });
    },
    onSuccess: invalidate,
  });

  return {
    markAsProcessing: markAsProcessing.mutateAsync,
    markAsCompleted: markAsCompleted.mutateAsync,
    revertToPending: revertToPending.mutateAsync,
    rejectPayout: rejectPayout.mutateAsync,
    isLoading:
      markAsProcessing.isPending ||
      markAsCompleted.isPending ||
      revertToPending.isPending ||
      rejectPayout.isPending,
  };
}
