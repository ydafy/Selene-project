import { describe, expect, it } from 'bun:test';

import { SellDraft } from '../store/useSellStore';
import { buildPreviewProduct, PreviewSellerInfo } from './previewProductBuilder';

const seller: PreviewSellerInfo = {
  id: 'user-1',
  username: 'seller_user',
  avatar_url: null,
  is_verified_seller: false,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: null,
};

const baseDraft: SellDraft = {
  id: undefined,
  category: 'GPU',
  name: 'RTX 3080',
  description: 'Great GPU',
  price: '5000',
  condition: 'Used',
  usage: '1 year',
  specifications: { brand: 'ASUS' },
  images: ['file://photo.jpg'],
  verificationImage: null,
  package_preset: 'gpu_1',
  shipping_payer: 'seller',
  insurance_enabled: true,
  origin_zip: '64000',
  shipping_cost: '150',
};

describe('buildPreviewProduct', () => {
  it('maps draft fields to the preview product', () => {
    const preview = buildPreviewProduct(baseDraft, seller);

    expect(preview.id).toBe('preview_mode');
    expect(preview.name).toBe('RTX 3080');
    expect(preview.price).toBe(5000);
    expect(preview.category).toBe('GPU');
    expect(preview.condition).toBe('Used');
    expect(preview.usage).toBe('1 year');
    expect(preview.images).toEqual(['file://photo.jpg']);
    expect(preview.specifications).toEqual({ brand: 'ASUS' });
    expect(preview.shipping_cost).toBe(150);
    expect(preview.origin_zip).toBe('64000');
  });

  it('uses the provided seller info', () => {
    const preview = buildPreviewProduct(baseDraft, seller);

    expect(preview.seller).toEqual(seller);
    expect(preview.seller_id).toBe('user-1');
  });

  it('keeps the draft id when present', () => {
    const preview = buildPreviewProduct({ ...baseDraft, id: 'prod-123' }, seller);

    expect(preview.id).toBe('prod-123');
  });

  it('falls back to zero shipping cost and buyer payer when missing', () => {
    const preview = buildPreviewProduct(
      { ...baseDraft, shipping_cost: '', shipping_payer: 'buyer' },
      seller,
    );

    expect(preview.shipping_cost).toBe(0);
    expect(preview.shipping_payer).toBe('buyer');
  });
});
