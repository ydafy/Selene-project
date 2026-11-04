import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';

export const useProtectedRoute = (
  session: Session | null,
  loading: boolean,
) => {
  const segments = useSegments();

  useEffect(() => {
    if (loading) return; // No hacer nada mientras carga

    const inAuthGroup = segments[0] === '(auth)';

    // Si hay sesión y el usuario está en el grupo de auth, lo mandamos a la app.
    if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
    // Si NO hay sesión, lo mandamos al login.
    // La comprobación '!inAuthGroup' previene un bucle si ya estamos en (auth).
    else if (!session && !inAuthGroup) {
      //router.replace('/(auth)');
    }
  }, [session, loading, segments]);
};
