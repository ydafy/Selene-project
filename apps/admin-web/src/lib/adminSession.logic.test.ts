import { describe, expect, it } from 'bun:test';

import {
  createLoadGuard,
  resolveAdminSession,
  type AdminSessionDeps,
} from './adminSession.logic';

type Profile = { role: string | null; status: string | null };

const makeDeps = (loadProfile: (userId: string) => Promise<Profile | null>) => {
  const calls: string[] = [];
  const deps: AdminSessionDeps<Profile> = {
    loadProfile,
    signOut: async () => {
      calls.push('signOut');
    },
    clearCache: () => {
      calls.push('clearCache');
    },
    onDenied: (reason) => {
      calls.push(`denied:${reason}`);
    },
  };
  return { deps, calls };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const activeAdmin: Profile = { role: 'admin', status: 'active' };

describe('createLoadGuard', () => {
  it('only the latest load is current', () => {
    const guard = createLoadGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('sign-out invalidates any in-flight load', () => {
    const guard = createLoadGuard();
    const token = guard.begin();
    guard.begin();
    expect(guard.isCurrent(token)).toBe(false);
  });
});

describe('resolveAdminSession', () => {
  it('allows an active admin without side effects', async () => {
    const { deps, calls } = makeDeps(async () => activeAdmin);
    const outcome = await resolveAdminSession('a', createLoadGuard(), deps);
    expect(outcome).toEqual({ status: 'allowed', profile: activeAdmin });
    expect(calls).toEqual([]);
  });

  it('denies a non-admin: clears cache, notifies, then signs out', async () => {
    const { deps, calls } = makeDeps(async () => ({
      role: 'user',
      status: 'active',
    }));
    const outcome = await resolveAdminSession('a', createLoadGuard(), deps);
    expect(outcome).toEqual({ status: 'denied', reason: 'not_admin' });
    expect(calls).toEqual(['clearCache', 'denied:not_admin', 'signOut']);
  });

  it('denies an inactive admin', async () => {
    const { deps, calls } = makeDeps(async () => ({
      role: 'admin',
      status: 'suspended',
    }));
    const outcome = await resolveAdminSession('a', createLoadGuard(), deps);
    expect(outcome).toEqual({ status: 'denied', reason: 'inactive' });
    expect(calls).toContain('signOut');
  });

  it('denies and signs out when the profile cannot be loaded', async () => {
    const { deps, calls } = makeDeps(async () => null);
    const outcome = await resolveAdminSession('a', createLoadGuard(), deps);
    expect(outcome).toEqual({ status: 'denied', reason: 'missing_profile' });
    expect(calls).toEqual(['clearCache', 'denied:missing_profile', 'signOut']);
  });

  it('discards a profile fetched for a previous user', async () => {
    const guard = createLoadGuard();
    const slow = deferred<Profile | null>();
    const first = makeDeps(() => slow.promise);
    const pending = resolveAdminSession('a', guard, first.deps);

    const second = makeDeps(async () => ({ role: 'user', status: 'active' }));
    await resolveAdminSession('b', guard, second.deps);

    slow.resolve(activeAdmin);
    expect(await pending).toEqual({ status: 'stale' });
    expect(first.calls).toEqual([]);
  });

  it('discards a profile that resolves after sign-out', async () => {
    const guard = createLoadGuard();
    const slow = deferred<Profile | null>();
    const { deps, calls } = makeDeps(() => slow.promise);
    const pending = resolveAdminSession('a', guard, deps);

    guard.begin();
    slow.resolve(activeAdmin);

    expect(await pending).toEqual({ status: 'stale' });
    expect(calls).toEqual([]);
  });

  it('a stale denial does not sign out the current user', async () => {
    const guard = createLoadGuard();
    const slow = deferred<Profile | null>();
    const stale = makeDeps(() => slow.promise);
    const pending = resolveAdminSession('a', guard, stale.deps);

    await resolveAdminSession(
      'b',
      guard,
      makeDeps(async () => activeAdmin).deps,
    );

    slow.resolve({ role: 'user', status: 'active' });
    expect(await pending).toEqual({ status: 'stale' });
    expect(stale.calls).toEqual([]);
  });
});
