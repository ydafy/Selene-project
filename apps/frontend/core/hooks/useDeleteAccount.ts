import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import {
  mapDeleteAccountResponse,
  type DeleteAccountResult,
} from './deleteAccountHelpers';

/**
 * Hook to call the `delete-account` Supabase Edge Function.
 *
 * The Edge Function performs pre-checks (active shipments, open disputes,
 * pending payouts, wallet balance). When clear it deletes the auth user.
 *
 * On success the hook signs the user out and clears the React Query cache.
 * The returned mutation result always exposes a `DeleteAccountResult` so the
 * UI can render a localized blocked-reason message.
 */
export const useDeleteAccount = () => {
  const queryClient = useQueryClient();

  return useMutation<DeleteAccountResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('delete-account');

      if (error) {
        // Network / non-2xx error → return a UI-friendly failure object.
        // Try to recover blocked_reason from the response body when present.
        const ctx = (error as { context?: { body?: string } }).context;
        if (ctx?.body) {
          try {
            const parsed = JSON.parse(ctx.body);
            return mapDeleteAccountResponse(parsed);
          } catch {
            // fall through to generic failure
          }
        }
        return {
          ok: false,
          errorKey: 'settings:errors.deleteFailed',
        };
      }

      return mapDeleteAccountResponse(data);
    },
    onSuccess: async (result) => {
      if (result.ok) {
        await supabase.auth.signOut();
        queryClient.clear();
      }
    },
  });
};
