import React, { createContext, useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { useSession } from '../../core/hooks/useSession';
import { AccountStatus } from '@selene/types';

// 1. Definimos la forma de los datos expuestos
type AuthContextType = {
  session: Session | null;
  loading: boolean;
  accountStatus: AccountStatus;
  statusReason: string | null;
  isBanned: boolean;
  isSuspended: boolean;
};

// 2. Creamos el Contexto con valores seguros por defecto
const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  accountStatus: 'active',
  statusReason: null,
  isBanned: false,
  isSuspended: false,
});

// 3. Proveedor Global
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    session,
    loading,
    accountStatus,
    statusReason,
    isBanned,
    isSuspended,
  } = useSession();

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        accountStatus,
        statusReason,
        isBanned,
        isSuspended,
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
