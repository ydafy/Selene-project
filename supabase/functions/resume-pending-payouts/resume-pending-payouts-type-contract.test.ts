import { expect, test } from 'bun:test';

const index = await Bun.file(new URL('./index.ts', import.meta.url)).text();
const worker = await Bun.file(new URL('./resume-pending-payouts.ts', import.meta.url)).text();
const adapter = await Bun.file(new URL('./reconciliation-adapter.ts', import.meta.url)).text();

test('resume entrypoint uses the validated claim boundary and correct release row type', () => {
  expect(index).toContain('import type { ReleaseQueueRow }');
  expect(index).toContain("from '../release-connect-payout/release-connect-payout.ts'");
  expect(index).toContain("from './reconciliation-adapter.ts'");
  expect(index).toContain('...createReconciliationAdapters(rpcOrThrow, supabaseAdmin)');
  expect(adapter).toContain('assertClaimedRun(');
  expect(adapter).toContain('assertReconciliationClaim(list[0] ?? null)');
  expect(adapter).toContain(".from('connect_payout_run_shipments')");
  expect(adapter).toContain("{ count: 'exact' }");
  expect(adapter).toContain(".eq('run_id', runId)");
  expect(index).not.toContain('as Record<string, unknown> | undefined');
  expect(worker).toContain("from '../release-connect-payout/release-connect-payout.ts'");
});
