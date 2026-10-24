import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dir, '..', 'useRecentlyViewed.ts'),
  'utf8',
);

// Home "recently viewed" also shows listings in verification (L31), but
// never rejected, hidden, reserved or disputed ones.
test('useRecentlyViewed pins status to the buyer-listed statuses instead of relying on RLS', () => {
  expect(source).toContain(".in('status', BUYER_LISTED_STATUSES)");
  expect(source).not.toMatch(/\.in\('status', \['VERIFIED', 'SOLD'\]\)/);
  expect(source).not.toContain("'(HIDDEN,REJECTED)'");
});

test('useRecentlyViewed keeps reading only the viewed ids in history order', () => {
  expect(source).toContain(".in('id', viewedIds)");
  expect(source).toContain('viewedIds.indexOf(a.id) - viewedIds.indexOf(b.id)');
});
