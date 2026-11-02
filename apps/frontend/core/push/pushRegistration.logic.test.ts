import { describe, expect, it } from 'bun:test';

import {
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

  it('does not store a token when registration fails', async () => {
    const { registrar, store } = setup({
      registerToken: async () => {
        throw new Error('offline');
      },
    });
    await registrar.register('user-1');
    expect(store.has(REGISTERED_KEY)).toBe(false);
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
    await registrar.flushPending();
    expect(calls).toEqual(['unregister:ExponentPushToken[old]']);
    expect(store.has(PENDING_KEY)).toBe(false);
  });

  it('keeps the pending mark and logs when the flush fails', async () => {
    const { registrar, store, warnings } = setup({
      unregisterToken: async () => {
        throw new Error('offline');
      },
    });
    store.set(PENDING_KEY, 'ExponentPushToken[old]');
    await registrar.flushPending();
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
