import { useState } from 'react';
import { z } from 'zod';

// El esquema de Zod se mantiene igual.
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'auth:errors.emailIsRequired' })
    .email({ message: 'auth:errors.invalidEmail' }),
  password: z.string().min(1, { message: 'auth:errors.passwordIsRequired' }),
});

export type LoginData = z.infer<typeof loginSchema>;

export const useAuth = () => {
  const [loading, setLoading] = useState(false);

  // La función signIn ya no es necesaria aquí, ya que la lógica
  // se ha movido al componente para mayor claridad en este caso.
  // La mantendremos comentada por si la necesitamos en el futuro para lógicas más complejas.
  /*
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
      return false;
    }

    return true;
  };
  */

  // --- ESTE ES EL CAMBIO CLAVE ---
  // Ahora, el hook devuelve el estado 'loading' y la función 'setLoading'.
  return { loading, setLoading };
};
