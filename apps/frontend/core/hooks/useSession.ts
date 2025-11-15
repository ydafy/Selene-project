import { useState, useEffect } from 'react';
import { supabase } from '../db/supabase';
import { Session } from '@supabase/supabase-js';

export const useSession = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Intentamos obtener la sesión activa al iniciar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // 2. Escuchamos cambios en el estado de autenticación (login, logout)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // 3. Limpiamos el listener cuando el componente se desmonta
    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
};
