import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Edge Function wiring only (roadmap #272 item 6); the SQL behavior of
// fn_atomic_payout_resume_mapping is proven by
// supabase/tests/database/payout_resume_actionability_mapping.test.sql.
// Source contracts only; these checks do not execute PostgreSQL.
// Prettier may re-wrap the source files read below; compare without layout.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/ \./g, '.');
test('manual adapters use only the specialized RPC with explicit response refusal', () => {
  const entrypoint = compact(
    readFileSync(
      join(import.meta.dir, '../../functions/release-connect-payout/index.ts'),
      'utf8',
    ),
  );
  expect(entrypoint).toContain(compact("from './atomic-resume-adapter.ts'"));
  expect(entrypoint).toContain(
    compact(
      '...createAtomicResumeAdapters((name, args) => supabaseAdmin.rpc(name, args))',
    ),
  );
  const factory = readFileSync(
    join(
      import.meta.dir,
      '../../functions/release-connect-payout/atomic-resume-adapter.ts',
    ),
    'utf8',
  );
  for (const name of ['markRunRetrying', 'markRunPendingReconciliation']) {
    const block = factory.slice(factory.indexOf(`${name}: async`));
    const adapter = block.slice(0, block.indexOf('\n    },') + 7);
    expect(adapter).toContain("'fn_atomic_payout_resume_mapping'");
    expect(adapter).toContain('atomicResumeMappingArgs(input,');
    expect(adapter).toContain("typeof data === 'number'");
    expect(adapter).not.toContain('.update(');
    expect(adapter).not.toContain('.select(');
  }
  const orchestrator = compact(
    readFileSync(
      join(
        import.meta.dir,
        '../../functions/release-connect-payout/release-connect-payout.ts',
      ),
      'utf8',
    ),
  );
  expect(orchestrator.indexOf('const resumedIntent =')).toBeLessThan(
    orchestrator.indexOf(compact('await deps.retrieveStripePayout(')),
  );
  expect(orchestrator).toContain(
    compact(
      'assertResumeApplied(await deps.markRunPendingReconciliation(resumeIntent))',
    ),
  );
  expect(orchestrator).toContain(
    compact(
      'const version = assertResumeApplied(await deps.markRunRetrying(resumeIntent))',
    ),
  );
  expect(orchestrator).not.toContain('Database &');
});
