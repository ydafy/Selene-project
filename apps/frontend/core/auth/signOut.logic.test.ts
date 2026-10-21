import { describe, expect, it } from 'bun:test';

import { runSignOut, runCleanupSteps } from './signOut.logic';

describe('runSignOut', () => {
  it('signs out with the requested scope, then cleans up', async () => {
    const calls: string[] = [];
    const result = await runSignOut({
      scope: 'local',
      signOut: async (scope) => {
        calls.push(`signOut:${scope}`);
        return { error: null };
      },
      cleanup: () => {
        calls.push('cleanup');
      },
    });
    expect(calls).toEqual(['signOut:local', 'cleanup']);
    expect(result).toEqual({ success: true, error: null });
  });

  it('cleans up and reports the error when signOut returns an error', async () => {
    const failure = new Error('network');
    let cleaned = false;
    const result = await runSignOut({
      scope: 'local',
      signOut: async () => ({ error: failure }),
      cleanup: () => {
        cleaned = true;
      },
    });
    expect(cleaned).toBe(true);
    expect(result).toEqual({ success: false, error: failure });
  });

  it('cleans up and reports the error when signOut throws', async () => {
    let cleaned = false;
    const result = await runSignOut({
      scope: 'global',
      signOut: async () => {
        throw new Error('boom');
      },
      cleanup: () => {
        cleaned = true;
      },
    });
    expect(cleaned).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('boom');
  });

  it('wraps non-Error throws', async () => {
    const result = await runSignOut({
      scope: 'local',
      signOut: async () => {
        throw 'plain';
      },
      cleanup: () => undefined,
    });
    expect(result.error).toBeInstanceOf(Error);
  });

  it('reports a cleanup failure as a failed sign-out', async () => {
    const result = await runSignOut({
      scope: 'local',
      signOut: async () => ({ error: null }),
      cleanup: () => {
        throw new Error('cleanup failed');
      },
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('cleanup failed');
  });
});

describe('runCleanupSteps', () => {
  it('runs every step even when one throws, and rethrows the first error', () => {
    const ran: string[] = [];
    expect(() =>
      runCleanupSteps([
        () => ran.push('a'),
        () => {
          throw new Error('first');
        },
        () => ran.push('c'),
        () => {
          throw new Error('second');
        },
      ]),
    ).toThrow('first');
    expect(ran).toEqual(['a', 'c']);
  });

  it('does not throw when all steps succeed', () => {
    expect(() => runCleanupSteps([() => undefined])).not.toThrow();
  });
});
