import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./prepare-shipment-screen.tsx', import.meta.url),
  'utf8',
);

const hook = readFileSync(
  new URL('../hooks/use-prepare-shipment.ts', import.meta.url),
  'utf8',
);

test('requires a selected seller-owned product shipment before generating a label', () => {
  expect(source).toContain('usePrepareShipment(');
  expect(hook).toContain('const { id, shipment_id } = useLocalSearchParams');
  expect(hook).toContain('const sellerShipments = useMemo');
  expect(hook).toContain('const selectedShipment = useMemo');
  expect(hook).toContain('shipment.seller_id === userId');
  expect(hook).toContain('if (!selectedShipmentId) return null;');
  expect(hook).toContain(
    'sellerShipments.find((shipment) => shipment.id === selectedShipmentId)',
  );
  expect(hook).toContain('const targetShipmentId = selectedShipment?.id;');
  expect(hook).toContain('export const EVIDENCE_MIN_PHOTOS = 3;');
  expect(hook).toMatch(
    /const handleConfirm = async \(\) => \{\s*if\s*\(\s*!mounted\.current\s*\|\|\s*submissionInFlight\.current\s*\|\|\s*evidenceBusy\.current\s*\|\|\s*isProcessing\s*\|\|\s*!selectedOrigin\s*\|\|\s*!targetShipmentId\s*\|\|\s*boxBlocked\s*\|\|\s*!canGenerateLabel\s*\|\|\s*evidenceUrls\.length < EVIDENCE_MIN_PHOTOS\s*\)\s*return;/,
  );
  expect(hook).toContain('shipmentId: targetShipmentId');
  expect(hook).toContain(
    "const canGenerateLabel = labelState === 'ready' && !isFetching;",
  );
});

test('lists each seller-owned shipment and does not fall back to the first one', () => {
  const selector = readFileSync(
    new URL('../components/prepare-shipment-selector.tsx', import.meta.url),
    'utf8',
  );
  expect(source).toContain('<PrepareShipmentSelector');
  expect(source).toContain('shipments={sellerShipments}');
  expect(source).toContain('selectedShipmentId={selectedShipment?.id}');
  expect(source).toContain('router.setParams({ shipment_id: shipmentId })');
  expect(selector).toContain('shipments.map((shipment) =>');
  expect(selector).toContain('onSelect(shipment.id)');
  expect(source).not.toContain('find((s) => s.seller_id === userId)');
});
