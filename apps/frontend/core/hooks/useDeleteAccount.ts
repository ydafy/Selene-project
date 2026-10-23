import { useMutation } from '@tanstack/react-query';
import { reauthenticateCurrentUser } from '../auth/reauth';
import { signOutUser } from '../auth/signOut';
import { supabase } from '../db/supabase';
import {
  runDeleteAccount,
  type DeleteAccountInput,
} from './deleteAccountFlow';
import {
  readInvokeFailure,
  type DeleteAccountHttpResponse,
  type DeleteAccountResult,
} from './deleteAccountHelpers';

/**
 * `invokeEdge` drops the HTTP status, and the status is the contract here
 * (409 blocked, 403 reauth, 5xx retry), so this reads the raw response.
 */
const invokeDeleteAccount = async (): Promise<DeleteAccountHttpResponse> => {
  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: {},
    });
    return error ? await readInvokeFailure(error) : { status: 200, body: data };
  } catch {
    return { status: null, body: null };
  }
};

/**
 * Hook to call the `delete-account` Supabase Edge Function.
 *
 * The function refuses (changing nothing) while a shipment, order, dispute,
 * refund or payout is pending, and asks for a sign-in newer than 10 minutes
 * (`reauthRequired`). Pass `{ reauth }` to re-sign in and retry once.
 *
 * Sessions are deleted server-side on success, so the hook only runs the
 * local sign-out (no network call) and clears user-scoped data.
 */
export const useDeleteAccount = () => {
  return useMutation<DeleteAccountResult, Error, DeleteAccountInput | void>({
    mutationFn: (input) =>
      runDeleteAccount(input ?? {}, {
        invoke: invokeDeleteAccount,
        reauthenticate: reauthenticateCurrentUser,
      }),
    onSuccess: async (result) => {
      if (result.ok) {
        await signOutUser('local');
      }
    },
  });
};
