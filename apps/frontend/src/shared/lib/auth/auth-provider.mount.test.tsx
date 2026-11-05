import { expect, mock, test } from 'bun:test';
import React from 'react';

// The mounted AuthProvider: `signOut(scope)` on its context and the SIGNED_OUT listener run the
// resets the app root injects (L37). Module mocks stay in a child process so they cannot leak
// into other test files.
if (process.env.SELENE_AUTH_PROVIDER_CHILD !== '1') {
  test('AuthProvider runs the injected sign-out wiring (isolated)', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_AUTH_PROVIDER_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  type AuthListener = (event: string, session: null) => Promise<void> | void;
  let listener: AuthListener | null = null;
  let signOutResult: { error: Error | null } = { error: null };
  const calls: string[] = [];

  mock.module('react-native', () => ({
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  }));
  mock.module('../supabase', () => ({
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: (cb: AuthListener) => {
          listener = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: async ({ scope }: { scope: string }) => {
          calls.push(`signOut:${scope}`);
          return signOutResult;
        },
      },
    },
  }));

  const { act, render } = await import('@testing-library/react-native/pure');
  const { AuthProvider, useAuthContext } = await import('./auth-provider');

  const wiring = {
    userDataResets: [
      () => calls.push('queries'),
      () => {
        calls.push('cart');
        throw new Error('cart reset failed');
      },
      () => calls.push('sell'),
    ],
    unregisterPush: async () => {
      calls.push('unregisterPush');
    },
    signOutFinished: () => {
      calls.push('finished');
    },
  };

  let signOut: ReturnType<typeof useAuthContext>['signOut'];
  const Probe = () => {
    signOut = useAuthContext().signOut;
    return null;
  };

  const mounted = await render(
    <AuthProvider signOutWiring={wiring}>
      <Probe />
    </AuthProvider>,
  );

  test('context signOut runs push, Supabase, every reset in order and the end hook', async () => {
    calls.length = 0;
    let result: Awaited<ReturnType<typeof signOut>> | undefined;
    await act(async () => {
      result = await signOut('global');
    });
    expect(calls).toEqual([
      'unregisterPush',
      'signOut:global',
      'queries',
      'cart',
      'sell',
      'finished',
    ]);
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toBe('cart reset failed');
  });

  test('a throwing reset does not hide the Supabase sign-out error', async () => {
    calls.length = 0;
    const failure = new Error('network');
    signOutResult = { error: failure };
    let result: Awaited<ReturnType<typeof signOut>> | undefined;
    await act(async () => {
      result = await signOut('local');
    });
    expect(result).toEqual({ success: false, error: failure });
    expect(calls).toContain('sell');
    signOutResult = { error: null };
  });

  test('SIGNED_OUT runs the same resets and survives a throwing one', async () => {
    calls.length = 0;
    const originalError = console.error;
    console.error = () => {};
    try {
      await act(async () => {
        await listener!('SIGNED_OUT', null);
      });
    } finally {
      console.error = originalError;
    }
    expect(calls).toEqual(['queries', 'cart', 'sell']);
    mounted.unmount();
  });
}
