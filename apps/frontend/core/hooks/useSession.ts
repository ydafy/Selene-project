/**
 * @file core/hooks/useSession.ts
 * @description Motor de gestión de sesiones de Selene.
 * Implementa el patrón "Identity Anchor" para asegurar sincronización entre
 * Supabase Auth y la tabla profiles_private (estados de baneo y suspensión).
 */

import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../db/supabase';
import { Session } from '@supabase/supabase-js';

import { clearUserScopedData } from '../auth/signOut';
import {
  INITIAL_STATUS_STATE,
  applyStatusLoad,
  shouldReloadStatusOnResume,
  syncStatusOwner,
  type StatusLoadResult,
} from '../auth/sessionStatus.logic';

const INITIALIZATION_TIMEOUT = 10000;

export const useSession = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [statusState, setStatusState] = useState(INITIAL_STATUS_STATE);
  const isMounted = useRef(true);
  // Mirrors the session user so late status responses can be checked against it.
  const currentUserId = useRef<string | null>(null);

  const applySession = (next: Session | null) => {
    const nextUserId = next?.user.id ?? null;
    currentUserId.current = nextUserId;
    setStatusState((prev) => syncStatusOwner(prev, nextUserId));
    setSession(next);
  };

  // Función auxiliar para cargar el status de profiles_private
  const fetchAccountStatus = async (userId: string) => {
    let result: StatusLoadResult = { ok: false };
    try {
      const { data: privateProfile, error: profileError } = await supabase
        .from('profiles_private')
        .select('status, status_reason')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.error(
          '[AUTH] Error consultando profiles_private:',
          profileError.message,
        );
      } else if (privateProfile) {
        result = {
          ok: true,
          status: privateProfile.status,
          reason: privateProfile.status_reason,
        };
      }
    } catch (e) {
      console.error('[AUTH] Fallo al consultar status:', e);
    }

    if (!isMounted.current) return;
    const owner = currentUserId.current;
    setStatusState((prev) => applyStatusLoad(prev, userId, owner, result));
  };

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
          applySession(currentSession);
          await fetchAccountStatus(currentSession.user.id);
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
        clearTimeout(timeoutId);
        if (isMounted.current) setLoading(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (isMounted.current) {
        if (event === 'USER_UPDATED' && newSession) {
          const { data: fresh } = await supabase.auth.getUser();
          if (fresh.user) {
            applySession({ ...newSession, user: fresh.user });
            await fetchAccountStatus(fresh.user.id);
            return;
          }
        }

        applySession(newSession);

        if (newSession?.user) {
          // 🚀 VITAL: Consultamos el status cada vez que hay una sesión activa
          await fetchAccountStatus(newSession.user.id);
        }

        if (event === 'SIGNED_OUT') {
          setLoading(false);
          setStatusState(INITIAL_STATUS_STATE);
          try {
            clearUserScopedData();
          } catch (e) {
            console.error('[AUTH] Fallo al limpiar datos de usuario:', e);
          }
        }
      }
    });

    // A ban applied while the app was open only shows after a resume reload.
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      const userId = currentUserId.current;
      if (userId && shouldReloadStatusOnResume(state, userId)) {
        void fetchAccountStatus(userId);
      }
    });

    return () => {
      isMounted.current = false;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  return {
    session,
    loading,
    error,
    accountStatus: statusState.status,
    statusReason: statusState.reason,
    isBanned: statusState.status === 'banned',
    isSuspended: statusState.status === 'suspended',
  };
};
