import { describe, expect, it } from 'bun:test';
import '../_shared/__tests__/zod-runtime.bun.preload.ts';

const {
  LabelRequestSchema,
  REQUIRED_SHIPPING_EVIDENCE_IMAGES,
  isOwnShippingEvidencePath,
} = await import('./request-contract.ts');

const shipmentId = '7b8f3c1e-2a4d-4f6b-9c0e-1d2e3f4a5b6c';
const originAddressId = '0c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const orderId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const sellerId = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const otherId = '5d4c3b2a-1f0e-4d9c-8b7a-695847362514';
const photo = (slot: number) =>
  `shipments/${orderId}/${sellerId}/slot_${slot}_1700000000000.jpg`;

const request = (images: unknown) => ({
  shipmentId,
  originAddressId,
  shippingEvidence: { images },
});

const evidenceIssues = (images: unknown) => {
  const result = LabelRequestSchema.safeParse(request(images));
  expect(result.success).toBe(false);
  return result.success
    ? []
    : result.error.issues.filter(
        (issue) => issue.path.join('.') === 'shippingEvidence.images',
      );
};

describe('generate-shipping-label request contract', () => {
  it('accepts exactly the required number of distinct evidence photos unchanged', () => {
    const images = [photo(0), photo(1), photo(2)];
    const result = LabelRequestSchema.safeParse(request(images));

    expect(REQUIRED_SHIPPING_EVIDENCE_IMAGES).toBe(3);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(request(images));
  });

  it('rejects an empty evidence list', () => {
    const issues = evidenceIssues([]);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('Se requieren 3 fotos de evidencia');
  });

  it('rejects fewer or more photos than the required evidence slots', () => {
    expect(evidenceIssues([photo(0), photo(1)])[0].message).toBe(
      'Se requieren 3 fotos de evidencia',
    );
    expect(
      evidenceIssues([photo(0), photo(1), photo(2), photo(3)])[0].message,
    ).toBe('Se requieren 3 fotos de evidencia');
  });

  it('rejects a repeated photo that would fill several evidence slots', () => {
    const issues = evidenceIssues([photo(0), photo(0), photo(1)]);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe(
      'Las fotos de evidencia no pueden repetirse',
    );
  });

  it('stores trimmed evidence paths and treats whitespace-padded repeats as duplicates', () => {
    const padded = [` ${photo(0)} `, ` ${photo(1)}`, `${photo(2)} `];
    const result = LabelRequestSchema.safeParse(request(padded));

    expect(result.success).toBe(true);
    expect(result.success && result.data.shippingEvidence.images).toEqual([
      photo(0),
      photo(1),
      photo(2),
    ]);
    expect(
      evidenceIssues([photo(0), ` ${photo(0)} `, photo(1)])[0].message,
    ).toBe('Las fotos de evidencia no pueden repetirse');
  });

  it('keeps accepting deterministic and previously accepted identifier formats', () => {
    const images = [photo(0), photo(1), photo(2)];
    const deterministicV5 = '2ed6657d-e927-568b-95e1-2665a8aea6a2';
    const formatOnlyGuid = '00000000-0000-0000-0000-000000000001';

    expect(
      LabelRequestSchema.safeParse({
        ...request(images),
        shipmentId: deterministicV5,
      }).success,
    ).toBe(true);
    expect(
      LabelRequestSchema.safeParse({
        ...request(images),
        shipmentId: formatOnlyGuid,
        originAddressId: formatOnlyGuid,
      }).success,
    ).toBe(true);
  });

  it('keeps rejecting invalid identifiers and blank evidence', () => {
    const invalidIds = LabelRequestSchema.safeParse({
      ...request([photo(0), photo(1), photo(2)]),
      shipmentId: 'not-a-uuid',
      originAddressId: 'not-a-uuid',
    });
    expect(invalidIds.success).toBe(false);
    expect(
      invalidIds.success
        ? []
        : invalidIds.error.issues.map((issue) => issue.path.join('.')),
    ).toEqual(['shipmentId', 'originAddressId']);

    expect(evidenceIssues([photo(0), photo(1), '  '])).toEqual([]);
    expect(
      LabelRequestSchema.safeParse(request([photo(0), photo(1), '  '])).success,
    ).toBe(false);
  });
});

describe('isOwnShippingEvidencePath', () => {
  it("accepts a packing photo stored under the seller's folder for the order", () => {
    expect(isOwnShippingEvidencePath(photo(0), orderId, sellerId)).toBe(true);
  });

  it.each([
    ['another user folder', `shipments/${orderId}/${otherId}/slot_0.jpg`],
    ['another order folder', `shipments/${otherId}/${sellerId}/slot_0.jpg`],
    ['another evidence folder', `disputes/${orderId}/${sellerId}/slot_0.jpg`],
    [
      'a URL',
      `https://example.test/storage/v1/object/public/evidence/${photo(0)}`,
    ],
    ['a parent segment', `shipments/${orderId}/${sellerId}/../slot_0.jpg`],
    ['a leading slash', `/${photo(0)}`],
    ['a nested folder', `shipments/${orderId}/${sellerId}/a/slot_0.jpg`],
    ['a missing file name', `shipments/${orderId}/${sellerId}/`],
  ])('rejects a path in %s', (_case, path) => {
    expect(isOwnShippingEvidencePath(path, orderId, sellerId)).toBe(false);
  });
});
