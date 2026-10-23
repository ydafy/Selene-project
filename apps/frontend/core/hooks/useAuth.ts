/**
 * @file core/hooks/useAuth.ts
 * @description Hook de orquestación para procesos de autenticación (Email/Password, OTP, Password Reset).
 * Implementa validación con Zod y tipado estricto con Supabase Auth.
 */

import { useState } from 'react';
import { z } from 'zod';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../db/supabase';
import { validateRegisterUsername } from '../auth/registerUsername.logic';
import { mapAuthErrorKey } from '../auth/authErrors.logic';
import { completePasswordRecovery } from '../auth/passwordRecovery.logic';

// --- 1. ESQUEMAS DE VALIDACIÓN (ZOD) ---

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'auth:errors.emailIsRequired' })
    .email({ message: 'auth:errors.invalidEmail' }),
  password: z.string().min(1, { message: 'auth:errors.passwordIsRequired' }),
});

export const registerSchema = z
  .object({
    username: z.string().superRefine((value, ctx) => {
      const result = validateRegisterUsername(value);
      if (!result.ok)
        ctx.addIssue({ code: 'custom', message: result.errorKey });
    }),
    email: z.string().email({ message: 'auth:errors.invalidEmail' }),
    password: z.string().min(8, { message: 'auth:errors.passwordTooShort' }),
    confirmPassword: z.string(),
    termsAccepted: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'auth:errors.passwordsDoNotMatch',
    path: ['confirmPassword'],
  })
  .refine((data) => data.termsAccepted === true, {
    message: 'auth:errors.termsMustBeAccepted',
    path: ['termsAccepted'],
  });

// --- 2. TIPOS E INTERFACES ---

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;

/**
 * `message` is the raw server text (logs only). Screens show `messageKey`, an
 * i18n key from `mapAuthErrorKey`; `code` is the Supabase Auth error code.
 */
export type AuthFailure = {
  message: string;
  code?: string;
  messageKey: string;
};

export type AuthResult = {
  success: boolean;
  session: Session | null;
  user: User | null;
  error: AuthFailure | null;
};

const toAuthFailure = (err: unknown): AuthFailure => ({
  message: err instanceof Error ? err.message : String(err),
  code:
    typeof (err as { code?: unknown } | null)?.code === 'string'
      ? (err as { code: string }).code
      : undefined,
  messageKey: mapAuthErrorKey(err),
});

/**
 * Helper interno para estandarizar las respuestas de Supabase Auth.
 */
const formatAuthResponse = (data: any, error: any): AuthResult => {
  if (error) {
    return {
      success: false,
      session: null,
      user: null,
      error: toAuthFailure(error),
    };
  }
  return {
    success: true,
    session: data.session,
    user: data.user,
    error: null,
  };
};

// --- 3. HOOK PRINCIPAL ---

export const useAuth = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Registro de nuevo usuario con metadata.
   */
  const signUp = async (data: RegisterData): Promise<AuthResult> => {
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.signUp({
        email: data.email.trim(),
        password: data.password,
        options: {
          data: {
            username: data.username.trim(),
          },
        },
      });
      const formatted = formatAuthResponse(result.data, result.error);
      if (formatted.error) setError(formatted.error.message);
      return formatted;
    } catch (err) {
      const failure = toAuthFailure(err);
      setError(failure.message);
      return { success: false, session: null, user: null, error: failure };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Inicio de sesión tradicional.
   */
  const signIn = async (data: LoginData): Promise<AuthResult> => {
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({
        email: data.email.trim(),
        password: data.password,
      });
      const formatted = formatAuthResponse(result.data, result.error);
      if (formatted.error) setError(formatted.error.message);
      return formatted;
    } catch (err) {
      const failure = toAuthFailure(err);
      setError(failure.message);
      return { success: false, session: null, user: null, error: failure };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Cierre de sesión.
   */
  const signOut = async (): Promise<{
    success: boolean;
    error: { message: string } | null;
  }> => {
    setLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      return { success: true, error: null };
    } catch (err: any) {
      const message = err.message || String(err);
      setError(message);
      return { success: false, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Verificación de código OTP para registro.
   */
  const verifyOtp = async (
    email: string,
    token: string,
  ): Promise<AuthResult> => {
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'signup',
      });
      return formatAuthResponse(result.data, result.error);
    } catch (err) {
      return {
        success: false,
        session: null,
        user: null,
        error: toAuthFailure(err),
      };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Reenvío de código de confirmación.
   */
  const resendSignUpOtp = async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (resendError) throw resendError;
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: toAuthFailure(err) };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Inicia flujo de recuperación de contraseña enviando OTP.
   */
  const sendPasswordResetOtp = async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      );
      if (resetError) throw resetError;
      return { success: true, error: null };
    } catch (err: any) {
      const failure = toAuthFailure(err);
      setError(failure.message);
      return { success: false, error: failure };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Final recovery step: verifies the code (unless already verified) and
   * updates the password. The caller keeps `codeVerified` for retries.
   */
  const resetPassword = async (
    email: string,
    code: string,
    newPassword: string,
    codeVerified = false,
  ) => {
    setLoading(true);
    setError(null);
    try {
      return await completePasswordRecovery(supabase.auth, {
        email,
        code,
        newPassword,
        codeVerified,
      });
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    setLoading,
    error,
    signUp,
    signIn,
    signOut,
    verifyOtp,
    resendSignUpOtp,
    sendPasswordResetOtp,
    resetPassword,
  };
};
