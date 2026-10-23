/**
 * @file core/auth/passwordRecovery.logic.ts
 * @description Password recovery with a single-use code. Once the code is
 * verified the caller keeps `codeVerified`, so a retry after a failed password
 * update does not verify the consumed code again. Errors map by code, never by
 * message text.
 */

import { mapAuthErrorKey } from './authErrors.logic';

export const SAME_PASSWORD_KEY = 'auth:errors.samePassword';

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
    if (error) {
      return { ok: false, codeVerified, messageKey: recoveryErrorKey(error) };
    }
    return { ok: true, codeVerified, messageKey: null };
  } catch (error) {
    return { ok: false, codeVerified, messageKey: recoveryErrorKey(error) };
  }
};
