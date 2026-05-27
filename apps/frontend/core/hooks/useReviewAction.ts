import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

type ReviewMutationInput = {
  rating: number;
  comment: string;
  sellerId: string;
  reviewerId: string;
};

export const useReviewAction = (orderId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      rating,
      comment,
      sellerId,
      reviewerId,
    }: ReviewMutationInput) => {
      const { data, error } = await supabase
        .from('reviews')
        .insert({
          order_id: orderId,
          seller_id: sellerId,
          reviewer_id: reviewerId,
          rating,
          comment,
        })
        .select()
        .single();

      if (error) throw error;
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
    },
  });
};
