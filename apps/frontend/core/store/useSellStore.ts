import { create } from 'zustand';
import { Product, ProductCategory } from '@selene/types';

// Definimos la forma del borrador de venta
type SellDraft = {
  id?: string; // <--- NUEVO: ID opcional para saber si es edición
  category: ProductCategory | null;
  name: string;
  description: string;
  price: string;
  condition: string;
  usage: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specifications: Record<string, any>;
  images: string[];
  verificationImage: string | null;
};

interface SellState {
  draft: SellDraft;
  originalData: SellDraft | null; // <--- NUEVO: Para comparar cambios

  // Actions
  setCategory: (category: ProductCategory) => void;
  updateDraft: (fields: Partial<SellDraft>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSpecs: (key: string, value: any) => void;
  loadProductForEdit: (product: Product) => void; // <--- NUEVA ACCIÓN
  resetDraft: () => void;
}

const INITIAL_STATE: SellDraft = {
  id: undefined,
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
  originalData: null,

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

  // NUEVA FUNCIÓN: Carga un producto existente en el formulario
  loadProductForEdit: (product) => {
    // Mapeamos el producto de la DB al formato del Draft
    const data: SellDraft = {
      id: product.id,
      category: product.category,
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      condition: product.condition,
      usage: product.usage,
      specifications: product.specifications || {},
      images: product.images || [],
      verificationImage: null,
    };

    set(() => ({
      draft: data,
      originalData: data, // Guardamos copia para comparar después
    }));
  },

  resetDraft: () => set({ draft: INITIAL_STATE, originalData: null }),
}));
