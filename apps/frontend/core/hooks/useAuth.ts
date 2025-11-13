import { useState } from 'react';
import { supabase } from '../db/supabase';
import { z } from 'zod';

// 1. Definimos el esquema de validación con Zod
export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});

// 2. Definimos el tipo de los datos del formulario a partir del esquema
export type LoginData = z.infer<typeof loginSchema>;

export const useAuth = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (data: LoginData) => {
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return false; // Indica que el login falló
    }

    return true; // Indica que el login fue exitoso
  };

  // Aquí añadiremos 'signUp', 'signOut', etc. en el futuro
  return { signIn, loading, error };
};
