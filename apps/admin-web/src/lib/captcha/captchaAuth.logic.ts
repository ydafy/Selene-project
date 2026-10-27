import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CAPTCHA_CANCELLED_CODE,
  CAPTCHA_FAILED_CODE,
  type CaptchaTokenSource,
} from './captcha.logic';

export type CaptchaAuth = Pick<SupabaseClient['auth'], 'signInWithPassword'>;

/** Awaits a fresh single-use token first, so a failed challenge sends nothing to Supabase. */
export const signInWithPasswordCaptcha = async (
  auth: CaptchaAuth,
  getToken: CaptchaTokenSource,
  email: string,
  password: string,
) => {
  const captchaToken = await getToken();
  return auth.signInWithPassword({ email, password, options: { captchaToken } });
};

/** Message for the login error box; handles local challenge failures and the server's `captcha_failed`. */
export const loginErrorMessage = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === CAPTCHA_CANCELLED_CODE) {
    return 'Se canceló la verificación de seguridad. Inténtalo de nuevo.';
  }
  if (code === CAPTCHA_FAILED_CODE) {
    return 'No se pudo completar la verificación de seguridad. Inténtalo de nuevo.';
  }
  return err instanceof Error ? err.message : 'Error inesperado al iniciar sesión.';
};
