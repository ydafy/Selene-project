/**
 * @file core/auth/googleAuth.logic.ts
 * @description Pure decision for Google sign-in failures: a user cancel stays
 * silent, everything else becomes an i18n key (never a raw message).
 */

import { GENERIC_ERROR_KEY, mapAuthErrorKey } from './authErrors.logic';

export const GOOGLE_NO_ID_TOKEN = 'google_no_id_token';
export const GOOGLE_ERROR_KEY = 'auth:errors.googleSignInFailed';

export type GoogleErrorResolution =
  | { silent: true }
  | { silent: false; key: string };

export const resolveGoogleError = (
  error: unknown,
  cancelledCode: string,
): GoogleErrorResolution => {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === cancelledCode) return { silent: true };
  if (code === GOOGLE_NO_ID_TOKEN) return { silent: false, key: GOOGLE_ERROR_KEY };
  const key = mapAuthErrorKey(error);
  return {
    silent: false,
    key: key === GENERIC_ERROR_KEY ? GOOGLE_ERROR_KEY : key,
  };
};
