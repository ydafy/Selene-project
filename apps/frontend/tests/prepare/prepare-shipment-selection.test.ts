import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../app/profile/orders/prepare/[id].tsx', import.meta.url),
  'utf8',
);

test('requires a selected seller-owned product shipment before generating a label', () => {
  expect(source).toContain('const { id, shipment_id } = useLocalSearchParams');
  expect(source).toContain('const sellerShipments = useMemo');
  expect(source).toContain('const selectedShipment = useMemo');
  expect(source).toContain('if (!selectedOrigin || !targetShipmentId');
  expect(source).toContain('shipmentId: targetShipmentId');
});

test('lists each seller-owned shipment and does not fall back to the first one', () => {
  expect(source).toContain('sellerShipments.map((shipment) =>');
  expect(source).toContain('router.setParams({ shipment_id: shipment.id })');
  expect(source).not.toContain('find((s) => s.seller_id === userId)');
});
