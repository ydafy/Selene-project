import { describe, expect, it } from 'bun:test';

import {
  buildConnectRollbackRefundParams,
  extractProductIdsFromIntentMetadata,
  mergeUniqueProductIds,
  parseAllocationProductIds,
  parseProductIdsMetadata,
} from './rollback-connect-payment';

describe('rollback-connect-payment helpers', () => {
  it('deduplicates valid product IDs from PaymentIntent metadata', () => {
    expect(parseProductIdsMetadata('["p1","p2","p1"]')).toEqual({
      productIds: ['p1', 'p2'],
      malformed: false,
    });
  });

  it('ignores missing or malformed product_ids metadata without throwing', () => {
    expect(parseProductIdsMetadata(undefined)).toEqual({
      productIds: [],
      malformed: false,
    });
    expect(parseProductIdsMetadata('not-json')).toEqual({
      productIds: [],
      malformed: true,
    });
    expect(parseProductIdsMetadata('{"productIds":["p1"]}')).toEqual({
      productIds: [],
      malformed: true,
    });
  });

  it('merges product IDs uniquely across payment intents', () => {
    expect(mergeUniqueProductIds(['p1', 'p2'], ['p2', 'p3'])).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('builds Connect refund params that reverse seller transfers', () => {
    expect(
      buildConnectRollbackRefundParams({
        paymentIntentId: 'pi_123',
        orderId: 'order_123',
      }),
    ).toEqual({
      payment_intent: 'pi_123',
      reason: 'requested_by_customer',
      reverse_transfer: true,
      metadata: {
        order_id: 'order_123',
        rollback_reason: 'partial_connect_checkout_failure',
      },
    });
  });
});

describe('single-modal allocation metadata rollback extraction', () => {
  // Helper that mirrors the chunking performed by
  // create-connect-payment/single-payment-builder.ts so the rollback path is
  // tested against the EXACT metadata shape the checkout writes.
  const buildAllocationMetadata = (
    rows: Array<{ productIds: string[] }>,
    maxLen = 500,
  ): Record<string, string> => {
    const compact = {
      rows: rows.map((r) => ({
        sellerId: 'seller-1',
        shipmentId: `ship-${rows.indexOf(r)}`,
        productIds: r.productIds,
        grossCents: 100,
        commissionCents: 10,
        shippingCents: 20,
        seguroCents: 5,
        netCents: 70,
      })),
    };
    const json = JSON.stringify(compact);
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += maxLen) {
      chunks.push(json.slice(i, i + maxLen));
    }
    const meta: Record<string, string> = {
      allocation_chunk_count: String(chunks.length),
    };
    chunks.forEach((chunk, i) => {
      meta[`allocation_json_${i}`] = chunk;
    });
    return meta;
  };

  it('returns empty (not malformed) when metadata has no allocation chunks (legacy intent)', () => {
    expect(parseAllocationProductIds({ product_ids: '["p1"]' })).toEqual({
      productIds: [],
      malformed: false,
    });
    expect(parseAllocationProductIds({})).toEqual({
      productIds: [],
      malformed: false,
    });
  });

  it('extracts every product id from a single-modal allocation blob (one chunk)', () => {
    const meta = buildAllocationMetadata([
      { productIds: ['p1', 'p2'] },
      { productIds: ['p3'] },
    ]);
    expect(parseAllocationProductIds(meta)).toEqual({
      productIds: ['p1', 'p2', 'p3'],
      malformed: false,
    });
  });

  it('extracts every product id from a multi-chunk allocation blob', () => {
    // Force chunking by shrinking the per-chunk limit so a realistic
    // multi-seller allocation spans several allocation_json_N keys.
    const meta = buildAllocationMetadata(
      [
        { productIds: ['p1', 'p2', 'p3'] },
        { productIds: ['p4', 'p5'] },
        { productIds: ['p6'] },
      ],
      40,
    );
    expect(Number(meta.allocation_chunk_count)).toBeGreaterThan(1);
    expect(parseAllocationProductIds(meta)).toEqual({
      productIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      malformed: false,
    });
  });

  it('deduplicates product ids that appear across multiple seller rows', () => {
    const meta = buildAllocationMetadata([
      { productIds: ['p1', 'p2'] },
      { productIds: ['p2', 'p3'] },
    ]);
    expect(parseAllocationProductIds(meta)).toEqual({
      productIds: ['p1', 'p2', 'p3'],
      malformed: false,
    });
  });

  it('marks malformed and returns empty when a declared chunk is missing', () => {
    const meta = buildAllocationMetadata([{ productIds: ['p1', 'p2'] }]);
    // Declare one extra chunk that was never written.
    meta.allocation_chunk_count = String(
      Number(meta.allocation_chunk_count) + 1,
    );
    expect(parseAllocationProductIds(meta)).toEqual({
      productIds: [],
      malformed: true,
    });
  });

  it('marks malformed when the joined blob is not valid JSON', () => {
    const meta: Record<string, string> = {
      allocation_chunk_count: '1',
      allocation_json_0: 'not-json',
    };
    expect(parseAllocationProductIds(meta)).toEqual({
      productIds: [],
      malformed: true,
    });
  });

  it('marks malformed when the parsed blob has no rows array', () => {
    const meta: Record<string, string> = {
      allocation_chunk_count: '1',
      allocation_json_0: JSON.stringify({ noRows: true }),
    };
    expect(parseAllocationProductIds(meta)).toEqual({
      productIds: [],
      malformed: true,
    });
  });

  it('tolerates a malformed row by skipping it but still extracts valid ids', () => {
    const compact = {
      rows: [
        { sellerId: 's1', shipmentId: 'sh1', productIds: ['p1', 'p2'] },
        { sellerId: 's2', shipmentId: 'sh2', productIds: 'not-an-array' },
      ],
    };
    const meta: Record<string, string> = {
      allocation_chunk_count: '1',
      allocation_json_0: JSON.stringify(compact),
    };
    const result = parseAllocationProductIds(meta);
    expect(result.productIds).toEqual(['p1', 'p2']);
    expect(result.malformed).toBe(true);
  });

  it('extractProductIdsFromIntentMetadata reads both legacy and single-modal sources', () => {
    // Legacy intent: only top-level product_ids.
    const legacyMeta = { product_ids: '["p1","p2"]' };
    expect(extractProductIdsFromIntentMetadata(legacyMeta)).toEqual({
      productIds: ['p1', 'p2'],
      malformed: false,
    });

    // Single-modal intent: only chunked allocation.
    const singleMeta = buildAllocationMetadata([
      { productIds: ['p3', 'p4'] },
      { productIds: ['p5'] },
    ]);
    expect(extractProductIdsFromIntentMetadata(singleMeta)).toEqual({
      productIds: ['p3', 'p4', 'p5'],
      malformed: false,
    });
  });

  it('extractProductIdsFromIntentMetadata merges both sources if both were ever present', () => {
    const meta: Record<string, string> = {
      product_ids: '["p-shared"]',
      ...buildAllocationMetadata([{ productIds: ['p-alloc'] }]),
    };
    expect(extractProductIdsFromIntentMetadata(meta)).toEqual({
      productIds: ['p-shared', 'p-alloc'],
      malformed: false,
    });
  });

  it('extractProductIdsFromIntentMetadata returns empty (not malformed) for undefined metadata', () => {
    expect(extractProductIdsFromIntentMetadata(undefined)).toEqual({
      productIds: [],
      malformed: false,
    });
  });

  it('issue regression: single-modal rollback releases all RESERVED product ids (full lifecycle)', () => {
    // Reproduces Blocker 1: before the fix, the rollback only read
    // product_ids and returned [] for single-modal intents, leaving products
    // RESERVED. After the fix, the allocation blob yields every product id.
    const meta = buildAllocationMetadata([
      { productIds: ['prod-a', 'prod-b'] },
      { productIds: ['prod-c'] },
      { productIds: ['prod-d', 'prod-e'] },
    ]);
    const extracted = extractProductIdsFromIntentMetadata(meta);
    expect(extracted.productIds).toEqual([
      'prod-a',
      'prod-b',
      'prod-c',
      'prod-d',
      'prod-e',
    ]);
    expect(extracted.malformed).toBe(false);
  });
});
