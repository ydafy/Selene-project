import { beforeEach, describe, expect, it } from 'bun:test';
import type { Product } from '@selene/types';

import {
  buildPublicationEconomicsSnapshot,
  useSellStore,
} from './use-sell-store';

describe('useSellStore', () => {
  beforeEach(() => {
    useSellStore.getState().resetDraft();
  });

  describe('setCategory', () => {
    it('resets condition, usage, and specifications when category changes', () => {
      const { setCategory, updateDraft } = useSellStore.getState();

      setCategory('GPU');
      updateDraft({
        condition: 'Used - Like New',
        usage: '6_months',
        specifications: { chipset: 'NVIDIA', memory: '12 GB' },
      });

      setCategory('CPU');

      const { draft } = useSellStore.getState();
      expect(draft.category).toBe('CPU');
      expect(draft.condition).toBe('');
      expect(draft.usage).toBe('');
      expect(draft.specifications).toEqual({});
    });

    it('does not reset dependent fields when category is unchanged', () => {
      const { setCategory, updateDraft } = useSellStore.getState();

      setCategory('GPU');
      updateDraft({
        condition: 'Used - Like New',
        usage: '6_months',
        specifications: { chipset: 'NVIDIA', memory: '12 GB' },
      });

      setCategory('GPU');

      const { draft } = useSellStore.getState();
      expect(draft.category).toBe('GPU');
      expect(draft.condition).toBe('Used - Like New');
      expect(draft.usage).toBe('6_months');
      expect(draft.specifications).toEqual({
        chipset: 'NVIDIA',
        memory: '12 GB',
      });
    });

    it('keeps non-dependent fields intact on category change', () => {
      const { setCategory, updateDraft } = useSellStore.getState();

      setCategory('GPU');
      updateDraft({
        name: 'RTX 3080',
        price: '12500',
        description: 'Great card',
        images: ['file://photo.jpg'],
        condition: 'Used - Like New',
        specifications: { chipset: 'NVIDIA' },
      });

      setCategory('CPU');

      const { draft } = useSellStore.getState();
      expect(draft.name).toBe('RTX 3080');
      expect(draft.price).toBe('12500');
      expect(draft.description).toBe('Great card');
      expect(draft.images).toEqual(['file://photo.jpg']);
      expect(draft.condition).toBe('');
      expect(draft.specifications).toEqual({});
    });
  });
});

describe('publication economics draft snapshot', () => {
  it('preserves the accepted quote, commission, and insurance inputs for publication', () => {
    const snapshot = buildPublicationEconomicsSnapshot({
      priceCents: 800_000,
      quoteCents: 18_600,
      settings: {
        service_fee_pct: 0.06,
        shipping_buffer_cents: 3_000,
        insurance_rate: 0.012,
      },
    });

    useSellStore.getState().resetDraft();
    useSellStore.getState().updateDraft({ publicationEconomics: snapshot });

    expect(useSellStore.getState().draft.publicationEconomics).toEqual({
      shippingReserveCents: 31_200,
      commissionRate: 0.06,
      insuranceRate: 0.012,
    });
  });
});

describe('publication rates are fractions (S6)', () => {
  const snapshot = (rate: number | null) =>
    buildPublicationEconomicsSnapshot({
      priceCents: 100_000,
      quoteCents: 15_000,
      settings: {
        service_fee_pct: rate,
        shipping_buffer_cents: 2_000,
        insurance_rate: 0.012,
      },
    });

  it('accepts a fraction in 0..1', () => {
    expect(snapshot(0.06).commissionRate).toBe(0.06);
    expect(snapshot(0).commissionRate).toBe(0);
    expect(snapshot(1).commissionRate).toBe(1);
  });

  it.each([6, 600, 1.0001, -0.01, Number.NaN, Number.POSITIVE_INFINITY, null])(
    'rejects %p instead of guessing a percent or basis points',
    (rate) => {
      expect(() => snapshot(rate)).toThrow(
        'PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED',
      );
    },
  );

  it('rejects a percent insurance rate too', () => {
    expect(() =>
      buildPublicationEconomicsSnapshot({
        priceCents: 100_000,
        quoteCents: 15_000,
        settings: {
          service_fee_pct: 0.06,
          shipping_buffer_cents: 2_000,
          insurance_rate: 1.2,
        },
      }),
    ).toThrow('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
  });
});

describe('loadProductForEdit', () => {
  beforeEach(() => {
    useSellStore.getState().resetDraft();
  });

  it('prefills the pesos inputs from the cents columns', () => {
    useSellStore.getState().loadProductForEdit({
      id: 'prod-1',
      category: 'GPU',
      name: 'RTX 3060',
      description: 'Like new',
      price_cents: 100_050,
      shipping_cost_cents: 15_000,
      condition: 'used',
      usage: 'light',
      specifications: {},
      images: [],
      package_preset: 'gpu_1',
      shipping_payer: 'seller',
      origin_zip: '01000',
    } as unknown as Product);

    const { draft, originalData } = useSellStore.getState();
    expect(draft.price).toBe('1000.50');
    expect(draft.shipping_cost).toBe('150');
    expect(originalData).toEqual(draft);
  });
});
