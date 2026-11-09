// source-text: index.ts starts a Deno server on import, so its use of the shared reconciliation adapters and the run-scoped mapping query is only visible in its text
import { expect, test } from 'bun:test';

const index = await Bun.file(new URL('./index.ts', import.meta.url)).text();

test('resume entrypoint wires the shared reconciliation adapters and a run-scoped mapping query', () => {
  expect(index).toContain("from './reconciliation-adapter.ts'");
  expect(index).toContain(
    '...createReconciliationAdapters(rpcOrThrow, reconciliationMappingClient)',
  );
  expect(index).toMatch(
    /supabaseAdmin\s*\.from\(table\)\s*\.select\(columns, options\)\s*\.eq\(column, runId\)/,
  );
});
