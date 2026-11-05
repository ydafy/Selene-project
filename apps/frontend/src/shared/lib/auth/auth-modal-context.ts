/**
 * @file shared/lib/auth/auth-modal-context.ts
 * @description Contract of the global auth modal. Routes and features open it through
 * `useAuthModal` without importing `features/auth`, which owns the provider and the modal.
 */

import { createContext, useContext } from 'react';

export type AuthView = 'login' | 'register';

export type AuthModalContextType = {
  present: (view?: AuthView) => void;
  dismiss: () => void;
};

export const AuthModalContext = createContext<AuthModalContextType | undefined>(
  undefined,
);

export const useAuthModal = () => {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return context;
};
