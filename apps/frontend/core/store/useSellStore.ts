import { create } from 'zustand';
import { ProductCategory } from '@selene/types';

// Definimos la forma del borrador de venta
type SellDraft = {
  category: ProductCategory | null;
  // Paso 2: Info Básica
  name: string;
  description: string;
  price: string; // String para manejar el input, luego convertimos a number
  condition: string;
  usage: string;

  // Paso 3: Specs Dinámicas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specifications: Record<string, any>;

  // Paso 4: Imágenes
  images: string[]; // URIs locales antes de subir
  verificationImage: string | null;
};

interface SellState {
  draft: SellDraft;

  // Actions
  setCategory: (category: ProductCategory) => void;
  updateDraft: (fields: Partial<SellDraft>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSpecs: (key: string, value: any) => void;
  resetDraft: () => void;
}

const INITIAL_STATE: SellDraft = {
  category: null,
  name: '',
  description: '',
  price: '',
  condition: '',
  usage: '',
  specifications: {},
  images: [],
  verificationImage: null,
};

export const useSellStore = create<SellState>((set) => ({
  draft: INITIAL_STATE,

  setCategory: (category) =>
    set((state) => ({
      draft: { ...state.draft, category },
    })),

  updateDraft: (fields) =>
    set((state) => ({
      draft: { ...state.draft, ...fields },
    })),

  updateSpecs: (key, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        specifications: {
          ...state.draft.specifications,
          [key]: value,
        },
      },
    })),

  resetDraft: () => set({ draft: INITIAL_STATE }),
}));
