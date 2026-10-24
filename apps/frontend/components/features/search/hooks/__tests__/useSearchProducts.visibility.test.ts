import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dir, '..', 'useSearchProducts.ts'),
  'utf8',
);

// Shop lists show listings in verification too (L31); the verified chip
// narrows them to VERIFIED. RLS is never the presentation filter.
test('search lists pin status to the buyer-listed statuses instead of relying on RLS', () => {
  expect(source).toContain(".in('status', BUYER_LISTED_STATUSES)");
  expect(source).not.toMatch(/\.in\('status', \['VERIFIED', 'SOLD'\]\)/);
});

test('search keeps its deleted_at, HIDDEN and verifiedOnly filters', () => {
  expect(source).toContain(".is('deleted_at', null)");
  expect(source).toContain(".neq('status', 'HIDDEN')");
  expect(source).toContain(".eq('status', 'VERIFIED')");
});
