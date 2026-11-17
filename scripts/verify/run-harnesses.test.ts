import { describe, expect, it } from 'bun:test';

import { HARNESS_GROUPS, runHarnessCli } from './run-harnesses';

type Exit = number | Error;

function fakeIo(exits: Record<string, Exit> = {}) {
  const spawned: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  return {
    spawned,
    out,
    err,
    io: {
      spawn: async (file: string) => {
        spawned.push(file);
        clock += 1500;
        const exit = exits[file] ?? 0;
        if (exit instanceof Error) throw exit;
        return exit;
      },
      now: () => clock,
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
    },
  };
}

describe('run-harnesses CLI', () => {
  it('runs every harness of the group in order, one at a time', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    const code = await runHarnessCli(['--group', 'pr'], {
      spawn: async (file) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        order.push(file);
        await Bun.sleep(1);
        running -= 1;
        return 0;
      },
      now: () => 0,
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(0);
    expect(order).toEqual([...HARNESS_GROUPS.pr]);
    expect(maxRunning).toBe(1);
  });

  it('accepts --group=<name>', async () => {
    const fake = fakeIo();
    expect(await runHarnessCli(['--group=weekly'], fake.io)).toBe(0);
    expect(fake.spawned).toEqual([...HARNESS_GROUPS.weekly]);
  });

  it('prints a line per harness and a summary when all pass, exit 0', async () => {
    const fake = fakeIo();
    const code = await runHarnessCli(['--group', 'weekly'], fake.io);
    expect(code).toBe(0);
    for (const file of HARNESS_GROUPS.weekly) {
      expect(fake.out).toContain(`PASS ${file} 1.5s`);
    }
    expect(fake.out.at(-1)).toBe(
      `weekly: ${HARNESS_GROUPS.weekly.length} passed, 0 failed in ${(
        HARNESS_GROUPS.weekly.length * 1.5
      ).toFixed(1)}s`,
    );
    expect(fake.err).toEqual([]);
  });

  it('keeps running after a failure, lists the failures and exits 1', async () => {
    const [first, second, third] = HARNESS_GROUPS.pr;
    const fake = fakeIo({
      [first]: 1,
      [third]: new Error('spawn exploded'),
    });
    const code = await runHarnessCli(['--group', 'pr'], fake.io);
    expect(code).toBe(1);
    expect(fake.spawned).toEqual([...HARNESS_GROUPS.pr]);
    expect(fake.out).toContain(`FAIL ${first} 1.5s (exit 1)`);
    expect(fake.out).toContain(`PASS ${second} 1.5s`);
    expect(fake.out).toContain(`FAIL ${third} 1.5s (spawn exploded)`);
    const total = HARNESS_GROUPS.pr.length;
    const summaryIndex = fake.out.findIndex((line) => line.startsWith('pr: '));
    expect(fake.out.slice(summaryIndex)).toEqual([
      `pr: ${total - 2} passed, 2 failed in ${(total * 1.5).toFixed(1)}s`,
      `failed: ${first}, ${third}`,
    ]);
  });

  it('exits 2 with usage on stderr when --group is missing', async () => {
    const fake = fakeIo();
    expect(await runHarnessCli([], fake.io)).toBe(2);
    expect(fake.spawned).toEqual([]);
    expect(fake.err.join('\n')).toContain(
      'Usage: bun scripts/verify/run-harnesses.ts --group pr|weekly',
    );
  });

  it('exits 2 with usage on stderr for an unknown group', async () => {
    const fake = fakeIo();
    expect(await runHarnessCli(['--group', 'nightly'], fake.io)).toBe(2);
    expect(fake.spawned).toEqual([]);
    expect(fake.err[0]).toBe('Unknown group: nightly');
    expect(fake.err.join('\n')).toContain('Usage:');
  });

  it('exits 2 for an unknown argument', async () => {
    const fake = fakeIo();
    expect(await runHarnessCli(['--group', 'pr', '--fast'], fake.io)).toBe(2);
    expect(fake.spawned).toEqual([]);
    expect(fake.err[0]).toBe('Unknown argument: --fast');
  });

  it('prints usage on stdout and exits 0 for --help', async () => {
    const fake = fakeIo();
    expect(await runHarnessCli(['--help'], fake.io)).toBe(0);
    expect(fake.spawned).toEqual([]);
    expect(fake.out.join('\n')).toContain(
      'Usage: bun scripts/verify/run-harnesses.ts --group pr|weekly',
    );
    expect(fake.err).toEqual([]);
  });
});
