/**
 * @file core/hooks/useGoogleAuth.ts
 * @description Encapsula la lógica de autenticación con Google (v11+).
 * Maneja la integración con Supabase Auth y la gestión de estados de carga.
 */
import { useState } from 'react';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { supabase } from '../db/supabase';
import Toast from 'react-native-toast-message';

export const useGoogleAuth = (onSuccess?: () => void) => {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const signInWithGoogle = async () => {
    setIsGoogleLoading(true);
    try {
      // 1. Verificar servicios de Google (Requerido en Android)
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });

      // 2. Iniciar flujo nativo
      const response = await GoogleSignin.signIn();

      /**
       * FIX SENIOR: En la v11+, la respuesta es una unión.
       * Solo si el tipo es 'success' podemos acceder a data.idToken.
       */
      if (response.type === 'success') {
        const idToken = response.data.idToken;

        if (!idToken) {
          throw new Error('No se pudo obtener el ID Token de Google.');
        }

        // 3. Sincronizar con Supabase Auth
        const { error: supabaseError } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });

        if (supabaseError) throw supabaseError;

        // 4. Ejecutar callback de éxito (ej. cerrar modal o navegar)
        if (onSuccess) onSuccess();
      } else {
        /**
         * Si el tipo es 'cancelled' o 'in_progress',
         * no es un error de sistema, simplemente apagamos el loading.
         */
        setIsGoogleLoading(false);
      }
    } catch (error: any) {
      /**
       * Manejo de errores específicos de Google.
       * Ignoramos el error si el usuario simplemente cerró la ventana.
       */
      if (error.code !== statusCodes.SIGN_IN_CANCELLED) {
        console.error('[GOOGLE_AUTH_ERROR]', error);

        Toast.show({
          type: 'error',
          text1: 'Error con Google',
          text2:
            error.message || 'Ocurrió un error inesperado al iniciar sesión.',
        });
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return { signInWithGoogle, isGoogleLoading };
};
