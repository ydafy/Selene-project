import type { ReauthCredential, ReauthResult } from '../auth/reauth.logic';
import {
  mapDeleteAccountResponse,
  type DeleteAccountHttpResponse,
  type DeleteAccountResult,
} from './deleteAccountHelpers';

export type DeleteAccountInput = {
  /** Present only on the second attempt, after `REAUTH_REQUIRED`. */
  reauth?: ReauthCredential;
};

export type DeleteAccountDeps = {
  invoke: () => Promise<DeleteAccountHttpResponse>;
  reauthenticate: (credential: ReauthCredential) => Promise<ReauthResult>;
};

/**
 * One deletion attempt. With a credential it re-signs in first and then calls
 * the function once; a second `REAUTH_REQUIRED` is reported, never retried.
 */
export const runDeleteAccount = async (
  input: DeleteAccountInput,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResult> => {
  if (input.reauth) {
    const reauth = await deps.reauthenticate(input.reauth);
    if (!reauth.ok) {
      return reauth.errorKey === null
        ? { ok: false, errorKey: '', silent: true }
        : {
            ok: false,
            errorKey: reauth.errorKey,
            ...(reauth.field ? { field: reauth.field } : {}),
          };
    }
  }

  const result = mapDeleteAccountResponse(await deps.invoke());
  if (input.reauth && !result.ok && result.reauthRequired) {
    return { ok: false, errorKey: result.errorKey };
  }
  return result;
};
