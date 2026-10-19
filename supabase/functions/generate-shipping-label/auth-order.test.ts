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

test('writes packing evidence only through the claim-token guarded orchestration step', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const orchestration = source.indexOf('runLabelClaimOrchestration({');
  const evidenceWrite = source.indexOf('shipping_evidence: shippingEvidence.images');
  const persistStep = source.indexOf('persistEvidence: async (token) => {');
  const guardedWrite = source.slice(persistStep, source.indexOf('rateAndPersist: async', persistStep));

  expect(source.match(/shipping_evidence:/g)).toHaveLength(1);
  expect(evidenceWrite).toBeGreaterThan(orchestration);
  expect(persistStep).toBeGreaterThan(orchestration);
  expect(guardedWrite).toContain(".eq('claim_token', token)");
  expect(guardedWrite).toContain(".eq('label_generation_state', 'claimed')");
  expect(guardedWrite).toContain('.select(');
  expect(source).toContain("p_error_class: reason ?? 'deterministic_provider_rejection'");
  expect(source).toContain("result.status === 'evidence_persistence_released'");
  expect(source).toContain("result.status === 'evidence_state_persistence_failed'");
  expect(source).toContain("throw new ApiError(500, 'No se pudo guardar la evidencia de envío')");
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
