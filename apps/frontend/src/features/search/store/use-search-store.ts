import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SearchState {
  history: string[];
  addSearch: (term: string) => void;
  removeSearch: (term: string) => void;
  clearHistory: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      history: [],

      addSearch: (term: string) => {
        const cleanTerm = term.trim();
        if (!cleanTerm) return;

        const currentHistory = get().history;
        // Filtramos si ya existe para moverlo al principio (evitar duplicados)
        const newHistory = [
          cleanTerm,
          ...currentHistory.filter(
            (t) => t.toLowerCase() !== cleanTerm.toLowerCase(),
          ),
        ].slice(0, 10); // Guardamos solo los últimos 10

        set({ history: newHistory });
      },

      removeSearch: (term: string) => {
        set((state) => ({
          history: state.history.filter((t) => t !== term),
        }));
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'selene-search-history',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
