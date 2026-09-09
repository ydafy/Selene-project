import { expect, test } from 'bun:test';

const registrySource = await Bun.file(
  new URL('./index.ts', import.meta.url),
).text();

test('registers the confirmation function with its request payload', () => {
  expect(registrySource).toMatch(
    /'confirm-shipment-delivery': \{\s+payload: \{\s+orderId: string;\s+shipmentId: string;\s+idempotencyKey: string;\s+\};\s+response:/,
  );
});

test('registers the canonical confirmation response contract', () => {
  expect(registrySource).toMatch(
    /response:\s+\| \{\s+success: true;\s+shipmentId: string;\s+status: 'completed';\s+completionSource: 'buyer' \| 'auto';\s+idempotent: boolean;\s+\}\s+\| \{ success: false; error: string \};/,
  );
});
