import { describe, expect, it } from 'bun:test';

import { runSignOut, runCleanupSteps } from './sign-out.logic';

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

describe('runSignOut push unregister', () => {
  it('unregisters the push token before signing out', async () => {
    const calls: string[] = [];
    await runSignOut({
      scope: 'local',
      unregisterPush: async () => {
        calls.push('unregister');
      },
      signOut: async () => {
        calls.push('signOut');
        return { error: null };
      },
      cleanup: () => {
        calls.push('cleanup');
      },
    });
    expect(calls).toEqual(['unregister', 'signOut', 'cleanup']);
  });

  it('still signs out with the same result when unregister throws', async () => {
    const calls: string[] = [];
    const result = await runSignOut({
      scope: 'local',
      unregisterPush: async () => {
        throw new Error('offline');
      },
      signOut: async () => {
        calls.push('signOut');
        return { error: null };
      },
      cleanup: () => {
        calls.push('cleanup');
      },
    });
    expect(calls).toEqual(['signOut', 'cleanup']);
    expect(result).toEqual({ success: true, error: null });
  });

  it('keeps the signOut error when unregister also fails', async () => {
    const failure = new Error('network');
    const result = await runSignOut({
      scope: 'local',
      unregisterPush: async () => {
        throw new Error('offline');
      },
      signOut: async () => ({ error: failure }),
      cleanup: () => {},
    });
    expect(result).toEqual({ success: false, error: failure });
  });

  it('runs cleanup when signOut fails and no unregister is given', async () => {
    let cleaned = false;
    const result = await runSignOut({
      scope: 'global',
      signOut: async () => ({ error: new Error('x') }),
      cleanup: () => {
        cleaned = true;
      },
    });
    expect(cleaned).toBe(true);
    expect(result.success).toBe(false);
  });
});

describe('runSignOut when unregister never settles', () => {
  it('signs out after the unregister time limit', async () => {
    const calls: string[] = [];
    const result = await runSignOut({
      scope: 'local',
      unregisterPush: () => new Promise<void>(() => {}),
      unregisterTimeoutMs: 10,
      signOut: async () => {
        calls.push('signOut');
        return { error: null };
      },
      cleanup: () => {
        calls.push('cleanup');
      },
    });
    expect(result).toEqual({ success: true, error: null });
    expect(calls).toEqual(['signOut', 'cleanup']);
  });
});

describe('runSignOut finished hook', () => {
  it('calls it after signOut and cleanup with the result unchanged', async () => {
    const calls: string[] = [];
    const result = await runSignOut({
      scope: 'local',
      signOut: async () => {
        calls.push('signOut');
        return { error: null };
      },
      cleanup: () => {
        calls.push('cleanup');
      },
      signOutFinished: () => {
        calls.push('finished');
      },
    });
    expect(calls).toEqual(['signOut', 'cleanup', 'finished']);
    expect(result).toEqual({ success: true, error: null });
  });

  it('calls it when signOut and cleanup fail', async () => {
    let finished = false;
    const failure = new Error('x');
    const result = await runSignOut({
      scope: 'local',
      signOut: async () => ({ error: failure }),
      cleanup: () => {
        throw new Error('cleanup');
      },
      signOutFinished: () => {
        finished = true;
      },
    });
    expect(finished).toBe(true);
    expect(result).toEqual({ success: false, error: failure });
  });

  it('keeps the result when the hook throws', async () => {
    const result = await runSignOut({
      scope: 'local',
      signOut: async () => ({ error: null }),
      cleanup: () => {},
      signOutFinished: () => {
        throw new Error('hook');
      },
    });
    expect(result).toEqual({ success: true, error: null });
  });
});
