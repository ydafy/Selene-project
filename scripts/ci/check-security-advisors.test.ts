import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareFindings,
  type AdvisorFinding,
} from './check-security-advisors';
import { ACCEPTED_SECURITY_FINDINGS } from './security-advisor-exceptions';

const SCRIPT = join(import.meta.dir, 'check-security-advisors.ts');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function finding(
  cacheKey: string,
  level: AdvisorFinding['level'] = 'WARN',
): AdvisorFinding {
  return {
    name: cacheKey.split(':')[0],
    level,
    cacheKey,
    detail: `detail of ${cacheKey}`,
  };
}

function check(output: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'security-advisors-'));
  roots.push(root);
  const input = join(root, 'advisors.json');
  writeFileSync(
    input,
    typeof output === 'string' ? output : JSON.stringify(output),
  );
  const run = Bun.spawnSync(['bun', SCRIPT, '--input', input], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

const accepted = {
  'lint_a:public.t': 'reason a',
  'lint_b:public.f': 'reason b',
};

describe('compareFindings', () => {
  it('passes when every finding is accepted and every entry is used', () => {
    expect(
      compareFindings(
        [finding('lint_a:public.t', 'ERROR'), finding('lint_b:public.f')],
        accepted,
      ),
    ).toEqual({ unexpected: [], stale: [] });
  });

  it('reports a warn or error finding nobody accepted', () => {
    const extra = finding('lint_c:public.x', 'ERROR');
    const warn = finding('lint_d:public.y', 'WARN');
    expect(
      compareFindings(
        [finding('lint_a:public.t'), finding('lint_b:public.f'), extra, warn],
        accepted,
      ),
    ).toEqual({ unexpected: [extra, warn], stale: [] });
  });

  it('ignores info findings', () => {
    expect(
      compareFindings(
        [
          finding('lint_a:public.t'),
          finding('lint_b:public.f'),
          finding('lint_e:public.z', 'INFO'),
        ],
        accepted,
      ),
    ).toEqual({ unexpected: [], stale: [] });
  });

  it('reports an accepted entry that no finding matches as stale', () => {
    expect(compareFindings([finding('lint_a:public.t')], accepted)).toEqual({
      unexpected: [],
      stale: ['lint_b:public.f'],
    });
  });
});

describe('accepted security findings', () => {
  it('gives every entry a reason', () => {
    for (const [key, reason] of Object.entries(ACCEPTED_SECURITY_FINDINGS))
      expect({ key, reason: reason.trim().length > 0 }).toEqual({
        key,
        reason: true,
      });
  });
});

describe('check-security-advisors CLI', () => {
  const acceptedFindings = Object.keys(ACCEPTED_SECURITY_FINDINGS).map((key) =>
    finding(key),
  );

  it('passes when the findings are exactly the accepted ones', () => {
    expect(check({ results: acceptedFindings })).toEqual({
      exitCode: 0,
      stdout: `check-security-advisors: ${acceptedFindings.length} accepted findings, nothing new.\n`,
      stderr: '',
    });
  });

  it('fails on a new finding and names its key and detail', () => {
    const result = check({
      results: [
        ...acceptedFindings,
        finding('rls_disabled_in_public:public.new_table', 'ERROR'),
      ],
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'ERROR rls_disabled_in_public:public.new_table: detail of rls_disabled_in_public:public.new_table',
    );
  });

  it('fails on a stale accepted entry', () => {
    const [first, ...rest] = acceptedFindings;
    if (!first) return;
    const result = check({ results: rest });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `${first.cacheKey}: accepted in scripts/ci/security-advisor-exceptions.ts but no longer reported; remove the entry.`,
    );
  });

  it('fails when the advisor output is not a list of findings', () => {
    const result = check({ message: 'not a list' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'check-security-advisors: the advisor output is not a list of findings.',
    );
  });

  it('fails as stale when the advisor returns no findings', () => {
    expect(check({ results: [] }).exitCode).toBe(1);
  });

  it('rejects the CLI error object', () => {
    const result = check({
      _tag: 'Error',
      error: { code: 'LocalDbRunningError', message: 'x' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'check-security-advisors: the advisor output is not a list of findings.',
    );
  });

  it('rejects output that is not JSON with a clear message', () => {
    const result = check('not json');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'check-security-advisors: the advisor output is not JSON: not json',
    );
  });

  it('does not accept a key inherited from Object.prototype', () => {
    expect(
      compareFindings([finding('toString', 'WARN')], {}).unexpected,
    ).toHaveLength(1);
  });

  it('rejects an unknown flag', () => {
    const run = Bun.spawnSync(['bun', SCRIPT, '--bogus'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain(
      'Usage: bun scripts/ci/check-security-advisors.ts [--input <advisors.json>]',
    );
  });
});
