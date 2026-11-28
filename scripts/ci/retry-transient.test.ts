import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { retryTransient, type RunResult } from './retry-transient';

const SCRIPT = join(import.meta.dir, 'retry-transient.ts');
const COMMAND = ['supabase', 'functions', 'deploy', '--use-api', '--yes'];
const SERVER_ERROR =
  'unexpected deploy status 500: {"message":"Function deploy failed due to an internal error"}';

// Runs retryTransient with a fake command that answers each attempt with the
// next result, and records the attempts, waits, and log lines.
async function run(results: RunResult[]) {
  const commands: string[][] = [];
  const waits: number[] = [];
  const lines: string[] = [];
  const exitCode = await retryTransient(COMMAND, {
    spawn: async (command) => {
      commands.push(command);
      const result = results[commands.length - 1];
      if (!result) throw new Error('more attempts than results');
      return result;
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
    log: (line) => lines.push(line),
  });
  return { exitCode, attempts: commands.length, commands, waits, lines };
}

const failure = (exitCode: number, output: string): RunResult => ({
  exitCode,
  output,
});
const success: RunResult = { exitCode: 0, output: 'Deployed Functions\n' };

describe('retryTransient', () => {
  it('exits 0 after one attempt when the command succeeds', async () => {
    expect(await run([success])).toEqual({
      exitCode: 0,
      attempts: 1,
      commands: [COMMAND],
      waits: [],
      lines: [],
    });
  });

  it('retries after a Supabase 5xx and exits 0 when the next attempt succeeds', async () => {
    expect(
      await run([
        failure(1, `Bundling track-shipments\n${SERVER_ERROR}\n`),
        success,
      ]),
    ).toEqual({
      exitCode: 0,
      attempts: 2,
      commands: [COMMAND, COMMAND],
      waits: [30_000],
      lines: [
        `retry-transient: attempt 1 of 3 failed with a server error (${SERVER_ERROR}); retrying in 30 s.`,
      ],
    });
  });

  it('stops after three 5xx failures and exits with the last code', async () => {
    expect(
      await run([
        failure(1, `${SERVER_ERROR}\n`),
        failure(1, 'unexpected deploy status 502: Bad Gateway\n'),
        failure(4, 'unexpected deploy status 503: Service Unavailable\n'),
      ]),
    ).toEqual({
      exitCode: 4,
      attempts: 3,
      commands: [COMMAND, COMMAND, COMMAND],
      waits: [30_000, 60_000],
      lines: [
        `retry-transient: attempt 1 of 3 failed with a server error (${SERVER_ERROR}); retrying in 30 s.`,
        'retry-transient: attempt 2 of 3 failed with a server error (unexpected deploy status 502: Bad Gateway); retrying in 60 s.',
        'retry-transient: attempt 3 of 3 failed with a server error (unexpected deploy status 503: Service Unavailable); giving up.',
      ],
    });
  });

  it('exits at once with the code of a failure that is not a server error', async () => {
    expect(
      await run([
        failure(
          3,
          'Error: Module not found "file:///supabase/functions/x/index.ts"\n',
        ),
      ]),
    ).toEqual({
      exitCode: 3,
      attempts: 1,
      commands: [COMMAND],
      waits: [],
      lines: [],
    });
  });

  it('does not retry a 4xx answer', async () => {
    expect(
      await run([failure(1, 'unexpected deploy status 401: Unauthorized\n')]),
    ).toEqual({
      exitCode: 1,
      attempts: 1,
      commands: [COMMAND],
      waits: [],
      lines: [],
    });
  });
});

describe('retry-transient CLI', () => {
  it('prints usage and exits 2 without a command', () => {
    const result = Bun.spawnSync(['bun', SCRIPT, '--'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect({
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'Usage: bun scripts/ci/retry-transient.ts -- <command> [args...]\n',
    });
  });

  it('streams the output of a failing command and exits with its code', () => {
    const result = Bun.spawnSync(
      [
        'bun',
        SCRIPT,
        '--',
        'bun',
        '-e',
        'console.log("out"); console.error("err"); process.exit(3)',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect({
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }).toEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
  });
});
