import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The Deno webhook entrypoint registers a server and imports runtime-only
// dependencies, so this guard checks its actual terminal adapter rather than
// replacing markRunStatus with a successful test double.
test('event evidence adapter accepts only explicit inserted or duplicate RPC booleans', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const adapter = source.match(
    /async function appendConnectPayoutEventEvidence\([\s\S]*?\r?\n}\r?\n\s*async function recordConnectAccountEvent/,
  )?.[0];

  expect(adapter).toBeDefined();
  expect(adapter).toContain("'fn_append_connect_payout_event' as never");
  expect(adapter).toMatch(/if \(data !== true && data !== false\)\s*\{\s*throw new Error\('PAYOUT_EVENT_APPEND_INVALID_RESULT'\);\s*}/);
  expect(adapter).toMatch(/if \(data !== true && data !== false\)[\s\S]*?}\s*return data\s*;/);
});

test('terminal adapter returns the accepted RPC boolean to reconciliation', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const adapter = source.match(
    /async function markConnectPayoutRunStatus\([\s\S]*?\r?\n}\r?\n\s*async function projectConnectPayoutRunStage/,
  )?.[0];

  expect(adapter).toBeDefined();
  expect(adapter).toContain("'fn_project_payout_run_terminal' as never");
  expect(adapter).toMatch(/if \(projected !== true\)\s*\{\s*throw new Error\('PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT'\);\s*}/);
  expect(adapter).toMatch(/if \(projected !== true\)[\s\S]*?}\s*return projected\s*;/);
});
