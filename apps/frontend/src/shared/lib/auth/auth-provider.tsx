import React, { createContext, useContext, useMemo } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import {
  clearUserData,
  createSignOut,
  type SignOutWiring,
} from './create-sign-out';
import type { SignOutResult, SignOutScope } from './sign-out.logic';
import { useSession } from './use-session';
import { AccountStatus } from '@selene/types';

// 1. Definimos la forma de los datos expuestos
type AuthContextType = {
  session: Session | null;
  loading: boolean;
  accountStatus: AccountStatus;
  statusReason: string | null;
  isBanned: boolean;
  isSuspended: boolean;
  /** The single sign-out path; routine logout is this device only. */
  signOut: (scope?: SignOutScope) => Promise<SignOutResult>;
};

// 2. Creamos el Contexto con valores seguros por defecto
const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  accountStatus: 'active',
  statusReason: null,
  isBanned: false,
  isSuspended: false,
  // Fails closed: a sign-out outside the provider cannot clear the user's data.
  signOut: async () => ({
    success: false,
    error: new Error('signOut called outside AuthProvider'),
  }),
});

// 3. Proveedor Global
export const AuthProvider = ({
  children,
  signOutWiring,
}: {
  children: React.ReactNode;
  /** Owned by the app root so `shared/` imports no feature (L37). */
  signOutWiring: SignOutWiring;
}) => {
  const {
    session,
    loading,
    accountStatus,
    statusReason,
    isBanned,
    isSuspended,
  } = useSession({ onSignedOut: () => clearUserData(signOutWiring) });

  const signOut = useMemo(
    () =>
      createSignOut({
        supabaseSignOut: (scope) => supabase.auth.signOut({ scope }),
        wiring: signOutWiring,
      }),
    [signOutWiring],
  );

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        accountStatus,
        statusReason,
        isBanned,
        isSuspended,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Hook personalizado para consumir el contexto
export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
