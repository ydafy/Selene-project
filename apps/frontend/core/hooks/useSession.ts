/**
 * @file core/hooks/useSession.ts
 * @description Motor de gestión de sesiones de Selene.
 * Implementa el patrón "Identity Anchor" para asegurar sincronización entre
 * Supabase Auth y la tabla profiles_private (estados de baneo y suspensión).
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../db/supabase';
import { Session } from '@supabase/supabase-js';
import { AccountStatus } from '@selene/types';

const INITIALIZATION_TIMEOUT = 10000;

export const useSession = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const isMounted = useRef(true);

  // Función auxiliar para cargar el status de profiles_private
  const fetchAccountStatus = async (userId: string) => {
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
        return;
      }

      if (privateProfile && isMounted.current) {
        console.log('[AUTH STATUS CARGADO]', privateProfile.status);
        setAccountStatus(privateProfile.status || 'active');
        setStatusReason(privateProfile.status_reason || null);
      }
    } catch (e) {
      console.error('[AUTH] Fallo al consultar status:', e);
    }
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
          setSession(currentSession);
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
            setSession({ ...newSession, user: fresh.user });
            await fetchAccountStatus(fresh.user.id);
            return;
          }
        }

        setSession(newSession);

        if (newSession?.user) {
          // 🚀 VITAL: Consultamos el status cada vez que hay una sesión activa
          await fetchAccountStatus(newSession.user.id);
        }

        if (event === 'SIGNED_OUT') {
          setLoading(false);
          setAccountStatus('active');
          setStatusReason(null);
        }
      }
    });

    return () => {
      isMounted.current = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    loading,
    error,
    accountStatus,
    statusReason,
    isBanned: accountStatus === 'banned',
    isSuspended: accountStatus === 'suspended',
  };
};
