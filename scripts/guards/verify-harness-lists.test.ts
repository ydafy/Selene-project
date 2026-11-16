import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { checkHarnessLists } from '../verify/run-harnesses';
import { listRepoFiles } from './agent-instructions';

const root = join(import.meta.dir, '..', '..');

const lists = {
  groups: { pr: ['a.ts', 'a.probes.ts'], weekly: ['b.ts'] },
  manual: { 'c.sql': 'compares against the remote project' },
  tooling: ['run-harnesses.ts'],
};

describe('verify harness lists (probes)', () => {
  it('accepts files that are each listed once, helpers by pattern', () => {
    expect(
      checkHarnessLists(
        [
          'a.ts',
          'a.probes.ts',
          'a.test.ts',
          'b.ts',
          'c.sql',
          'run-harnesses.ts',
        ],
        lists,
      ),
    ).toEqual([]);
  });

  it('names a file that is in no list', () => {
    expect(
      checkHarnessLists(
        ['a.ts', 'a.probes.ts', 'b.ts', 'c.sql', 'run-harnesses.ts', 'd.ts'],
        lists,
      ),
    ).toEqual([
      'scripts/verify/d.ts is in no list (add it to a group, the manual list, or make it a *.test.ts helper)',
    ]);
  });

  it('names a listed file that no longer exists', () => {
    expect(
      checkHarnessLists(
        ['a.ts', 'a.probes.ts', 'c.sql', 'run-harnesses.ts'],
        lists,
      ),
    ).toEqual(['scripts/verify/b.ts is listed in weekly but does not exist']);
  });

  it('names a file listed more than once', () => {
    expect(
      checkHarnessLists(
        ['a.ts', 'a.probes.ts', 'b.ts', 'c.sql', 'run-harnesses.ts'],
        {
          ...lists,
          groups: { pr: ['a.ts', 'a.probes.ts', 'b.ts'], weekly: ['b.ts'] },
          manual: { 'c.sql': 'remote', 'a.ts': 'twice' },
        },
      ),
    ).toEqual([
      'scripts/verify/a.ts is listed more than once (pr, manual)',
      'scripts/verify/b.ts is listed more than once (pr, weekly)',
    ]);
  });

  it('counts a listed *.test.ts as listed twice', () => {
    expect(
      checkHarnessLists(
        [
          'a.ts',
          'a.probes.ts',
          'a.test.ts',
          'b.ts',
          'c.sql',
          'run-harnesses.ts',
        ],
        {
          ...lists,
          groups: {
            pr: ['a.ts', 'a.probes.ts', 'a.test.ts'],
            weekly: ['b.ts'],
          },
        },
      ),
    ).toEqual([
      'scripts/verify/a.test.ts is listed more than once (pr, helper)',
    ]);
  });
});

describe('verify harness lists (repository)', () => {
  it('lists every file in scripts/verify exactly once', () => {
    const files = listRepoFiles(root)
      .filter((file) => file.startsWith('scripts/verify/'))
      .map((file) => file.slice('scripts/verify/'.length));
    expect(checkHarnessLists(files)).toEqual([]);
  });
});
