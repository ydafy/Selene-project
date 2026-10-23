import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) =>
  readFileSync(join(import.meta.dir, '..', file), 'utf8');

const explicitPublicStatuses = /\.in\('status', \['VERIFIED', 'SOLD'\]\)/;

test('useProducts pins status to VERIFIED and SOLD instead of relying on RLS', () => {
  expect(read('useProducts.ts')).toMatch(explicitPublicStatuses);
});

test('useProducts keeps deleted_at, HIDDEN, verifiedOnly, ordering and limit', () => {
  const source = read('useProducts.ts');
  expect(source).toContain(".is('deleted_at', null)");
  expect(source).toContain(".neq('status', 'HIDDEN')");
  expect(source).toContain(".eq('status', 'VERIFIED')");
  expect(source).toContain(".order('created_at', { ascending: false })");
  expect(source).toContain('.limit(options.limit)');
});

// These reads must keep seeing PENDING_VERIFICATION and IN_REVIEW once
// products_select_public opens, so none may pin a public status list.
test.each([
  'useProduct.ts',
  'useProductFavorite.ts',
  'useMyListings.ts',
  'useVerificationLogic.ts',
])('%s has no VERIFIED-only filter', (file) => {
  const source = read(file);
  expect(source).not.toMatch(explicitPublicStatuses);
  expect(source).not.toContain(".eq('status', 'VERIFIED')");
});

test.each(['fetchMyFavorites.ts', 'fetchAllFavorites.ts'])(
  '%s has no status filter',
  (file) => {
    expect(read(file)).not.toMatch(/status/);
  },
);

test('the favorite toggle existence check has no status filter', () => {
  expect(read('useProductFavorite.ts')).not.toMatch(/status/);
});

test('the cart gate has no VERIFIED-only query filter', () => {
  const source = readFileSync(
    join(
      import.meta.dir,
      '..',
      '..',
      '..',
      'components/features/product/hooks/useProductCart.ts',
    ),
    'utf8',
  );
  expect(source).not.toMatch(explicitPublicStatuses);
  expect(source).not.toContain(".eq('status', 'VERIFIED')");
});
