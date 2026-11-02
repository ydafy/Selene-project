import { describe, expect, it } from 'bun:test';

import {
  createPushPermissionPrompt,
  type PushPermission,
  type PushPermissionPromptDeps,
} from './pushPermission.logic';

const UNDETERMINED: PushPermission = {
  status: 'undetermined',
  canAskAgain: true,
};

const setup = (
  permission: PushPermission = UNDETERMINED,
  overrides: Partial<PushPermissionPromptDeps> = {},
) => {
  const store = new Map<string, string>();
  const warnings: unknown[][] = [];
  const requests: string[] = [];
  const deps: PushPermissionPromptDeps = {
    platform: 'android',
    getPermission: async () => permission,
    requestPermission: async () => {
      requests.push('request');
      return { status: 'granted', canAskAgain: true };
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
      },
    },
    warn: (...args) => {
      warnings.push(args);
    },
    ...overrides,
  };
  return {
    store,
    warnings,
    requests,
    prompt: createPushPermissionPrompt(deps),
  };
};

describe('createPushPermissionPrompt.offer', () => {
  it('offers a moment while the OS status is undetermined and marks it shown', async () => {
    const { prompt, store } = setup();
    expect(await prompt.offer('purchase')).toBe(true);
    expect(store.get('push:prompted:purchase')).toBe('1');
  });

  it('offers each moment at most once per device', async () => {
    const { prompt } = setup();
    expect(await prompt.offer('favorite')).toBe(true);
    expect(await prompt.offer('favorite')).toBe(false);
  });

  it('keeps the three moments independent', async () => {
    const { prompt, store } = setup();
    expect(await prompt.offer('purchase')).toBe(true);
    expect(await prompt.offer('favorite')).toBe(true);
    expect(await prompt.offer('listing')).toBe(true);
    expect([...store.keys()].sort()).toEqual([
      'push:prompted:favorite',
      'push:prompted:listing',
      'push:prompted:purchase',
    ]);
  });

  it('does not offer when the permission is already granted, and leaves no mark', async () => {
    const { prompt, store } = setup({ status: 'granted', canAskAgain: true });
    expect(await prompt.offer('purchase')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('does not offer when the OS denied it', async () => {
    const { prompt, store } = setup({ status: 'denied', canAskAgain: false });
    expect(await prompt.offer('listing')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('does not offer when the OS can no longer ask', async () => {
    const { prompt } = setup({ status: 'undetermined', canAskAgain: false });
    expect(await prompt.offer('purchase')).toBe(false);
  });

  it('does nothing on web', async () => {
    const { prompt, store } = setup(UNDETERMINED, { platform: 'web' });
    expect(await prompt.offer('purchase')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('does not offer and warns when reading the permission fails', async () => {
    const { prompt, store, warnings } = setup(UNDETERMINED, {
      getPermission: async () => {
        throw new Error('boom');
      },
    });
    expect(await prompt.offer('favorite')).toBe(false);
    expect(store.size).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it('does not offer when the mark cannot be stored, so it never shows twice', async () => {
    const { prompt, warnings } = setup(UNDETERMINED, {
      storage: {
        get: async () => null,
        set: async () => {
          throw new Error('disk full');
        },
      },
    });
    expect(await prompt.offer('purchase')).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('offers once when the same moment fires twice at the same time', async () => {
    const { prompt } = setup();
    const results = await Promise.all([
      prompt.offer('favorite'),
      prompt.offer('favorite'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('createPushPermissionPrompt.request', () => {
  it('asks the OS and reports whether it granted', async () => {
    const { prompt, requests } = setup();
    expect(await prompt.request()).toBe(true);
    expect(requests).toEqual(['request']);
  });

  it('reports false when the OS denies', async () => {
    const { prompt } = setup(UNDETERMINED, {
      requestPermission: async () => ({ status: 'denied', canAskAgain: false }),
    });
    expect(await prompt.request()).toBe(false);
  });

  it('reports false and warns when the request fails', async () => {
    const { prompt, warnings } = setup(UNDETERMINED, {
      requestPermission: async () => {
        throw new Error('boom');
      },
    });
    expect(await prompt.request()).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});
