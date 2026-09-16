/**
 * @file core/store/useSellStore.ts
 * @description Gestión de estado global para el flujo de publicación de productos (Sell Wizard).
 * Mantiene un borrador (draft) y los datos originales para detectar cambios críticos en edición.
 */

import { create } from 'zustand';
import { Product, ProductCategory, ShippingPayer } from '@selene/types';

import { getCategoryResetFields } from '../utils/sellCategoryReset';

type PublicationEconomicsSettings = Pick<
  ProductPublicationSettings,
  'service_fee_pct' | 'shipping_buffer_cents' | 'insurance_rate'
>;

type ProductPublicationSettings = {
  service_fee_pct: number | null;
  shipping_buffer_cents: number | null;
  insurance_rate: number | null;
};

export type PublicationEconomicsSnapshot = {
  shippingReserveCents: number;
  commissionRate: number;
  insuranceRate: number;
};

const normalizePublicationRate = (value: number | null): number => {
  if (value === null || !Number.isFinite(value) || value < 0) {
    throw new Error('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
  }

  const normalized = value <= 1 ? value : value <= 100 ? value / 100 : value / 10_000;
  if (normalized > 1) {
    throw new Error('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
  }

  return normalized;
};

export const buildPublicationEconomicsSnapshot = ({
  priceCents,
  quoteCents,
  settings,
}: {
  priceCents: number;
  quoteCents: number;
  settings: PublicationEconomicsSettings;
}): PublicationEconomicsSnapshot => {
  const shippingBufferCents = settings.shipping_buffer_cents;
  if (
    !Number.isSafeInteger(priceCents) ||
    priceCents < 0 ||
    !Number.isSafeInteger(quoteCents) ||
    quoteCents <= 0 ||
    typeof shippingBufferCents !== 'number' ||
    !Number.isSafeInteger(shippingBufferCents) ||
    shippingBufferCents < 0
  ) {
    throw new Error('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
  }

  const commissionRate = normalizePublicationRate(settings.service_fee_pct);
  const insuranceRate = normalizePublicationRate(settings.insurance_rate);

  return {
    shippingReserveCents:
      quoteCents +
       shippingBufferCents +
      Math.ceil(priceCents * insuranceRate),
    commissionRate,
    insuranceRate,
  };
};

export type SellDraft = {
  id?: string;
  category: ProductCategory | null;
  name: string;
  description: string;
  price: string;
  condition: string;
  usage: string;
  specifications: Record<string, unknown>;
  images: string[];
  verificationImage: string | null;
  package_preset: string;
  shipping_payer: ShippingPayer; // 'seller' | 'buyer'
  insurance_enabled: boolean;
  origin_zip: string;
  shipping_cost: string;
  publicationEconomics?: PublicationEconomicsSnapshot | null;
};

interface SellState {
  draft: SellDraft;
  originalData: SellDraft | null;

  // Actions
  setCategory: (category: ProductCategory) => void;
  updateDraft: (fields: Partial<SellDraft>) => void;
  setPublicationEconomics: (snapshot: PublicationEconomicsSnapshot) => void;
  updateSpecs: (key: string, value: unknown) => void;
  loadProductForEdit: (product: Product) => void;
  resetCategoryFields: () => void;
  resetDraft: () => void;
}

const INITIAL_STATE: SellDraft = {
  id: undefined,
  category: null,
  package_preset: 'gpu_1', // Preset neutro inicial
  shipping_payer: 'seller', // REGLA SELENE: El vendedor siempre paga el envío
  name: '',
  description: '',
  price: '',
  condition: '',
  usage: '',
  origin_zip: '',
  shipping_cost: '0',
  publicationEconomics: null,
  specifications: {},
  images: [],
  verificationImage: null,
  insurance_enabled: true,
};

export const useSellStore = create<SellState>((set) => ({
  draft: INITIAL_STATE,
  originalData: null,

  setCategory: (category) =>
    set((state) => {
      if (state.draft.category === category) {
        return { draft: { ...state.draft, category } };
      }
      return {
        draft: {
          ...state.draft,
          category,
          ...getCategoryResetFields(),
        },
      };
    }),

  updateDraft: (fields) =>
    set((state) => ({
      draft: { ...state.draft, ...fields },
    })),

  setPublicationEconomics: (publicationEconomics) =>
    set((state) => ({
      draft: { ...state.draft, publicationEconomics },
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

  /**
   * Carga la información de un producto existente para entrar en modo edición.
   * Mapea tipos de DB a tipos de Formulario (strings).
   */
  loadProductForEdit: (product: Product) => {
    const data: SellDraft = {
      id: product.id,
      category: product.category as ProductCategory,
      name: product.name || '',
      description: product.description || '',
      price: (product.price || 0).toString(),
      condition: product.condition || '',
      usage: product.usage || '',
      specifications: (product.specifications as Record<string, unknown>) || {},
      images: product.images || [],
      verificationImage: null,
      package_preset: product.package_preset || 'gpu_1',
      shipping_payer: (product.shipping_payer as ShippingPayer) || 'seller',
      insurance_enabled: true,
      origin_zip: product.origin_zip || '',
      shipping_cost: (product.shipping_cost || 0).toString(),
      publicationEconomics: null,
    };

    set(() => ({
      draft: data,
      originalData: data,
    }));
  },

  resetCategoryFields: () =>
    set((state) => ({
      draft: { ...state.draft, ...getCategoryResetFields() },
    })),

  resetDraft: () => set({ draft: INITIAL_STATE, originalData: null }),
}));
