import { describe, expect, it } from 'bun:test';
import {
  reauthenticate,
  resolveReauthMethod,
  type ReauthDeps,
} from './reauth.logic';

const SNAPSHOT = {
  userId: 'user-1',
  email: 'a@selene.local',
  accessToken: 'at',
  refreshToken: 'rt',
};

const makeDeps = (over: Partial<ReauthDeps> = {}) => {
  const calls: string[] = [];
  const deps: ReauthDeps = {
    googleCancelledCode: 'CANCELLED',
    getSnapshot: async () => SNAPSHOT,
    signInWithPassword: async (email, password) => {
      calls.push(`password:${email}:${password}`);
      return { userId: 'user-1', error: null };
    },
    signInWithGoogle: async () => {
      calls.push('google');
      return { userId: 'user-1', error: null };
    },
    restoreSession: async () => {
      calls.push('restore');
      return true;
    },
    signOutLocal: async () => {
      calls.push('signOut');
    },
    ...over,
  };
  return { deps, calls };
};

describe('resolveReauthMethod', () => {
  it('uses the password for an email identity', () => {
    expect(resolveReauthMethod({ identities: [{ provider: 'email' }] })).toBe(
      'password',
    );
  });

  it('uses Google when the only identity is Google', () => {
    expect(resolveReauthMethod({ identities: [{ provider: 'google' }] })).toBe(
      'google',
    );
  });

  it('prefers the password when both identities exist', () => {
    expect(
      resolveReauthMethod({
        identities: [{ provider: 'google' }, { provider: 'email' }],
      }),
    ).toBe('password');
  });

  it('falls back to app_metadata.providers when identities are missing', () => {
    expect(
      resolveReauthMethod({ app_metadata: { providers: ['google'] } }),
    ).toBe('google');
  });

  it('falls back to app_metadata.provider', () => {
    expect(resolveReauthMethod({ app_metadata: { provider: 'google' } })).toBe(
      'google',
    );
  });

  it('defaults to the password when nothing is known', () => {
    expect(resolveReauthMethod(null)).toBe('password');
    expect(resolveReauthMethod({})).toBe('password');
  });
});

describe('reauthenticate', () => {
  it('signs in with the current user email and the typed password', async () => {
    const { deps, calls } = makeDeps();
    expect(
      await reauthenticate({ kind: 'password', password: 'pw' }, deps),
    ).toEqual({ ok: true });
    expect(calls).toEqual(['password:a@selene.local:pw']);
  });

  it('maps a wrong password to a field error', async () => {
    const { deps } = makeDeps({
      signInWithPassword: async () => ({
        userId: null,
        error: { code: 'invalid_credentials' },
      }),
    });
    expect(
      await reauthenticate({ kind: 'password', password: 'x' }, deps),
    ).toEqual({
      ok: false,
      errorKey: 'settings:errors.wrongPassword',
      field: 'password',
    });
  });

  it('keeps other auth error mappings (rate limit)', async () => {
    const { deps } = makeDeps({
      signInWithPassword: async () => ({
        userId: null,
        error: { code: 'over_request_rate_limit' },
      }),
    });
    expect(
      await reauthenticate({ kind: 'password', password: 'x' }, deps),
    ).toEqual({
      ok: false,
      errorKey: 'auth:errors.rateLimited',
      field: 'password',
    });
  });

  it('fails without a session and never signs in', async () => {
    const { deps, calls } = makeDeps({ getSnapshot: async () => null });
    expect(
      await reauthenticate({ kind: 'password', password: 'pw' }, deps),
    ).toEqual({ ok: false, errorKey: 'settings:errors.authRequired' });
    expect(calls).toEqual([]);
  });

  it('fails when the session has no email (password flow)', async () => {
    const { deps, calls } = makeDeps({
      getSnapshot: async () => ({ ...SNAPSHOT, email: null }),
    });
    expect(
      await reauthenticate({ kind: 'password', password: 'pw' }, deps),
    ).toEqual({ ok: false, errorKey: 'common:errors.generic' });
    expect(calls).toEqual([]);
  });

  it('re-runs Google sign-in for the google credential', async () => {
    const { deps, calls } = makeDeps();
    expect(await reauthenticate({ kind: 'google' }, deps)).toEqual({
      ok: true,
    });
    expect(calls).toEqual(['google']);
  });

  it('a Google cancel is silent', async () => {
    const { deps } = makeDeps({
      signInWithGoogle: async () => ({
        userId: null,
        error: { code: 'CANCELLED' },
      }),
    });
    expect(await reauthenticate({ kind: 'google' }, deps)).toEqual({
      ok: false,
      errorKey: null,
    });
  });

  it('a Google failure maps to the localized Google message', async () => {
    const { deps } = makeDeps({
      signInWithGoogle: async () => ({
        userId: null,
        error: new Error('boom'),
      }),
    });
    expect(await reauthenticate({ kind: 'google' }, deps)).toEqual({
      ok: false,
      errorKey: 'auth:errors.googleSignInFailed',
    });
  });

  it('a different account restores the previous session and aborts', async () => {
    const { deps, calls } = makeDeps({
      signInWithGoogle: async () => ({ userId: 'other', error: null }),
    });
    expect(await reauthenticate({ kind: 'google' }, deps)).toEqual({
      ok: false,
      errorKey: 'settings:errors.accountMismatch',
    });
    expect(calls).toEqual(['restore']);
  });

  it('signs out locally when the previous session cannot be restored', async () => {
    const { deps, calls } = makeDeps({
      signInWithGoogle: async () => ({ userId: 'other', error: null }),
      restoreSession: async () => false,
    });
    expect(await reauthenticate({ kind: 'google' }, deps)).toEqual({
      ok: false,
      errorKey: 'settings:errors.accountMismatch',
    });
    expect(calls).toEqual(['signOut']);
  });

  it('treats a sign-in without a user id as a mismatch', async () => {
    const { deps, calls } = makeDeps({
      signInWithPassword: async () => ({ userId: null, error: null }),
    });
    expect(
      await reauthenticate({ kind: 'password', password: 'pw' }, deps),
    ).toEqual({ ok: false, errorKey: 'settings:errors.accountMismatch' });
    expect(calls).toEqual(['restore']);
  });
});
