import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) =>
  readFileSync(join(import.meta.dir, file), 'utf8');

const explicitPublicStatuses = /\.in\('status', \['VERIFIED', 'SOLD'\]\)/;

test('useProducts pins status explicitly instead of relying on RLS', () => {
  expect(read('../../../shared/hooks/use-products.ts')).toContain(
    ".in('status', resolveProductStatuses(options))",
  );
});

// products_public already enforces deleted_at IS NULL and hides HIDDEN rows
// (T4d2); it has no deleted_at column, so filtering on it would fail.
test('useProducts keeps verifiedOnly, ordering and limit on the view', () => {
  const source = read('../../../shared/hooks/use-products.ts');
  expect(source).toContain(".from('products_public')");
  expect(source).not.toContain('deleted_at');
  expect(source).not.toContain(".neq('status', 'HIDDEN')");
  expect(source).toContain(".eq('status', 'VERIFIED')");
  expect(source).toContain(".order('created_at', { ascending: false })");
  expect(source).toContain('.limit(options.limit)');
});

// These reads must keep seeing PENDING_VERIFICATION and IN_REVIEW once
// products_select_public opens, so none may pin a public status list.
test.each([
  'use-product.ts',
  'use-product-favorite.ts',
  '../../../core/hooks/useMyListings.ts',
  '../../verify/hooks/use-verification-logic.ts',
])('%s has no VERIFIED-only filter', (file) => {
  const source = read(file);
  expect(source).not.toMatch(explicitPublicStatuses);
  expect(source).not.toContain(".eq('status', 'VERIFIED')");
});

test.each([
  '../../../core/hooks/fetchMyFavorites.ts',
  '../../../core/hooks/fetchAllFavorites.ts',
])('%s has no status filter', (file) => {
  expect(read(file)).not.toMatch(/status/);
});

test('the favorite toggle existence check has no status filter', () => {
  expect(read('use-product-favorite.ts')).not.toMatch(/status/);
});

test('the cart gate has no VERIFIED-only query filter', () => {
  const source = readFileSync(
    join(
      import.meta.dir,
      '..',
      '..',
      '..',
      'features/product/hooks/use-product-cart.ts',
    ),
    'utf8',
  );
  expect(source).not.toMatch(explicitPublicStatuses);
  expect(source).not.toContain(".eq('status', 'VERIFIED')");
});
