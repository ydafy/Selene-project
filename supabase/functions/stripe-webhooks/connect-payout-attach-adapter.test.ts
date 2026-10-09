import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The webhook entrypoint starts a Deno server on import. Inspect the real
// adapter body instead of inventing attach behavior in a fake dependency.
test('zero-row attach re-reads the same run and accepts only same-payout ownership', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const adapter = source.match(/async function attachConnectPayoutRunPayoutId\([\s\S]*?\r?\n}\r?\n\s*async function markConnectPayoutRunStatus/)?.[0];
  expect(adapter).toBeDefined();
  expect(adapter).toMatch(/\.is\('stripe_payout_id', null\)[\s\S]*?\.in\('status', RECOVERABLE_MISSING_PAYOUT_ID_STATUSES\)/);
  const zeroRows = adapter?.match(/if\s*\(\s*\(\(data[\s\S]*?length\s*!==\s*1\s*\)\s*\{([\s\S]*?)\n\s*}/)?.[1] ?? '';
  expect(zeroRows).toMatch(/\.from\('connect_payout_runs'\)[\s\S]*?\.select\([\s\S]*?\.eq\('id', input\.runId\)/);
  expect(zeroRows).toMatch(/stripe_payout_id\s*===\s*input\.stripePayoutId/);
  expect(zeroRows).toMatch(/throw new Error\('PAYOUT_RUN_ATTACH_CONFLICT'\)/);
});
