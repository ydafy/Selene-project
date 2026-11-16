// source-text: the `supabase status --env` calls in scripts/verify/ and the weekly workflow are the text this guard checks
// Supabase CLI 3.x prints `supabase status --env` as JSON only when it detects an
// AI agent, and as KEY=value lines in CI and in a person's terminal. A harness
// that parses JSON must ask for it, or it passes in agent sessions and fails
// everywhere else (odd/tasks/verify-harnesses-ci.md, L8).
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';

const root = join(import.meta.dir, '..', '..');

const SPAWN_CALL = /\[\s*'supabase',\s*'status',\s*'--env'([^\]]*)\]/g;
const SHELL_CALL = /supabase status --env\b[^\n|)]*/g;
const JSON_ARGS = /'--output-format',\s*'json'/;

function callsWithoutJson(text: string): string[] {
  const missing: string[] = [];
  for (const match of text.matchAll(SPAWN_CALL))
    if (!JSON_ARGS.test(match[1])) missing.push(match[0].replace(/\s+/g, ' '));
  for (const match of text.matchAll(SHELL_CALL))
    if (!match[0].includes('--output-format json')) missing.push(match[0]);
  return missing;
}

describe('supabase status asks for JSON (probes)', () => {
  it('flags a spawn call without --output-format json', () => {
    expect(
      callsWithoutJson("Bun.spawnSync(['supabase', 'status', '--env'], {})"),
    ).toEqual(["['supabase', 'status', '--env']"]);
  });

  it('flags a shell call without --output-format json', () => {
    expect(
      callsWithoutJson('api_url="$(supabase status --env | jq -r .API_URL)"'),
    ).toEqual(['supabase status --env ']);
  });

  it('accepts both forms with the flag, across lines', () => {
    expect(
      callsWithoutJson(
        "Bun.spawnSync([\n  'supabase',\n  'status',\n  '--env',\n  '--output-format',\n  'json',\n])\n" +
          'x="$(supabase status --env --output-format json | jq .)"',
      ),
    ).toEqual([]);
  });
});

describe('supabase status asks for JSON (repository)', () => {
  it('every scripts/verify harness and the weekly workflow pass --output-format json', () => {
    const files = listRepoFiles(root).filter(
      (file) =>
        (file.startsWith('scripts/verify/') &&
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts')) ||
        file === '.github/workflows/verify-harnesses-weekly.yml',
    );
    const offenders = files.flatMap((file) =>
      callsWithoutJson(readFileSync(join(root, file), 'utf8')).map(
        (call) => `${file}: ${call}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
