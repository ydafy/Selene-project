import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import {
  buildReviewInsertPayload,
  ReviewMutationInput,
} from './useReviewAction.helpers';

export const useReviewAction = (orderId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReviewMutationInput) => {
      const payload = buildReviewInsertPayload(input);
      console.log(
        '[useReviewAction] insert payload:',
        JSON.stringify(payload, null, 2),
      );

      const { data, error } = await supabase
        .from('reviews')
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error(
          '[useReviewAction] Supabase error:',
          JSON.stringify(
            {
              code: error.code,
              message: error.message,
              details: error.details,
              hint: error.hint,
            },
            null,
            2,
          ),
        );
        throw error;
      }

      console.log(
        '[useReviewAction] success:',
        JSON.stringify(data, null, 2),
      );
      return data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['order', orderId] });
      const previous = queryClient.getQueryData(['order', orderId]);
      queryClient.setQueryData(['order', orderId], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        return { ...(old as object), review: [{ id: 'optimistic' }] };
      });
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['order', orderId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({
        queryKey: ['profile-stats', variables.sellerId],
      });
      queryClient.invalidateQueries({
        queryKey: ['seller-reviews', variables.sellerId],
      });
    },
  });
};