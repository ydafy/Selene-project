/**
 * @file core/auth/passwordRecovery.logic.ts
 * @description Password recovery with a single-use code. Once the code is
 * verified the caller keeps `codeVerified`, so a retry after a failed password
 * update does not verify the consumed code again, unless the recovery session
 * ended: then the screen asks for a new code. Errors map by code, never by
 * message text.
 */

import { mapAuthErrorKey } from './authErrors.logic';

export const SAME_PASSWORD_KEY = 'auth:errors.samePassword';
export const RECOVERY_SESSION_ENDED_KEY = 'auth:errors.recoverySessionEnded';

const SESSION_ENDED_CODES = ['session_not_found', 'session_expired'];

/** The verified code's session is gone, so `updateUser` can never succeed with it. */
const isSessionEnded = (error: unknown): boolean => {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return (
    name === 'AuthSessionMissingError' ||
    (typeof code === 'string' && SESSION_ENDED_CODES.includes(code))
  );
};

type AuthCallResult = { error: unknown };

/** The slice of `supabase.auth` used here, so the logic is testable. */
export type RecoveryAuth = {
  verifyOtp: (params: {
    email: string;
    token: string;
    type: 'recovery';
  }) => PromiseLike<AuthCallResult>;
  updateUser: (attributes: { password: string }) => PromiseLike<AuthCallResult>;
};

export type PasswordRecoveryResult = {
  ok: boolean;
  codeVerified: boolean;
  messageKey: string | null;
};

const recoveryErrorKey = (error: unknown): string =>
  (error as { code?: unknown } | null)?.code === 'same_password'
    ? SAME_PASSWORD_KEY
    : mapAuthErrorKey(error);

export const completePasswordRecovery = async (
  auth: RecoveryAuth,
  input: {
    email: string;
    code: string;
    newPassword: string;
    codeVerified: boolean;
  },
): Promise<PasswordRecoveryResult> => {
  let codeVerified = input.codeVerified;
  try {
    if (!codeVerified) {
      const { error } = await auth.verifyOtp({
        email: input.email.trim(),
        token: input.code,
        type: 'recovery',
      });
      if (error) {
        return { ok: false, codeVerified, messageKey: recoveryErrorKey(error) };
      }
      codeVerified = true;
    }

    const { error } = await auth.updateUser({ password: input.newPassword });
    if (error && isSessionEnded(error)) {
      return { ok: false, codeVerified: false, messageKey: RECOVERY_SESSION_ENDED_KEY };
    }
    if (error) {
      return { ok: false, codeVerified, messageKey: recoveryErrorKey(error) };
    }
    return { ok: true, codeVerified, messageKey: null };
  } catch (error) {
    return { ok: false, codeVerified, messageKey: recoveryErrorKey(error) };
  }
};
