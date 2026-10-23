import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dir, '..', 'useRecentlyViewed.ts'),
  'utf8',
);

// Home "recently viewed" must keep showing only VERIFIED and SOLD listings
// once products_select_public also exposes PENDING_VERIFICATION and IN_REVIEW.
test('useRecentlyViewed pins status to VERIFIED and SOLD instead of relying on RLS', () => {
  expect(source).toMatch(/\.in\('status', \['VERIFIED', 'SOLD'\]\)/);
  expect(source).not.toContain("'(HIDDEN,REJECTED)'");
});

test('useRecentlyViewed keeps reading only the viewed ids in history order', () => {
  expect(source).toContain(".in('id', viewedIds)");
  expect(source).toContain('viewedIds.indexOf(a.id) - viewedIds.indexOf(b.id)');
});
