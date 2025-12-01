import { createContext, useContext, useRef, useCallback } from 'react';
import {
  BottomSheetModalProvider,
  BottomSheetModal,
} from '@gorhom/bottom-sheet';
import { AuthModal } from '../../components/features/auth/AuthModal';

type AuthModalContextType = {
  present: (view?: 'login' | 'register') => void;
  dismiss: () => void;
};

const AuthModalContext = createContext<AuthModalContextType | undefined>(
  undefined,
);

export const AuthModalProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const bottomSheetRef = useRef<BottomSheetModal>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const present = useCallback((view: 'login' | 'register' = 'login') => {
    // Aquí podríamos añadir lógica para setear la vista inicial si expusiéramos ese estado
    bottomSheetRef.current?.present();
  }, []);

  const dismiss = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  return (
    <AuthModalContext.Provider value={{ present, dismiss }}>
      {/* BottomSheetModalProvider es requerido por la librería */}
      <BottomSheetModalProvider>
        {children}
        <AuthModal ref={bottomSheetRef} />
      </BottomSheetModalProvider>
    </AuthModalContext.Provider>
  );
};

export const useAuthModal = () => {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return context;
};
