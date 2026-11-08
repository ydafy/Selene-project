import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import { findMisplacedScripts } from './script-folders';

const root = join(import.meta.dir, '..', '..');

describe('script folders (probes)', () => {
  it('reports a script outside the four purpose folders', () => {
    expect(
      findMisplacedScripts([
        'scripts/probe.ts',
        'scripts/probe.test.ts',
        'scripts/tools/probe.ts',
        'scripts/dev',
      ]),
    ).toEqual([
      'scripts/probe.ts',
      'scripts/probe.test.ts',
      'scripts/tools/probe.ts',
      'scripts/dev',
    ]);
  });

  it('accepts the purpose folders and leaves other files alone', () => {
    expect(
      findMisplacedScripts([
        'scripts/dev/probe.ts',
        'scripts/ci/probe.test.ts',
        'scripts/ci/fixtures/probe/audit.json',
        'scripts/guards/probe.ts',
        'scripts/verify/probe.ps1',
        '.github/scripts/probe.sh',
        'apps/frontend/scripts/probe.ts',
      ]),
    ).toEqual([]);
  });
});

describe('script folders (repository)', () => {
  it('keeps every script in a purpose folder', () => {
    expect(findMisplacedScripts(listRepoFiles(root))).toEqual([]);
  });
});
