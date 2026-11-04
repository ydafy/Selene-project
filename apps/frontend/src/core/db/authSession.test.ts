import { describe, expect, it, spyOn } from 'bun:test';

import {
  bindAutoRefreshToAppState,
  createNativeAuthOptions,
  type AppStateSource,
  type AuthStorage,
} from './authSession';

const storage: AuthStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

function createAuthSpy() {
  const calls: string[] = [];
  return {
    calls,
    auth: {
      startAutoRefresh: async () => {
        calls.push('start');
      },
      stopAutoRefresh: async () => {
        calls.push('stop');
      },
    },
  };
}

function createAppState(currentState: string) {
  const listeners: ((state: string) => void)[] = [];
  let removed = 0;
  const source: AppStateSource = {
    currentState,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      return {
        remove: () => {
          removed += 1;
          listeners.splice(listeners.indexOf(listener), 1);
        },
      };
    },
  };
  return {
    source,
    emit: (state: string) => listeners.forEach((listener) => listener(state)),
    listenerCount: () => listeners.length,
    removedCount: () => removed,
  };
}

describe('createNativeAuthOptions', () => {
  it('persists the session in the provided device storage', () => {
    expect(createNativeAuthOptions(storage)).toEqual({
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    });
  });

  it('keeps the exact storage instance instead of a copy', () => {
    expect(createNativeAuthOptions(storage).storage).toBe(storage);
  });
});

describe('bindAutoRefreshToAppState', () => {
  it('starts refreshing immediately when the app launches in the foreground', () => {
    const { auth, calls } = createAuthSpy();
    bindAutoRefreshToAppState(auth, createAppState('active').source);
    expect(calls).toEqual(['start']);
  });

  it('stays stopped when the app launches in the background', () => {
    const { auth, calls } = createAuthSpy();
    bindAutoRefreshToAppState(auth, createAppState('background').source);
    expect(calls).toEqual(['stop']);
  });

  it('stops on background and inactive, and restarts on resume', () => {
    const { auth, calls } = createAuthSpy();
    const appState = createAppState('active');
    bindAutoRefreshToAppState(auth, appState.source);

    appState.emit('background');
    appState.emit('active');
    appState.emit('inactive');

    expect(calls).toEqual(['start', 'stop', 'start', 'stop']);
  });

  it('removes its listener when unbound', () => {
    const { auth, calls } = createAuthSpy();
    const appState = createAppState('active');
    const unbind = bindAutoRefreshToAppState(auth, appState.source);

    unbind();
    appState.emit('background');

    expect(appState.listenerCount()).toBe(0);
    expect(appState.removedCount()).toBe(1);
    expect(calls).toEqual(['start']);
  });
});

describe('bindAutoRefreshToAppState hardening', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('logs a rejected start/stop instead of dropping it', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = {
      startAutoRefresh: async () => {
        throw new Error('start failed');
      },
      stopAutoRefresh: async () => {
        throw new Error('stop failed');
      },
    };
    const appState = createAppState('active');
    bindAutoRefreshToAppState(auth, appState.source);
    appState.emit('background');
    await flush();

    const logged = spy.mock.calls.map((args) => args.join(' '));
    spy.mockRestore();
    expect(logged).toHaveLength(2);
    expect(logged[0]).toContain('start failed');
    expect(logged[1]).toContain('stop failed');
  });

  it('re-applies the current state once the client is ready', async () => {
    const { auth, calls } = createAuthSpy();
    const appState = createAppState('background');
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    bindAutoRefreshToAppState(auth, appState.source, ready);
    expect(calls).toEqual(['stop']);

    release();
    await flush();
    expect(calls).toEqual(['stop', 'stop']);
  });

  it('re-applies a state change that happened while initializing', async () => {
    const { auth, calls } = createAuthSpy();
    const appState = createAppState('active');
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    bindAutoRefreshToAppState(auth, appState.source, ready);
    appState.source.currentState = 'background';

    release();
    await flush();
    expect(calls[calls.length - 1]).toBe('stop');
  });

  it('still re-applies when readiness rejects, and does nothing after unbind', async () => {
    const { auth, calls } = createAuthSpy();
    bindAutoRefreshToAppState(
      auth,
      createAppState('active').source,
      Promise.reject(new Error('init failed')),
    );
    await flush();
    expect(calls).toEqual(['start', 'start']);

    const second = createAuthSpy();
    const unbind = bindAutoRefreshToAppState(
      second.auth,
      createAppState('active').source,
      Promise.resolve(),
    );
    unbind();
    await flush();
    expect(second.calls).toEqual(['start']);
  });
});
