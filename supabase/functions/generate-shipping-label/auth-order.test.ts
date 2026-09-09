import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('authorizes the seller before returning existing label details', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const ownership = source.indexOf('if (shipment.seller_id !== user.id)');
  const existingLabel = source.indexOf('if (shipment.tracking_number)');

  expect(ownership).toBeGreaterThan(-1);
  expect(existingLabel).toBeGreaterThan(ownership);
});

test('replays a concurrently finalized label instead of treating the second request as a conflict', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  expect(source).toContain("result.status === 'generated' && !result.accepted");
  expect(source).toContain(".select('label_url, tracking_number')");
  expect(source).toContain('LABEL_GENERATION_CONFLICT');
});

test('checks buyer destination before seller throughput guards can mask the correction request', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const buyerDestination = source.indexOf(
    'const buyerDestination = buildBuyerDestinationFromStoredSnapshot(',
  );
  const activeShipmentQuery = source.indexOf('const [completedRes, activeRes]');

  expect(buyerDestination).toBeGreaterThan(-1);
  expect(activeShipmentQuery).toBeGreaterThan(buyerDestination);
  expect(source).toContain('if (preflightError) throw new ApiError(422, preflightError)');
});
