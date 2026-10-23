import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dir, '..', 'useSearchProducts.ts'),
  'utf8',
);

test('search lists pin status to VERIFIED and SOLD instead of relying on RLS', () => {
  expect(source).toMatch(/\.in\('status', \['VERIFIED', 'SOLD'\]\)/);
});

test('search keeps its deleted_at, HIDDEN and verifiedOnly filters', () => {
  expect(source).toContain(".is('deleted_at', null)");
  expect(source).toContain(".neq('status', 'HIDDEN')");
  expect(source).toContain(".eq('status', 'VERIFIED')");
});
