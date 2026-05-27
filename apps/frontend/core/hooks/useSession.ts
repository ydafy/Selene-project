/**
 * @file core/hooks/useSession.ts
 * @description Motor de gestión de sesiones de Selene.
 * Implementa el patrón "Identity Anchor" para asegurar sincronización entre
 * Supabase Auth y la tabla Profiles de la base de datos.
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../db/supabase';
import { Session } from '@supabase/supabase-js';

const INITIALIZATION_TIMEOUT = 10000;

export const useSession = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    const initializeAuth = async () => {
      const timeoutId = setTimeout(() => {
        if (loading && isMounted.current) {
          setLoading(false);
          setError(new Error('TIMEOUT_REACHED'));
        }
      }, INITIALIZATION_TIMEOUT);

      try {
        const {
          data: { session: currentSession },
          error: authError,
        } = await supabase.auth.getSession();
        if (authError) throw authError;

        if (currentSession && isMounted.current) {
          setSession(currentSession);

          // Pre-vuelo de Perfil (Mantenemos tu lógica Senior)
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', currentSession.user.id)
            .maybeSingle();

          if (!profile) console.warn('[AUTH] Perfil no encontrado.');
        }
      } catch (err) {
        if (isMounted.current) {
          const normalizedError =
            err instanceof Error
              ? err
              : new Error('Unexpected authentication error');
          setError(normalizedError);
        }
      } finally {
        // apagamos el loading. Este es el único lugar donde loading pasa a false.
        clearTimeout(timeoutId);
        if (isMounted.current) setLoading(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log(`[AUTH_EVENT] ${event}`);

      if (isMounted.current) {
        setSession(newSession);

        /**
         * CAMBIO CRÍTICO:
         * Si el evento es SIGNED_IN (login exitoso), NO tocamos el loading.
         * El loading ya es 'false' desde que la app arrancó.
         * Esto evita que el AuthProvider parpadee y RootLayout reinicie la app.
         */
        if (event === 'SIGNED_OUT') {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted.current = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading, error };
};
