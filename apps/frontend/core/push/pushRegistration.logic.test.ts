import { describe, expect, it } from 'bun:test';

import {
  createPushRegistrar,
  type PushRegistrarDeps,
} from './pushRegistration.logic';

const setup = (overrides: Partial<PushRegistrarDeps> = {}) => {
  const calls: string[] = [];
  const warnings: unknown[][] = [];
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
    warn: (...args) => {
      warnings.push(args);
    },
    ...overrides,
  };
  return { deps, calls, warnings, registrar: createPushRegistrar(deps) };
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
