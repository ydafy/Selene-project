import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkCommitMessage } from './check-commit-msg';

const FORMAT_ERROR =
  'commit-msg: the header must follow Conventional Commits, for example "fix(orders): keep the shipment status after a refund". Allowed types: feat, fix, docs, chore, refactor, test, perf, build, ci, style, revert.';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function header(length: number): string {
  const prefix = 'fix: ';
  return prefix + 'a'.repeat(length - prefix.length);
}

describe('checkCommitMessage', () => {
  it.each([
    'feat: add the cart',
    'fix(orders): keep the shipment status',
    'feat!: drop the old API',
    'refactor(api/v2.1)!: rename the handler',
  ])('accepts %s', (message) => {
    expect(checkCommitMessage(message)).toEqual({ ok: true });
  });

  it.each([
    'Merge branch "main" into feature',
    'Revert "feat: add the cart"',
    'fixup! feat: add the cart',
    'squash! feat: add the cart',
    'amend! feat: add the cart',
  ])('exempts %s', (message) => {
    expect(checkCommitMessage(message)).toEqual({ ok: true });
  });

  it('skips comment lines and leading blank lines', () => {
    expect(
      checkCommitMessage('\n\n# a comment\nfix: real header\n\nbody'),
    ).toEqual({ ok: true });
    expect(checkCommitMessage('# only\nnot conventional')).toEqual({
      ok: false,
      error: FORMAT_ERROR,
    });
  });

  it.each([
    'wip: stuff',
    'fix:missing space',
    'fix: ',
    'fix(Orders): uppercase scope',
    'fix(): empty scope',
    'just a sentence',
  ])('rejects %p with the format error', (message) => {
    expect(checkCommitMessage(message)).toEqual({
      ok: false,
      error: FORMAT_ERROR,
    });
  });

  it('rejects an empty message with the format error', () => {
    expect(checkCommitMessage('')).toEqual({ ok: false, error: FORMAT_ERROR });
  });

  it('accepts a 100 character header and rejects 101', () => {
    expect(checkCommitMessage(header(100))).toEqual({ ok: true });
    expect(checkCommitMessage(header(101))).toEqual({
      ok: false,
      error:
        'commit-msg: the header is 101 characters; keep it at 100 or fewer.',
    });
  });
});

describe('check-commit-msg CLI', () => {
  async function run(message: string) {
    const root = mkdtempSync(join(tmpdir(), 'check-commit-msg-'));
    roots.push(root);
    const file = join(root, 'COMMIT_EDITMSG');
    writeFileSync(file, message);
    const proc = Bun.spawn(
      ['bun', join(import.meta.dir, 'check-commit-msg.ts'), file],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  }

  it('exits 0 and prints nothing for a valid header', async () => {
    expect(await run('fix(orders): keep the status\n')).toEqual({
      stdout: '',
      stderr: '',
      code: 0,
    });
  });

  it('exits 1 and prints the error to stderr for an invalid header', async () => {
    expect(await run('did some stuff\n')).toEqual({
      stdout: '',
      stderr: `${FORMAT_ERROR}\n`,
      code: 1,
    });
  });
});
