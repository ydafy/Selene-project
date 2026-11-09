import { expect, it } from 'bun:test';

const { buildStoredShippingEvidence } = await import('./shipping-evidence.ts');

const orderId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const sellerId = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const photo = (slot: number) =>
  `shipments/${orderId}/${sellerId}/slot_${slot}_1700000000000.jpg`;

it('stores packing photos as an object with the evidence paths under images', () => {
  const images = [photo(0), photo(1), photo(2)];

  expect(buildStoredShippingEvidence(images)).toEqual({
    images: [photo(0), photo(1), photo(2)],
  });
});
