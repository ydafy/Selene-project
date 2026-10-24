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

// The view enforces deleted_at and HIDDEN itself and has no deleted_at column.
test('search reads the view and keeps its textSearch and verifiedOnly filters', () => {
  expect(source).toContain(".from('products_public')");
  expect(source).not.toContain('deleted_at');
  expect(source).not.toContain(".neq('status', 'HIDDEN')");
  expect(source).toContain(".textSearch('fts'");
  expect(source).toContain(".eq('status', 'VERIFIED')");
});
