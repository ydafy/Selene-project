/**
 * @file core/auth/AuthModalProvider.tsx
 * @description Proveedor de contexto para el Modal de Autenticación global.
 * Gestiona el estado de la vista (Login/Register) y la visibilidad del BottomSheet.
 */

import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useState,
} from 'react';
import {
  BottomSheetModalProvider,
  BottomSheetModal,
} from '@gorhom/bottom-sheet';
import { AuthModal } from '../../components/features/auth/AuthModal';

type AuthView = 'login' | 'register';

type AuthModalContextType = {
  present: (view?: AuthView) => void;
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

  // Estado para controlar qué vista mostrar inicialmente al abrir el modal
  const [initialView, setInitialView] = useState<AuthView>('login');

  const present = useCallback((view: AuthView = 'login') => {
    setInitialView(view);
    // Pequeño delay para asegurar que el estado se procese antes de la animación
    setTimeout(() => {
      bottomSheetRef.current?.present();
    }, 0);
  }, []);

  const dismiss = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  return (
    <AuthModalContext.Provider value={{ present, dismiss }}>
      <BottomSheetModalProvider>
        {children}
        {/* Pasamos initialView al modal para que sepa por dónde empezar */}
        <AuthModal ref={bottomSheetRef} initialView={initialView} />
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
