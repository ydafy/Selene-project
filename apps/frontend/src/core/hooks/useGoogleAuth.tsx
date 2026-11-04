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
import { useTranslation } from 'react-i18next';
import {
  GOOGLE_NO_ID_TOKEN,
  resolveGoogleError,
} from '../auth/googleAuth.logic';

export const useGoogleAuth = (onSuccess?: () => void) => {
  const { t } = useTranslation('auth');
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
          throw { code: GOOGLE_NO_ID_TOKEN };
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
    } catch (error) {
      // A user cancel is silent; anything else shows a localized message.
      const resolution = resolveGoogleError(
        error,
        statusCodes.SIGN_IN_CANCELLED,
      );
      if (!resolution.silent) {
        // Never log the raw error: it can carry tokens.
        const { name, code, status } = (error ?? {}) as {
          name?: unknown;
          code?: unknown;
          status?: unknown;
        };
        console.error('[GOOGLE_AUTH_ERROR]', {
          name,
          code,
          status,
        });

        Toast.show({
          type: 'error',
          text1: t('errors.googleSignInErrorTitle'),
          text2: t(resolution.key),
        });
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return { signInWithGoogle, isGoogleLoading };
};
