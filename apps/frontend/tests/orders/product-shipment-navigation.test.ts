import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const detail = readFileSync(new URL('./[id].tsx', import.meta.url), 'utf8');
const summary = readFileSync(new URL('./summary/[id].tsx', import.meta.url), 'utf8');

test('uses the product-shipment summary as the default order detail view', () => {
  expect(detail).toContain("router.replace(`/profile/orders/summary/${id}` as any)");
  expect(detail).toContain('if (!source || source.length === 0 || !shipmentId) return null;');
});

test('labels the summary count as packages rather than sellers', () => {
  expect(summary).toContain("t('orders:summary.packageCount'");
  expect(summary).toContain("'paquete' : 'paquetes'");
});
