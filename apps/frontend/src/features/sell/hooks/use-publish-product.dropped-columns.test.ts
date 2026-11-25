import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// #651: verification state lives in product_verifications; publish must not
// write the products columns that T7 drops.
const source = readFileSync(
  join(import.meta.dir, 'use-publish-product.ts'),
  'utf8',
);

describe('usePublishProduct', () => {
  it('writes none of the dropped verification columns', () => {
    for (const column of [
      'verification_data',
      'rejection_reason',
      'verified_at',
      'locked_by',
      'locked_at',
    ]) {
      expect(source).not.toContain(column);
    }
  });
});
