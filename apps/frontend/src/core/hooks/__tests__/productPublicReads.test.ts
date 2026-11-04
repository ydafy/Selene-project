import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Buyers read listings through the allow-list view `products_public` (T4d2).
// Once products_select_public is dropped (T4d3) a non-owner reads no table row,
// so every buyer read must target the view; owner and admin reads keep the table.
const root = join(import.meta.dir, '..', '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const BUYER_LIST_READS = [
  'core/hooks/useProducts.ts',
  'core/store/useRecentlyViewed.ts',
  'components/features/search/hooks/useSearchProducts.ts',
];

const BUYER_POINT_READS = [
  'core/hooks/useProductFavorite.ts',
  'components/features/product/hooks/useProductCart.ts',
  'core/services/order.ts',
];

const OWNER_READS = [
  'core/hooks/useMyListings.ts',
  'core/hooks/useVerificationLogic.ts',
  'core/hooks/usePublishProduct.ts',
  'core/hooks/useProductManagement.ts',
];

test.each([...BUYER_LIST_READS, ...BUYER_POINT_READS])(
  '%s reads the view, not the table',
  (file) => {
    const source = read(file);
    expect(source).toContain(".from('products_public')");
    expect(source).not.toContain(".from('products')");
  },
);

// The view already enforces deleted_at IS NULL and hides HIDDEN rows, and has
// no deleted_at column, so filtering on it would fail with a 400.
test.each([...BUYER_LIST_READS, ...BUYER_POINT_READS])(
  '%s does not filter on columns the view lacks',
  (file) => {
    const source = read(file);
    expect(source).not.toContain('deleted_at');
    expect(source).not.toContain(".neq('status', 'HIDDEN')");
  },
);

test.each(OWNER_READS)('%s keeps reading the products table', (file) => {
  const source = read(file);
  expect(source).toContain(".from('products')");
  expect(source).not.toContain('products_public');
});

test('favorites embed the product through the view', () => {
  for (const file of [
    'core/hooks/fetchMyFavorites.ts',
    'core/hooks/fetchAllFavorites.ts',
  ]) {
    const source = read(file);
    expect(source).toContain('product:products_public!inner');
    expect(source).not.toContain('products.deleted_at');
    expect(source).not.toMatch(/product:products!/);
  }
});

test('seller reviews embed the product name through the view', () => {
  const source = read('core/hooks/useSellerReviews.ts');
  expect(source).toContain('product:products_public(name)');
  expect(source).not.toContain('product:products(');
});

test('the product page reads the view first and falls back to the table for the owner', () => {
  const source = read('core/hooks/useProduct.ts');
  const view = source.indexOf(".from('products_public')");
  const table = source.indexOf(".from('products')");
  expect(view).toBeGreaterThan(-1);
  expect(table).toBeGreaterThan(view);
  expect(source).toContain('products_seller_id_fkey');
  // The view has no deleted_at; only the table fallback filters it.
  expect(source.slice(view, table)).not.toContain('deleted_at');
  expect(source.slice(table)).toContain(".is('deleted_at', null)");
});

test('purchases (buyer only) embed order item products through the view', () => {
  const source = read('core/hooks/useOrders.ts');
  const purchases = source.slice(
    source.indexOf('export const useMyPurchases'),
    source.indexOf('export const useMySales'),
  );
  expect(purchases).toContain('product:products_public(*)');
  expect(purchases).not.toContain('product:products(*)');
});

test('sales keep the table embed for the seller own products', () => {
  const source = read('core/hooks/useOrders.ts');
  const sales = source.slice(source.indexOf('export const useMySales'));
  expect(sales).toContain('), product:products(*)');
});

// Order and shipment detail serve buyers and sellers: the table embed answers
// for the owner (including RESERVED/IN_DISPUTE), the view embed for everyone
// else, and the result is merged into one `product`.
test.each(['core/hooks/useOrders.ts', 'core/hooks/useShipments.ts'])(
  '%s resolves shared order item products through both embeds',
  (file) => {
    const source = read(file);
    expect(source).toContain('ITEM_PRODUCT_EMBED');
    expect(source).toContain('mergeItemProducts');
  },
);

// The product page result depends on who asks (view row, or the owner's table
// row), so the cache key carries the user: a session that arrives late refetches
// instead of keeping a cached "not found" for the owner.
test('the product page caches per user', () => {
  expect(read('core/hooks/useProduct.ts')).toContain(
    "queryKey: ['product', id, userId ?? null]",
  );
});

test('the cart status refresh updates every user-scoped product cache entry', () => {
  const source = read('components/features/product/hooks/useProductCart.ts');
  expect(source).toMatch(
    /setQueriesData\(\s*\{ queryKey: \['product', product\.id\] \},/,
  );
  expect(source).not.toContain('setQueryData(');
});
