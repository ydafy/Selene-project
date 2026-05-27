import { createContext, useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { useSession } from '../../core/hooks/useSession';

// 1. Definimos la "forma" de los datos que nuestro contexto proporcionará.
type AuthContextType = {
  session: Session | null;
  loading: boolean;
};

// 2. Creamos el Contexto de React.
//    Le damos un valor inicial, que se usará si un componente intenta acceder
//    al contexto sin estar envuelto en el proveedor.
const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
});

// 3. Creamos el componente Proveedor (Provider).
//    Este es el componente que envolverá nuestra aplicación.
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  // Usamos nuestro hook 'useSession' para obtener el estado de la sesión.
  const { session, loading } = useSession();

  return (
    // Proporcionamos el valor de 'session' y 'loading' a todos los componentes hijos.
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Creamos un hook personalizado para consumir el contexto.
//    En lugar de usar 'useContext(AuthContext)' en cada componente,
//    simplemente llamaremos a 'useAuthContext()'. Es más limpio y seguro.
export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
