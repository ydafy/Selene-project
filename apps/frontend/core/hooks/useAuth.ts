import { useState } from 'react';
import { z } from 'zod';
import { supabase } from '../db/supabase';

// --- Esquemas de Validación ---

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
  // 2. Reintroducimos la regla que obliga a que sea TRUE
  .refine((data) => data.termsAccepted === true, {
    message: 'auth:errors.termsMustBeAccepted',
    path: ['termsAccepted'],
  });

// --- Tipos Inferidos ---
export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;

export type AuthResult = {
  success: boolean;
  session: unknown | null;
  user: unknown | null;
  error: { message: string } | null;
};

export const useAuth = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signUp = async (data: RegisterData): Promise<AuthResult> => {
    setLoading(true);
    setError(null);
    try {
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email: data.email.trim(),
          password: data.password,
          options: {
            data: {
              username: data.username.trim(),
            },
          },
        });

      if (signUpError) {
        setError(signUpError.message);
        return {
          success: false,
          session: null,
          user: null,
          error: { message: signUpError.message },
        };
      }

      return {
        success: true,
        session:
          (signUpData as unknown as Record<string, unknown>)?.session ?? null,
        user: (signUpData as unknown as Record<string, unknown>)?.user ?? null,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, session: null, user: null, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (data: {
    email: string;
    password: string;
  }): Promise<AuthResult> => {
    setLoading(true);
    setError(null);
    try {
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: data.email.trim(),
          password: data.password,
        });

      if (signInError) {
        setError(signInError.message);
        return {
          success: false,
          session: null,
          user: null,
          error: { message: signInError.message },
        };
      }

      return {
        success: true,
        session:
          (signInData as unknown as Record<string, unknown>)?.session ?? null,
        user: (signInData as unknown as Record<string, unknown>)?.user ?? null,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, session: null, user: null, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<{
    success: boolean;
    error: { message: string } | null;
  }> => {
    setLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(signOutError.message);
        return { success: false, error: { message: signOutError.message } };
      }
      return { success: true, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (email: string, token: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data: verifyData, error: verifyError } =
        await supabase.auth.verifyOtp({
          email,
          token,
          type: 'signup',
        });

      if (verifyError) {
        setError(verifyError.message);
        return {
          success: false,
          session: null,
          user: null,
          error: { message: verifyError.message },
        };
      }

      return {
        success: true,
        session:
          (verifyData as unknown as Record<string, unknown>)?.session ?? null,
        user: (verifyData as unknown as Record<string, unknown>)?.user ?? null,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, session: null, user: null, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  const resendSignUpOtp = async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (resendError) {
        setError(resendError.message);
        return { success: false, error: { message: resendError.message } };
      }
      return { success: true, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Envía un código OTP al correo del usuario para restablecer la contraseña.
   * @param email - El correo del usuario.
   */
  const sendPasswordResetOtp = async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      // Usamos resetPasswordForEmail.
      // IMPORTANTE: La plantilla de email en Supabase debe usar {{ .Token }}
      // para que envíe un código y no un link.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      );

      if (resetError) throw resetError;

      return { success: true, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { success: false, error: { message } };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Verifica el código de recuperación y establece la nueva contraseña.
   * @param email - El correo del usuario.
   * @param code - El código OTP de 6 dígitos.
   * @param newPassword - La nueva contraseña deseada.
   */
  const resetPassword = async (
    email: string,
    code: string,
    newPassword: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      // Paso 1: Verificar el código OTP de tipo 'recovery'.
      // Esto iniciará una sesión válida para el usuario.
      const { data: verifyData, error: verifyError } =
        await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'recovery',
        });

      if (verifyError) throw verifyError;

      // Paso 2: Una vez autenticado, actualizamos la contraseña.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { data: updateData, error: updateError } =
        await supabase.auth.updateUser({
          password: newPassword,
        });

      if (updateError) throw updateError;

      return { success: true, session: verifyData.session, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
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
