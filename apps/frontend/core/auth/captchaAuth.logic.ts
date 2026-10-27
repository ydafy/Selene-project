/**
 * @file core/auth/captchaAuth.logic.ts
 * @description The Supabase Auth calls the server guards with CAPTCHA. Each
 * one awaits a fresh token (single use) and only then calls Supabase, so a
 * cancelled or failed challenge rejects with `CaptchaError` and sends nothing.
 * Exempt calls (Google id token, verifyOtp, refresh, updateUser) stay direct.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptchaTokenSource } from './captcha/captcha.logic';

export type CaptchaAuth = Pick<
  SupabaseClient['auth'],
  'signUp' | 'signInWithPassword' | 'resend' | 'resetPasswordForEmail'
>;

export const signUpWithCaptcha = async (
  auth: CaptchaAuth,
  getToken: CaptchaTokenSource,
  input: { email: string; password: string; username: string },
) => {
  const captchaToken = await getToken();
  return auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { username: input.username }, captchaToken },
  });
};

export const signInWithPasswordCaptcha = async (
  auth: CaptchaAuth,
  getToken: CaptchaTokenSource,
  email: string,
  password: string,
) => {
  const captchaToken = await getToken();
  return auth.signInWithPassword({ email, password, options: { captchaToken } });
};

export const resendSignupCode = async (
  auth: CaptchaAuth,
  getToken: CaptchaTokenSource,
  email: string,
) => {
  const captchaToken = await getToken();
  return auth.resend({ type: 'signup', email, options: { captchaToken } });
};

export const sendRecoveryCode = async (
  auth: CaptchaAuth,
  getToken: CaptchaTokenSource,
  email: string,
) => {
  const captchaToken = await getToken();
  return auth.resetPasswordForEmail(email, { captchaToken });
};

/** Re-sign-in step of `reauth.logic.ts`: failures come back as `error`, never thrown. */
export const reauthSignInWithPassword = async (
  auth: CaptchaAuth,
  getToken: CaptchaTokenSource,
  email: string,
  password: string,
): Promise<{ userId: string | null; error: unknown }> => {
  try {
    const { data, error } = await signInWithPasswordCaptcha(
      auth,
      getToken,
      email,
      password,
    );
    return { userId: data.user?.id ?? null, error };
  } catch (error) {
    return { userId: null, error };
  }
};
