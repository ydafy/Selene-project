/**
 * @file features/auth/components/auth-modal-provider.tsx
 * @description Proveedor de contexto para el Modal de Autenticación global.
 * Gestiona el estado de la vista (Login/Register) y la visibilidad del BottomSheet.
 */

import React, { useRef, useCallback, useState } from 'react';
import {
  BottomSheetModalProvider,
  BottomSheetModal,
} from '@gorhom/bottom-sheet';
import {
  AuthModalContext,
  type AuthView,
} from '../../../shared/lib/auth/auth-modal-context';
import { AuthModal } from './auth-modal';

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
