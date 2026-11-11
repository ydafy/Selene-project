import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  formatSkillUsage,
  installedSkills,
  skillsReadInSession,
  summarizeSkillUsage,
} from './skill-usage';

const SCRIPT = join(import.meta.dir, 'skill-usage.ts');
const DAY_MS = 24 * 60 * 60 * 1000;
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-usage-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function toolCall(args: Record<string, unknown>, role = 'assistant'): string {
  return JSON.stringify({
    type: 'message',
    message: {
      role,
      content: [{ type: 'toolCall', name: 'read', arguments: args }],
    },
  });
}

function writeSession(
  path: string,
  lines: string[],
  ageDays = 0,
  now = Date.now(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n');
  const when = new Date(now - ageDays * DAY_MS);
  utimesSync(path, when, when);
}

function makeSkills(root: string, names: string[]): string {
  const dir = join(root, 'repo', '.agents', 'skills');
  for (const name of names) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), `# ${name}\n`);
  }
  return dir;
}

describe('skillsReadInSession', () => {
  it('finds skill reads in forward-slash and escaped backslash paths, case-insensitively', () => {
    const jsonl = [
      toolCall({ path: 'C:/dev/repo/.agents/skills/bun/SKILL.md' }),
      toolCall({
        path: 'C:\\dev\\repo\\.agents\\skills\\verify-selene\\skill.md',
      }),
      toolCall({ command: 'cat ~/.agents/skills/Supabase/SKILL.md' }),
    ].join('\n');

    expect([...skillsReadInSession(jsonl)].sort()).toEqual([
      'bun',
      'supabase',
      'verify-selene',
    ]);
  });

  it('ignores non-assistant messages and lines that are not JSON', () => {
    const jsonl = [
      toolCall({ path: '.agents/skills/bun/SKILL.md' }, 'user'),
      toolCall({ path: '.agents/skills/bun/SKILL.md' }, 'toolResult'),
      '{not json .agents/skills/zod/SKILL.md',
      '',
    ].join('\n');

    expect([...skillsReadInSession(jsonl)]).toEqual([]);
  });

  it('ignores mentions outside tool calls', () => {
    const jsonl = JSON.stringify({
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'read .agents/skills/bun/SKILL.md' }],
      },
    });

    expect([...skillsReadInSession(jsonl)]).toEqual([]);
  });

  it('rejects names that are not skill folder names', () => {
    const jsonl = [
      toolCall({ command: 'cat skills/x && git show HEAD:skills/SKILL.md' }),
      toolCall({ command: 'ls skills/x && git show/SKILL.md' }),
      toolCall({ path: 'skills/under_score/SKILL.md' }),
    ].join('\n');

    expect([...skillsReadInSession(jsonl)]).toEqual([]);
  });
});

describe('installedSkills', () => {
  it('lists the folders under the skills directory, sorted', () => {
    const root = makeRoot();
    const dir = makeSkills(root, ['zod', 'bun']);
    writeFileSync(join(dir, 'README.md'), 'not a skill');

    expect(installedSkills(dir)).toEqual(['bun', 'zod']);
  });

  it('returns an empty list when the folder is missing', () => {
    expect(installedSkills(join(makeRoot(), 'missing'))).toEqual([]);
  });
});

describe('summarizeSkillUsage', () => {
  it('counts a session once even when it reads the same skill twice', () => {
    const root = makeRoot();
    const logs = join(root, 'logs');
    writeSession(join(logs, 'a', 'one.jsonl'), [
      toolCall({ path: '.agents/skills/bun/SKILL.md' }),
      toolCall({ path: '.agents/skills/bun/SKILL.md' }),
    ]);
    writeSession(join(logs, 'b', 'nested', 'two.jsonl'), [
      toolCall({ path: '.agents/skills/bun/SKILL.md' }),
      toolCall({ path: '.agents/skills/zod/SKILL.md' }),
    ]);
    writeSession(join(logs, 'three.jsonl'), [toolCall({ path: 'README.md' })]);

    const summary = summarizeSkillUsage({ logDirs: [logs], days: 30 });

    expect(summary).toEqual({
      sessions: 3,
      sessionsWithRead: 2,
      counts: [
        { skill: 'bun', sessions: 2 },
        { skill: 'zod', sessions: 1 },
      ],
    });
  });

  it('ignores files modified before the --days window and non-JSONL files', () => {
    const root = makeRoot();
    const logs = join(root, 'logs');
    const now = Date.now();
    writeSession(
      join(logs, 'recent.jsonl'),
      [toolCall({ path: '.agents/skills/bun/SKILL.md' })],
      5,
      now,
    );
    writeSession(
      join(logs, 'old.jsonl'),
      [toolCall({ path: '.agents/skills/zod/SKILL.md' })],
      40,
      now,
    );
    writeSession(
      join(logs, 'notes.txt'),
      [toolCall({ path: '.agents/skills/zod/SKILL.md' })],
      0,
      now,
    );

    expect(summarizeSkillUsage({ logDirs: [logs], days: 30, now })).toEqual({
      sessions: 1,
      sessionsWithRead: 1,
      counts: [{ skill: 'bun', sessions: 1 }],
    });
    expect(
      summarizeSkillUsage({ logDirs: [logs], days: 3, now })?.sessions,
    ).toBe(0);
  });

  it('merges several log folders and returns null when none exists', () => {
    const root = makeRoot();
    writeSession(join(root, 'parent', 's.jsonl'), [
      toolCall({ path: '.agents/skills/bun/SKILL.md' }),
    ]);
    writeSession(join(root, 'sub', 's.jsonl'), [
      toolCall({ path: '.agents/skills/bun/SKILL.md' }),
    ]);

    expect(
      summarizeSkillUsage({
        logDirs: [join(root, 'parent'), join(root, 'sub'), join(root, 'nope')],
        days: 30,
      })?.counts,
    ).toEqual([{ skill: 'bun', sessions: 2 }]);
    expect(
      summarizeSkillUsage({ logDirs: [join(root, 'nope')], days: 30 }),
    ).toBeNull();
  });
});

describe('formatSkillUsage', () => {
  it('prints the totals, a table sorted by sessions, and installed skills with zero reads', () => {
    const report = formatSkillUsage(
      {
        sessions: 10,
        sessionsWithRead: 4,
        counts: [
          { skill: 'bun', sessions: 3 },
          { skill: 'zod', sessions: 1 },
        ],
      },
      { days: 30, installed: ['bun', 'deno', 'vite', 'zod'] },
    );

    expect(report).toBe(
      [
        '# Skill usage, last 30 days',
        '',
        '- Sessions scanned: 10',
        '- Sessions with at least one skill read: 4',
        '',
        '| Skill | Sessions |',
        '| ----- | -------- |',
        '| bun | 3 |',
        '| zod | 1 |',
        '',
        '## Installed with zero reads',
        '',
        '- deno',
        '- vite',
        '',
      ].join('\n'),
    );
  });

  it('says none when every installed skill was read', () => {
    const report = formatSkillUsage(
      {
        sessions: 1,
        sessionsWithRead: 1,
        counts: [{ skill: 'bun', sessions: 1 }],
      },
      { days: 7, installed: ['bun'] },
    );

    expect(report).toContain('## Installed with zero reads\n\n- None\n');
  });
});

describe('skill-usage CLI', () => {
  function run(args: string[]) {
    const result = Bun.spawnSync(['bun', SCRIPT, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      code: result.exitCode,
      out: result.stdout.toString(),
      err: result.stderr.toString(),
    };
  }

  it('prints the report for the given log folders and exits 0', () => {
    const root = makeRoot();
    const skills = makeSkills(root, ['bun', 'zod']);
    writeSession(join(root, 'logs', 'a.jsonl'), [
      toolCall({ path: '.agents/skills/bun/SKILL.md' }),
    ]);
    writeSession(
      join(root, 'logs', 'old.jsonl'),
      [toolCall({ path: '.agents/skills/zod/SKILL.md' })],
      10,
    );

    const result = run([
      '--days',
      '7',
      '--logs',
      join(root, 'logs'),
      '--skills',
      skills,
    ]);

    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      [
        '# Skill usage, last 7 days',
        '',
        '- Sessions scanned: 1',
        '- Sessions with at least one skill read: 1',
        '',
        '| Skill | Sessions |',
        '| ----- | -------- |',
        '| bun | 1 |',
        '',
        '## Installed with zero reads',
        '',
        '- zod',
        '',
      ].join('\n'),
    );
  });

  it('prints one line naming the folders it looked in and exits 0 when none exists', () => {
    const root = makeRoot();
    const a = join(root, 'a');
    const b = join(root, 'b');

    const result = run(['--logs', a, b]);

    expect(result.code).toBe(0);
    expect(result.out).toBe(`No session logs found in: ${a}, ${b}\n`);
  });

  it('rejects a --days value that is not a positive integer', () => {
    const result = run(['--days', 'abc']);

    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(result.err).toContain('--days must be a positive integer');
  });
});
