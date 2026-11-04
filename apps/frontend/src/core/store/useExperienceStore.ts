/**
 * @file core/store/useExperienceStore.ts
 * @description Gestión de experiencia de usuario con persistencia selectiva.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ExperienceState {
  sessionCount: number;
  hasCountedThisSession: boolean; // No persistente
  incrementSessions: () => void;
  getRank: () => 'EXPLORER' | 'VETERAN';
}

export const useExperienceStore = create<ExperienceState>()(
  persist(
    (set, get) => ({
      sessionCount: 0,
      hasCountedThisSession: false, // Se resetea a false cada vez que la App se abre (Cold Start)

      incrementSessions: () => {
        const state = get();

        // Si ya contamos esta sesión, ignoramos la llamada
        if (state.hasCountedThisSession) return;

        set((state) => ({
          sessionCount: state.sessionCount + 1,
          hasCountedThisSession: true, // Marcamos como contado para este ciclo de vida
        }));
      },

      getRank: () => (get().sessionCount >= 10 ? 'VETERAN' : 'EXPLORER'),
    }),
    {
      name: 'selene-experience',
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * Filtramos qué se guarda en el celular.
       * Solo queremos que 'sessionCount' sea permanente.
       */
      partialize: (state) => ({
        sessionCount: state.sessionCount,
      }),
    },
  ),
);
