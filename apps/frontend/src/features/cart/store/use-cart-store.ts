import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Product } from '@selene/types';

interface CartState {
  items: Product[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  isInCart: (productId: string) => boolean;
  // Helper to get item count without recalculating in components
  getItemCount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product) => {
        const currentItems = get().items;
        const exists = currentItems.find((item) => item.id === product.id);

        if (!exists) {
          set({ items: [...currentItems, product] });
        }
      },

      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== productId),
        }));
      },

      clearCart: () => set({ items: [] }),

      isInCart: (productId) => {
        return get().items.some((item) => item.id === productId);
      },

      getItemCount: () => get().items.length,
    }),
    {
      name: 'selene-cart-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
