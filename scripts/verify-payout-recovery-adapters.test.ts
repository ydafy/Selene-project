import { expect, test } from 'bun:test';
import { verifyPayoutRecoveryAdapters } from './verify-payout-recovery-adapters.ts';

const requiredCases = [
  'faithful_dto_zero_match', 'mapping_incomplete', 'mapping_empty',
  'mapping_duplicate', 'mapping_foreign', 'awaiting_validator',
  'atomic_version_only_drift', 'atomic_supported_epoch',
  'atomic_response_refusals', 'atomic_rpc_errors', 'network_guard',
];

test('same offline harness proves production adapter payloads and guarded orchestration', async () => {
  const report = await verifyPayoutRecoveryAdapters();
  expect(report.scope).toBe('offline_adapter_orchestrator');
  expect(report.cases.map((entry) => entry.name)).toEqual(requiredCases);
  expect(report.status).toBe('PASS');
  expect(report.cases.every((entry) => entry.status === 'PASS')).toBe(true);
  expect(report.networkCalls).toBe(0);
  expect(report.payoutCreateCalls).toBe(0);
});

test('offline harness is deterministic and restores the global network guard', async () => {
  const originalFetch = globalThis.fetch;
  const first = await verifyPayoutRecoveryAdapters();
  expect(first.cases.length).toBe(requiredCases.length);
  expect(globalThis.fetch).toBe(originalFetch);
  expect(await verifyPayoutRecoveryAdapters()).toEqual(first);
  expect(globalThis.fetch).toBe(originalFetch);
});
