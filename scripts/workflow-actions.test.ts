import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseActionUses } from './workflow-actions';

// Every action runs pinned to a commit, with its release tag in a comment, so a
// moved tag cannot change what CI runs (docs/dependencies.md, "Keep GitHub
// Actions pinned").
const workflowsDir = join(import.meta.dir, '..', '.github', 'workflows');
const workflows = readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({
    file,
    text: readFileSync(join(workflowsDir, file), 'utf8'),
  }));
const uses = workflows.flatMap(({ file, text }) =>
  parseActionUses(text).map((item) => ({ file, ...item })),
);

describe('parseActionUses', () => {
  it('reads the action, the ref and the tag comment of each uses line', () => {
    const text = [
      'steps:',
      '  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0',
      '  # - uses: commented/out@v1',
      '  - name: setup',
      '    uses: oven-sh/setup-bun@v2',
      '  - uses: "owner/repo/sub@abc"',
    ].join('\n');
    expect(parseActionUses(text)).toEqual([
      {
        line: 2,
        action: 'actions/checkout',
        ref: '11d5960a326750d5838078e36cf38b85af677262',
        tag: 'v4.4.0',
      },
      { line: 5, action: 'oven-sh/setup-bun', ref: 'v2', tag: undefined },
      { line: 6, action: 'owner/repo', ref: 'abc', tag: undefined },
    ]);
  });

  it('returns an empty ref for an action without @, and skips local and docker ones', () => {
    const text = [
      '  - uses: owner/repo',
      '  - uses: owner/repo/path # v1.0.0',
      '  - uses: ./.github/actions/local',
      '  - uses: docker://alpine:3.20',
    ].join('\n');
    expect(parseActionUses(text)).toEqual([
      { line: 1, action: 'owner/repo', ref: '', tag: undefined },
      { line: 2, action: 'owner/repo', ref: '', tag: 'v1.0.0' },
    ]);
  });
});

describe('workflow actions', () => {
  it('finds the actions in .github/workflows', () => {
    expect(uses.length).toBeGreaterThan(0);
  });

  it('pins every action to a full commit SHA with its exact release tag', () => {
    for (const item of uses) {
      expect({
        where: `${item.file}:${item.line}`,
        ref: /^[0-9a-f]{40}$/.test(item.ref),
        tag: /^v\d+\.\d+\.\d+$/.test(item.tag ?? ''),
      }).toEqual({ where: `${item.file}:${item.line}`, ref: true, tag: true });
    }
  });

  it('uses one commit and tag per action across all workflows', () => {
    const pins = new Map<string, Set<string>>();
    for (const item of uses) {
      const set = pins.get(item.action) ?? new Set<string>();
      set.add(`${item.ref} # ${item.tag}`);
      pins.set(item.action, set);
    }
    for (const [action, set] of pins) {
      expect({ action, pins: set.size }).toEqual({ action, pins: 1 });
    }
  });
});
