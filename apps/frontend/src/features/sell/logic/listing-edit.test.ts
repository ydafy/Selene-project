import { describe, expect, test } from 'bun:test';

import type { Product } from '@selene/types';

import { type SellDraft, useSellStore } from '../store/use-sell-store';
import { buildEditEconomicsFields, classifyListingEdit } from './listing-edit';

const original = {
  category: 'GPU',
  name: 'RTX 3060',
  description: 'Like new',
  price: '1000',
  condition: 'used',
  usage: 'light',
  specifications: { vram: '12', brand: 'MSI' },
  images: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
  verificationImage: null,
  package_preset: 'medium',
  shipping_payer: 'seller',
  insurance_enabled: true,
  origin_zip: '01000',
  shipping_cost: '150',
} as unknown as SellDraft;

const edited = (patch: Partial<SellDraft>): SellDraft => ({
  ...original,
  ...patch,
});

describe('classifyListingEdit', () => {
  test('reports no change for an identical draft', () => {
    expect(classifyListingEdit(edited({}), original)).toEqual({
      sacredChanges: false,
      economicsChanges: false,
    });
  });

  test('a name or description edit is not sacred nor economic', () => {
    expect(
      classifyListingEdit(edited({ name: 'x', description: 'y' }), original),
    ).toEqual({ sacredChanges: false, economicsChanges: false });
  });

  test('a price-only change is economic', () => {
    expect(classifyListingEdit(edited({ price: '900' }), original)).toEqual({
      sacredChanges: false,
      economicsChanges: true,
    });
  });

  test('a shipping-cost-only change is economic', () => {
    expect(
      classifyListingEdit(edited({ shipping_cost: '200' }), original),
    ).toEqual({ sacredChanges: false, economicsChanges: true });
  });

  test('equal numeric strings are not a change', () => {
    expect(
      classifyListingEdit(
        edited({ price: '1000.00', shipping_cost: '150.0' }),
        original,
      ),
    ).toEqual({ sacredChanges: false, economicsChanges: false });
  });

  test('images, specifications and category are sacred', () => {
    expect(
      classifyListingEdit(edited({ images: ['file:///new.jpg'] }), original)
        .sacredChanges,
    ).toBe(true);
    expect(
      classifyListingEdit(
        edited({ specifications: { vram: '8', brand: 'MSI' } }),
        original,
      ).sacredChanges,
    ).toBe(true);
    expect(
      classifyListingEdit(
        edited({ category: 'CPU' as SellDraft['category'] }),
        original,
      ).sacredChanges,
    ).toBe(true);
  });

  test('a sacred change keeps economicsChanges false when price is equal', () => {
    expect(
      classifyListingEdit(edited({ images: ['file:///new.jpg'] }), original)
        .economicsChanges,
    ).toBe(false);
  });
});

describe('buildEditEconomicsFields', () => {
  const settings = {
    service_fee_pct: 0.1,
    shipping_buffer_cents: 2000,
    insurance_rate: 0.02,
  };

  test('returns the publication_* columns computed from the settings', () => {
    expect(
      buildEditEconomicsFields(
        edited({ price: '1000', shipping_cost: '150.50' }),
        settings,
      ),
    ).toEqual({
      publication_shipping_reserve_cents: 15050 + 2000 + 2000,
      publication_commission_rate: 0.1,
      publication_insurance_rate: 0.02,
    });
  });

  test('throws when the settings are invalid', () => {
    expect(() =>
      buildEditEconomicsFields(edited({}), {
        service_fee_pct: null,
        shipping_buffer_cents: 2000,
        insurance_rate: 0.02,
      }),
    ).toThrow('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
  });
});

describe('a listing loaded for edit', () => {
  test('is not an economics change until the seller edits a price', () => {
    useSellStore.getState().loadProductForEdit({
      id: 'prod-1',
      category: 'GPU',
      name: 'RTX 3060',
      description: 'Like new',
      price_cents: 123_456,
      shipping_cost_cents: 15_050,
      specifications: {},
      images: [],
    } as unknown as Product);
    const { draft, originalData } = useSellStore.getState();
    if (!originalData) throw new Error('originalData not loaded');

    expect(classifyListingEdit(draft, originalData).economicsChanges).toBe(
      false,
    );
    expect(
      classifyListingEdit({ ...draft, price: '1234.560' }, originalData)
        .economicsChanges,
    ).toBe(false);
    expect(
      classifyListingEdit({ ...draft, price: '1234.57' }, originalData)
        .economicsChanges,
    ).toBe(true);
    useSellStore.getState().resetDraft();
  });
});
