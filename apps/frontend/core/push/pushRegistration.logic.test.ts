import { describe, expect, it } from 'bun:test';

import {
  createOnlineTransition,
  createPushRegistrar,
  isNetworkReachable,
  type PushRegistrarDeps,
} from './pushRegistration.logic';

const TOKEN = 'ExponentPushToken[abc]';
const REGISTERED_KEY = 'push:registeredToken';
const PENDING_KEY = 'push:pendingUnregister';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (overrides: Partial<PushRegistrarDeps> = {}) => {
  const calls: string[] = [];
  const warnings: unknown[][] = [];
  const store = new Map<string, string>();
  const deps: PushRegistrarDeps = {
    platform: 'android',
    getProjectId: () => 'project-1',
    createChannels: async () => {
      calls.push('channels');
    },
    hasPermission: async () => {
      calls.push('permission');
      return true;
    },
    getExpoPushToken: async (projectId) => {
      calls.push(`token:${projectId}`);
      return 'ExponentPushToken[abc]';
    },
    registerToken: async (token, platform) => {
      calls.push(`register:${token}:${platform}`);
    },
    unregisterToken: async (token) => {
      calls.push(`unregister:${token}`);
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
      },
      remove: async (key) => {
        store.delete(key);
      },
    },
    stepTimeoutMs: 50,
    warn: (...args) => {
      warnings.push(args);
    },
    ...overrides,
  };
  return { deps, calls, warnings, store, registrar: createPushRegistrar(deps) };
};

describe('createPushRegistrar.register', () => {
  it('does nothing on web', async () => {
    const { registrar, calls } = setup({ platform: 'web' });
    await registrar.register('user-1');
    expect(calls).toEqual([]);
  });

  it('creates the channels before it asks for a token on Android', async () => {
    const { registrar, calls } = setup();
    await registrar.register('user-1');
    expect(calls).toEqual([
      'channels',
      'permission',
      'token:project-1',
      'register:ExponentPushToken[abc]:android',
    ]);
  });

  it('registers with the ios platform and skips channels on iOS', async () => {
    const { registrar, calls } = setup({ platform: 'ios' });
    await registrar.register('user-1');
    expect(calls).toEqual([
      'permission',
      'token:project-1',
      'register:ExponentPushToken[abc]:ios',
    ]);
  });

  it('does not register without a session user', async () => {
    const { registrar, calls } = setup();
    await registrar.register(undefined);
    expect(calls).toEqual(['channels']);
  });

  it('does not register when permission is not granted', async () => {
    const { registrar, calls } = setup({
      hasPermission: async () => false,
    });
    await registrar.register('user-1');
    expect(calls).toEqual(['channels']);
  });

  it('swallows a missing project id and logs it', async () => {
    const { registrar, calls, warnings } = setup({
      getProjectId: () => undefined,
    });
    await registrar.register('user-1');
    expect(calls).toEqual(['channels', 'permission']);
    expect(warnings).toHaveLength(1);
  });

  it('swallows a token fetch failure and logs it', async () => {
    const { registrar, warnings } = setup({
      getExpoPushToken: async () => {
        throw new Error('FIS_AUTH_ERROR');
      },
    });
    await registrar.register('user-1');
    expect(warnings).toHaveLength(1);
  });

  it('swallows an RPC failure and logs it', async () => {
    const { registrar, warnings } = setup({
      registerToken: async () => {
        throw new Error('ACCOUNT_CLOSED');
      },
    });
    await expect(registrar.register('user-1')).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('allows registering the same token twice', async () => {
    const { registrar, calls } = setup();
    await registrar.register('user-1');
    await registrar.register('user-1');
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(2);
  });
});

describe('createPushRegistrar.unregister', () => {
  it('unregisters the last registered token', async () => {
    const { registrar, calls } = setup();
    await registrar.register('user-1');
    await registrar.unregister();
    expect(calls.at(-1)).toBe('unregister:ExponentPushToken[abc]');
  });

  it('skips the RPC when no token is known', async () => {
    const { registrar, calls } = setup();
    await registrar.unregister();
    expect(calls).toEqual([]);
  });

  it('swallows an unregister failure and logs it', async () => {
    const { registrar, warnings } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    await registrar.register('user-1');
    await expect(registrar.unregister()).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('forgets the token after a successful unregister', async () => {
    const { registrar, calls } = setup();
    await registrar.register('user-1');
    await registrar.unregister();
    await registrar.unregister();
    expect(calls.filter((c) => c.startsWith('unregister:'))).toHaveLength(1);
  });
});

describe('createPushRegistrar sign-out during a registration', () => {
  it('waits for an in-flight registration and unregisters its token', async () => {
    let finishRegister: () => void = () => {};
    const { registrar, calls } = setup({
      registerToken: (token, platform) =>
        new Promise<void>((resolve) => {
          calls.push(`register:${token}:${platform}`);
          finishRegister = resolve;
        }),
    });
    const registering = registrar.register('user-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const unregistering = registrar.unregister();
    finishRegister();
    await Promise.all([registering, unregistering]);
    expect(calls.at(-1)).toBe('unregister:ExponentPushToken[abc]');
  });
});

describe('createPushRegistrar after sign-out starts', () => {
  it('does not re-register a token queued while sign-out unregisters', async () => {
    let finish: () => void = () => {};
    const { registrar, calls } = setup({
      registerToken: (token, platform) =>
        new Promise<void>((resolve) => {
          calls.push(`register:${token}:${platform}`);
          finish = resolve;
        }),
    });
    const first = registrar.register('user-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const unregistering = registrar.unregister();
    const queued = registrar.register('user-1');
    finish();
    await Promise.all([first, unregistering, queued]);
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(1);
    const unregisteredAt = calls.indexOf('unregister:ExponentPushToken[abc]');
    expect(unregisteredAt).toBeGreaterThan(-1);
    expect(
      calls.slice(unregisteredAt).filter((c) => !c.startsWith('channels')),
    ).toEqual(['unregister:ExponentPushToken[abc]']);
  });

  it('registers again once the session changes after a sign-out', async () => {
    const { registrar, calls } = setup();
    await registrar.register('user-1');
    await registrar.unregister();
    await registrar.register(undefined);
    await registrar.register('user-1');
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(2);
  });
});

describe('createPushRegistrar persistence and retry', () => {
  it('stores the token after a successful registration', async () => {
    const { registrar, store } = setup();
    await registrar.register('user-1');
    expect(store.get(REGISTERED_KEY)).toBe(TOKEN);
  });

  it('keeps a token whose registration answer was lost, so sign-out removes it', async () => {
    const { registrar, store, calls } = setup({
      registerToken: async () => {
        throw new Error('offline');
      },
    });
    await registrar.register('user-1');
    expect(store.get(REGISTERED_KEY)).toBe(TOKEN);
    await registrar.unregister();
    expect(calls.at(-1)).toBe(`unregister:${TOKEN}`);
  });

  it('unregisters the stored token after an app restart', async () => {
    const { registrar, calls, store } = setup();
    store.set(REGISTERED_KEY, TOKEN);
    await registrar.unregister();
    expect(calls).toEqual([`unregister:${TOKEN}`]);
  });

  it('clears the pending mark and the stored token on success', async () => {
    const { registrar, store } = setup();
    await registrar.register('user-1');
    await registrar.unregister();
    expect(store.has(PENDING_KEY)).toBe(false);
    expect(store.has(REGISTERED_KEY)).toBe(false);
  });

  it('keeps a pending unregister when the call fails', async () => {
    const { registrar, store } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    await registrar.register('user-1');
    await registrar.unregister();
    expect(store.get(PENDING_KEY)).toBe(TOKEN);
  });

  it('keeps a pending unregister when the call never settles', async () => {
    const { registrar, store } = setup({
      unregisterToken: () => new Promise<void>(() => {}),
    });
    await registrar.register('user-1');
    await registrar.unregister();
    expect(store.get(PENDING_KEY)).toBe(TOKEN);
  });

  it('marks the token pending before the call is made', async () => {
    let seen: string | undefined;
    const harness = setup();
    harness.deps.unregisterToken = async () => {
      seen = harness.store.get(PENDING_KEY);
    };
    await harness.registrar.register('user-1');
    await harness.registrar.unregister();
    expect(seen).toBe(TOKEN);
  });

  it('flushes a pending unregister before it registers', async () => {
    const { registrar, calls, store } = setup();
    store.set(PENDING_KEY, 'ExponentPushToken[old]');
    await registrar.register('user-1');
    expect(calls[0]).toBe('unregister:ExponentPushToken[old]');
    expect(calls.at(-1)).toBe(`register:${TOKEN}:android`);
    expect(store.has(PENDING_KEY)).toBe(false);
  });

  it('flushes a pending unregister without a session', async () => {
    const { registrar, calls, store } = setup();
    store.set(PENDING_KEY, 'ExponentPushToken[old]');
    await registrar.register(undefined);
    expect(calls).toEqual(['unregister:ExponentPushToken[old]', 'channels']);
    expect(store.has(PENDING_KEY)).toBe(false);
  });

  it('keeps the pending mark and logs when the flush fails', async () => {
    const { registrar, store, warnings } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    store.set(PENDING_KEY, 'ExponentPushToken[old]');
    await registrar.register(undefined);
    expect(store.get(PENDING_KEY)).toBe('ExponentPushToken[old]');
    expect(warnings).toHaveLength(1);
  });

  it('drops the pending mark when the same token registers again', async () => {
    const { registrar, calls, store } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    store.set(PENDING_KEY, TOKEN);
    await registrar.register('user-2');
    expect(calls.at(-1)).toBe(`register:${TOKEN}:android`);
    expect(store.has(PENDING_KEY)).toBe(false);
  });

  it('keeps a different pending token when a token registers', async () => {
    const { registrar, store } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    store.set(PENDING_KEY, 'ExponentPushToken[old]');
    await registrar.register('user-2');
    expect(store.get(PENDING_KEY)).toBe('ExponentPushToken[old]');
  });

  it('does not stall later steps behind a step that never settles', async () => {
    let first = true;
    const { registrar, calls, warnings } = setup({
      hasPermission: () => {
        if (first) {
          first = false;
          return new Promise<boolean>(() => {});
        }
        return Promise.resolve(true);
      },
    });
    await registrar.register('user-1');
    await registrar.register('user-1');
    expect(calls.at(-1)).toBe(`register:${TOKEN}:android`);
    expect(warnings).toHaveLength(1);
  });

  it('never puts a token value in a warning', async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    const { registrar, store, warnings } = setup({
      registerToken: failing,
      unregisterToken: failing,
    });
    store.set(PENDING_KEY, 'ExponentPushToken[old]');
    store.set(REGISTERED_KEY, TOKEN);
    await registrar.register('user-1');
    await registrar.unregister();
    expect(warnings.length).toBeGreaterThan(0);
    for (const args of warnings) {
      expect(args.map(String).join(' ')).not.toContain('ExponentPushToken');
    }
  });
});

describe('createPushRegistrar sign-out finished', () => {
  it('registers again after a failed sign-out releases the block', async () => {
    const { registrar, calls } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    await registrar.register('user-1');
    await registrar.unregister();
    registrar.signOutFinished();
    await registrar.register('user-1');
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(2);
  });

  it('keeps the block until the sign-out finishes', async () => {
    const { registrar, calls } = setup();
    await registrar.register('user-1');
    await registrar.unregister();
    await registrar.register('user-1');
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(1);
  });

  it('does not register a queued token before the unregister ran', async () => {
    let finishUnregister: () => void = () => {};
    const { registrar, calls } = setup({
      unregisterToken: (token) =>
        new Promise<void>((resolve) => {
          calls.push(`unregister:${token}`);
          finishUnregister = resolve;
        }),
    });
    await registrar.register('user-1');
    const unregistering = registrar.unregister();
    const queued = registrar.register('user-1');
    await tick();
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(1);
    finishUnregister();
    await Promise.all([unregistering, queued]);
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(1);
  });
});

describe('isNetworkReachable', () => {
  it('is true when the internet is reachable', () => {
    expect(
      isNetworkReachable({ isConnected: true, isInternetReachable: true }),
    ).toBe(true);
  });

  it('is false when the internet is known to be unreachable', () => {
    expect(
      isNetworkReachable({ isConnected: true, isInternetReachable: false }),
    ).toBe(false);
  });

  it('falls back to the connection when reachability is unknown', () => {
    expect(
      isNetworkReachable({ isConnected: true, isInternetReachable: null }),
    ).toBe(true);
    expect(
      isNetworkReachable({ isConnected: false, isInternetReachable: null }),
    ).toBe(false);
  });
});

describe('createPushRegistrar pending mark at sign-out start', () => {
  it('marks the stored token pending before an earlier stalled step ends', async () => {
    const { registrar, store } = setup({
      createChannels: () => new Promise<void>(() => {}),
      stepTimeoutMs: 1000,
    });
    store.set(REGISTERED_KEY, TOKEN);
    void registrar.register('user-1');
    await tick();
    void registrar.unregister();
    await tick();
    expect(store.get(PENDING_KEY)).toBe(TOKEN);
  });
});

describe('createPushRegistrar late responses', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  // A server that records which account holds the token.
  const raceSetup = () => {
    const server = new Map<string, string>();
    let user = 'A';
    let onRegister = async (token: string) => {
      server.set(token, user);
    };
    let onUnregister = async (token: string) => {
      server.delete(token);
    };
    const harness = setup({
      stepTimeoutMs: 30,
      registerToken: (token) => onRegister(token),
      unregisterToken: (token) => onUnregister(token),
    });
    return {
      ...harness,
      server,
      as: (next: string) => {
        user = next;
      },
      setRegister: (fn: typeof onRegister) => {
        onRegister = fn;
      },
      setUnregister: (fn: typeof onUnregister) => {
        onUnregister = fn;
      },
    };
  };

  it('a late unregister response does not erase the next account token', async () => {
    const h = raceSetup();
    await h.registrar.register('A');
    const late = deferred();
    h.setUnregister(async (token) => {
      h.server.delete(token);
      await late.promise;
    });
    const out = h.registrar.unregister();
    await wait(60);
    h.registrar.signOutFinished();
    h.setUnregister(async (token) => {
      h.server.delete(token);
    });
    await h.registrar.register(undefined);
    h.as('B');
    await h.registrar.register('B');
    late.resolve();
    await out;
    await tick();
    await h.registrar.unregister();
    h.registrar.signOutFinished();
    expect(h.server.get(TOKEN)).toBeUndefined();
  });

  it('the network-return retry leaves the token on the signed-in account', async () => {
    const h = raceSetup();
    await h.registrar.register('A');
    h.setUnregister(async () => {
      throw new Error('offline');
    });
    await h.registrar.unregister();
    h.registrar.signOutFinished();
    h.as('B');
    const late = deferred();
    h.setRegister(async (token) => {
      h.server.set(token, 'B');
      await late.promise;
    });
    await h.registrar.register('B');
    h.setUnregister(async (token) => {
      h.server.delete(token);
    });
    h.setRegister(async (token) => {
      h.server.set(token, 'B');
    });
    await h.registrar.register('B');
    late.resolve();
    await tick();
    expect(h.server.get(TOKEN)).toBe('B');
  });

  it('removes the token again when a register without an answer lands after sign-out', async () => {
    const h = raceSetup();
    const late = deferred();
    h.setRegister(async (token) => {
      await late.promise;
      h.server.set(token, 'A');
    });
    await h.registrar.register('A');
    await h.registrar.unregister();
    h.registrar.signOutFinished();
    late.resolve();
    await tick();
    expect(h.server.get(TOKEN)).toBe('A');
    await h.registrar.register(undefined);
    expect(h.server.get(TOKEN)).toBeUndefined();
    expect(h.store.has(PENDING_KEY)).toBe(false);
  });

  it('a late registration of a signed-out user keeps the pending mark', async () => {
    const h = raceSetup();
    await h.registrar.register('A');
    const late = deferred();
    h.setRegister(async (token) => {
      h.server.set(token, 'A');
      await late.promise;
    });
    const registering = h.registrar.register('A');
    await tick();
    h.setUnregister(async () => {
      throw new Error('offline');
    });
    const out = h.registrar.unregister();
    await wait(60);
    await out;
    h.registrar.signOutFinished();
    late.resolve();
    await registering;
    await tick();
    expect(h.store.get(PENDING_KEY)).toBe(TOKEN);
  });
});

describe('createOnlineTransition', () => {
  const online = { isConnected: true, isInternetReachable: true };
  const offline = { isConnected: false, isInternetReachable: false };

  it('does not fire on the first state, which the mount already covers', () => {
    expect(createOnlineTransition()(online)).toBe(false);
    expect(createOnlineTransition()(offline)).toBe(false);
  });

  it('fires only when the network comes back after being unreachable', () => {
    const backOnline = createOnlineTransition();
    expect(backOnline(offline)).toBe(false);
    expect(backOnline(online)).toBe(true);
  });

  it('does not fire again while the network stays reachable', () => {
    const backOnline = createOnlineTransition();
    expect(backOnline(online)).toBe(false);
    expect(backOnline(online)).toBe(false);
    expect(backOnline({ isConnected: true, isInternetReachable: null })).toBe(
      false,
    );
  });

  it('fires once per return when the network drops again', () => {
    const backOnline = createOnlineTransition();
    expect(backOnline(online)).toBe(false);
    expect(backOnline(offline)).toBe(false);
    expect(backOnline(offline)).toBe(false);
    expect(backOnline(online)).toBe(true);
    expect(backOnline(offline)).toBe(false);
    expect(backOnline(online)).toBe(true);
  });
});

describe('createPushRegistrar burst of callers', () => {
  const blockFirstToken = (calls: string[]) => {
    let release: () => void = () => {};
    let blocked = true;
    const getExpoPushToken = async (projectId: string) => {
      calls.push(`token:${projectId}`);
      if (blocked) {
        blocked = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return TOKEN;
    };
    return { getExpoPushToken, release: () => release() };
  };

  it('collapses registrations queued behind a running one into one', async () => {
    const calls: string[] = [];
    const gate = blockFirstToken(calls);
    const { registrar } = setup({
      getExpoPushToken: gate.getExpoPushToken,
      registerToken: async (token, platform) => {
        calls.push(`register:${token}:${platform}`);
      },
    });
    const first = registrar.register('user-1');
    await tick();
    const burst = Array.from({ length: 10 }, () =>
      registrar.register('user-1'),
    );
    gate.release();
    await Promise.all([first, ...burst]);
    expect(calls.filter((c) => c.startsWith('token:'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('register:'))).toHaveLength(2);
  });

  it('a collapsed call settles when the queued registration finishes', async () => {
    const calls: string[] = [];
    const gate = blockFirstToken(calls);
    const { registrar } = setup({ getExpoPushToken: gate.getExpoPushToken });
    void registrar.register('user-1');
    await tick();
    const queued = registrar.register('user-1');
    const collapsed = registrar.register('user-1');
    let settled = false;
    void collapsed.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    gate.release();
    await queued;
    await collapsed;
    expect(settled).toBe(true);
  });

  it('never collapses a registration across a sign-out', async () => {
    const calls: string[] = [];
    const gate = blockFirstToken(calls);
    const { registrar } = setup({
      getExpoPushToken: gate.getExpoPushToken,
      registerToken: async (token, platform) => {
        calls.push(`register:${token}:${platform}`);
      },
      unregisterToken: async (token) => {
        calls.push(`unregister:${token}`);
      },
    });
    const first = registrar.register('user-1');
    await tick();
    const beforeSignOut = registrar.register('user-1');
    const signingOut = registrar.unregister();
    const nextAccount = registrar.register('user-2');
    gate.release();
    await Promise.all([first, beforeSignOut, signingOut, nextAccount]);
    const unregisteredAt = calls.indexOf(`unregister:${TOKEN}`);
    expect(unregisteredAt).toBeGreaterThan(-1);
    // The second account registers after the sign-out, so the token stays on it.
    expect(calls.at(-1)).toBe(`register:${TOKEN}:android`);
    expect(calls.lastIndexOf(`register:${TOKEN}:android`)).toBeGreaterThan(
      unregisteredAt,
    );
  });
});
