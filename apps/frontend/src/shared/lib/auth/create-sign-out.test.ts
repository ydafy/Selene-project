import { describe, expect, it } from 'bun:test';

import { createSignOut } from './create-sign-out';

const build = (
  overrides: {
    signOutResult?: () => Promise<{ error: Error | null }>;
    resets?: (() => unknown)[];
  } = {},
) => {
  const calls: string[] = [];
  const signOut = createSignOut({
    supabaseSignOut: async (scope) => {
      calls.push(`signOut:${scope}`);
      return overrides.signOutResult
        ? overrides.signOutResult()
        : { error: null };
    },
    wiring: {
      userDataResets: overrides.resets ?? [
        () => calls.push('queries'),
        () => calls.push('cart'),
        () => calls.push('sell'),
      ],
      unregisterPush: async () => {
        calls.push('unregisterPush');
      },
      signOutFinished: () => {
        calls.push('finished');
      },
    },
  });
  return { calls, signOut };
};

describe('createSignOut', () => {
  it('unregisters push, signs out, runs the resets in list order, then reports the end', async () => {
    const { calls, signOut } = build();
    const result = await signOut('global');
    expect(calls).toEqual([
      'unregisterPush',
      'signOut:global',
      'queries',
      'cart',
      'sell',
      'finished',
    ]);
    expect(result).toEqual({ success: true, error: null });
  });

  it('signs out this device only by default', async () => {
    const { calls, signOut } = build();
    await signOut();
    expect(calls).toContain('signOut:local');
  });

  it('runs every reset after a sign-out failure and reports that failure', async () => {
    const failure = new Error('network');
    const { calls, signOut } = build({
      signOutResult: async () => ({ error: failure }),
    });
    const result = await signOut('local');
    expect(calls).toEqual([
      'unregisterPush',
      'signOut:local',
      'queries',
      'cart',
      'sell',
      'finished',
    ]);
    expect(result).toEqual({ success: false, error: failure });
  });

  it('keeps running the resets after one throws and reports it', async () => {
    const ran: string[] = [];
    const broken = new Error('reset failed');
    const { signOut } = build({
      resets: [
        () => ran.push('first'),
        () => {
          throw broken;
        },
        () => ran.push('last'),
      ],
    });
    const result = await signOut('local');
    expect(ran).toEqual(['first', 'last']);
    expect(result).toEqual({ success: false, error: broken });
  });

  it('does not let a throwing reset hide the sign-out error', async () => {
    const signOutError = new Error('sign-out failed');
    const { signOut } = build({
      signOutResult: async () => ({ error: signOutError }),
      resets: [
        () => {
          throw new Error('reset failed');
        },
      ],
    });
    expect(await signOut('local')).toEqual({
      success: false,
      error: signOutError,
    });
  });

  it('works without push hooks', async () => {
    const ran: string[] = [];
    const signOut = createSignOut({
      supabaseSignOut: async () => ({ error: null }),
      wiring: { userDataResets: [() => ran.push('reset')] },
    });
    expect(await signOut('local')).toEqual({ success: true, error: null });
    expect(ran).toEqual(['reset']);
  });
});
