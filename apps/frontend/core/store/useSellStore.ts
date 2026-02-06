import { create } from 'zustand';
import { Product, ProductCategory } from '@selene/types';

// Definimos la forma del borrador de venta
type SellDraft = {
  id?: string;
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
  package_preset: string;
  shipping_payer: 'seller' | 'buyer';
  insurance_enabled: boolean;
  origin_zip: string;
  shipping_cost: string;
};

interface SellState {
  draft: SellDraft;
  originalData: SellDraft | null;

  // Actions
  setCategory: (category: ProductCategory) => void;
  updateDraft: (fields: Partial<SellDraft>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSpecs: (key: string, value: any) => void;
  loadProductForEdit: (product: Product) => void;
  resetDraft: () => void;
}

const INITIAL_STATE: SellDraft = {
  id: undefined,
  category: null,
  package_preset: 'medium',
  shipping_payer: 'buyer',
  name: '',
  description: '',
  price: '',
  condition: '',
  usage: '',
  origin_zip: '',
  shipping_cost: '',
  specifications: {},
  images: [],
  verificationImage: null,
  insurance_enabled: true,
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
      package_preset: product.package_preset || 'medium',
      shipping_payer: product.shipping_payer || 'buyer',
      insurance_enabled: true,
      origin_zip: product.origin_zip || '',
      shipping_cost: product.shipping_cost?.toString() || '',
    };

    set(() => ({
      draft: data,
      originalData: data,
    }));
  },

  resetDraft: () => set({ draft: INITIAL_STATE, originalData: null }),
}));
