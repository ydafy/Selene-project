/**
 * @file core/hooks/useAuth.ts
 * @description Hook de orquestación para procesos de autenticación (Email/Password, OTP, Password Reset).
 * Implementa validación con Zod y tipado estricto con Supabase Auth.
 */

import { useState } from 'react';
import { z } from 'zod';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../db/supabase';

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
    username: z.string().min(3, { message: 'auth:errors.usernameTooShort' }),
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

export type AuthResult = {
  success: boolean;
  session: Session | null;
  user: User | null;
  error: { message: string } | null;
};

/**
 * Helper interno para estandarizar las respuestas de Supabase Auth.
 */
const formatAuthResponse = (data: any, error: any): AuthResult => {
  if (error) {
    return {
      success: false,
      session: null,
      user: null,
      error: { message: error.message },
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
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, session: null, user: null, error: { message } };
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
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, session: null, user: null, error: { message } };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, session: null, user: null, error: { message } };
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
      return { success: false, error: { message: err.message } };
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
      setError(err.message);
      return { success: false, error: { message: err.message } };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Paso final de recuperación: Valida OTP y actualiza contraseña.
   */
  const resetPassword = async (
    email: string,
    code: string,
    newPassword: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Validar OTP (Esto ya crea una sesión activa)
      const { data: verifyData, error: verifyError } =
        await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code,
          type: 'recovery',
        });

      if (verifyError) throw verifyError;

      // 2. Actualizar contraseña
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      // FIX: Devolvemos la sesión del paso 1, ya que updateUser solo devuelve el User
      return { success: true, session: verifyData.session, error: null };
    } catch (err: any) {
      const message = err.message || String(err);
      setError(message);
      return { success: false, session: null, error: { message } };
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
