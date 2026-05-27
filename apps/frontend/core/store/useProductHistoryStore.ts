import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ProductHistoryState {
  viewedIds: string[];
  addProductToHistory: (id: string) => void;
  clearHistory: () => void;
}

// Regex simple para validar UUID v4
const isValidUUID = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );

export const useProductHistoryStore = create<ProductHistoryState>()(
  persist(
    (set, get) => ({
      viewedIds: [],

      addProductToHistory: (id: string) => {
        // 1. Validación de higiene
        if (!id || !isValidUUID(id)) return;

        const currentIds = get().viewedIds;

        // 2. LIFO dinámico (Last In, First Out)
        // Filtramos para mover el ID al principio si ya existía
        const updatedIds = [
          id,
          ...currentIds.filter((existingId) => existingId !== id),
        ].slice(0, 20); // Aumentamos a 20 productos (estándar MVP++)

        set({ viewedIds: updatedIds });
      },

      clearHistory: () => set({ viewedIds: [] }),
    }),
    {
      name: 'selene-product-history-v2', // Cambiamos versión por el cambio de lógica
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
