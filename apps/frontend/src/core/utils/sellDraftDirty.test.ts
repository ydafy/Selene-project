import { describe, expect, it } from 'bun:test';

import { SellDraft } from '../store/useSellStore';
import { isSellDraftDirty } from './sellDraftDirty';

const emptyDraft: SellDraft = {
  category: null,
  name: '',
  description: '',
  price: '',
  condition: '',
  usage: '',
  specifications: {},
  images: [],
  verificationImage: null,
  package_preset: 'gpu_1',
  shipping_payer: 'seller',
  insurance_enabled: true,
  origin_zip: '',
  shipping_cost: '0',
};

describe('isSellDraftDirty', () => {
  it('returns false for an empty draft', () => {
    expect(isSellDraftDirty(emptyDraft)).toBe(false);
  });

  it('returns false when only a category is selected', () => {
    expect(isSellDraftDirty({ ...emptyDraft, category: 'GPU' })).toBe(false);
  });

  it('returns true when the title is filled', () => {
    expect(
      isSellDraftDirty({ ...emptyDraft, category: 'GPU', name: 'RTX 3080' }),
    ).toBe(true);
  });

  it('returns true when the price is filled', () => {
    expect(
      isSellDraftDirty({ ...emptyDraft, category: 'GPU', price: '5000' }),
    ).toBe(true);
  });

  it('returns true when condition is filled', () => {
    expect(
      isSellDraftDirty({ ...emptyDraft, category: 'GPU', condition: 'Used' }),
    ).toBe(true);
  });

  it('returns true when usage is filled', () => {
    expect(
      isSellDraftDirty({ ...emptyDraft, category: 'GPU', usage: '1 year' }),
    ).toBe(true);
  });

  it('returns true when description is filled', () => {
    expect(
      isSellDraftDirty({
        ...emptyDraft,
        category: 'GPU',
        description: 'Good condition',
      }),
    ).toBe(true);
  });

  it('returns true when origin zip is filled', () => {
    expect(
      isSellDraftDirty({ ...emptyDraft, category: 'GPU', origin_zip: '64000' }),
    ).toBe(true);
  });

  it('returns true when specifications exist', () => {
    expect(
      isSellDraftDirty({
        ...emptyDraft,
        category: 'GPU',
        specifications: { brand: 'ASUS' },
      }),
    ).toBe(true);
  });

  it('returns true when images exist', () => {
    expect(
      isSellDraftDirty({
        ...emptyDraft,
        category: 'GPU',
        images: ['file://photo.jpg'],
      }),
    ).toBe(true);
  });
});
