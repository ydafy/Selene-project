import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import '../_shared/__tests__/zod-runtime.bun.preload.ts';

const { LabelRequestSchema, REQUIRED_SHIPPING_EVIDENCE_IMAGES } = await import(
  './request-contract.ts'
);

const shipmentId = '7b8f3c1e-2a4d-4f6b-9c0e-1d2e3f4a5b6c';
const originAddressId = '0c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const photo = (slot: number) =>
  `https://storage.example.com/evidence/order/seller/slot_${slot}.jpg`;

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

  it('stores trimmed evidence URLs and treats whitespace-padded repeats as duplicates', () => {
    const padded = [` ${photo(0)} `, ` ${photo(1)}`, `${photo(2)} `];
    const result = LabelRequestSchema.safeParse(request(padded));

    expect(result.success).toBe(true);
    expect(result.success && result.data.shippingEvidence.images).toEqual([
      photo(0),
      photo(1),
      photo(2),
    ]);
    expect(evidenceIssues([photo(0), ` ${photo(0)} `, photo(1)])[0].message).toBe(
      'Las fotos de evidencia no pueden repetirse',
    );
  });

  it('keeps accepting deterministic and previously accepted identifier formats', () => {
    const images = [photo(0), photo(1), photo(2)];
    const deterministicV5 = '2ed6657d-e927-568b-95e1-2665a8aea6a2';
    const formatOnlyGuid = '00000000-0000-0000-0000-000000000001';

    expect(
      LabelRequestSchema.safeParse({ ...request(images), shipmentId: deterministicV5 })
        .success,
    ).toBe(true);
    expect(
      LabelRequestSchema.safeParse({
        ...request(images),
        shipmentId: formatOnlyGuid,
        originAddressId: formatOnlyGuid,
      }).success,
    ).toBe(true);
  });

  it('keeps rejecting invalid identifiers and non-URL evidence', () => {
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

    expect(evidenceIssues([photo(0), photo(1), 'not-a-url'])).toEqual([]);
    expect(
      LabelRequestSchema.safeParse(request([photo(0), photo(1), 'not-a-url']))
        .success,
    ).toBe(false);
  });

  it('validates the request before authentication, persistence, or provider work', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const parse = source.indexOf('LabelRequestSchema.safeParse(body)');
    const clientCreation = source.indexOf('const supabaseAdmin = createClient(');
    const evidenceWrite = source.indexOf('shipping_evidence: shippingEvidence.images');
    const claim = source.indexOf('runLabelClaimOrchestration({');

    expect(source).toContain("from './request-contract.ts'");
    expect(source).not.toContain('const RequestSchema');
    expect(parse).toBeGreaterThan(-1);
    expect(clientCreation).toBeGreaterThan(parse);
    expect(evidenceWrite).toBeGreaterThan(parse);
    expect(claim).toBeGreaterThan(parse);
  });
});
