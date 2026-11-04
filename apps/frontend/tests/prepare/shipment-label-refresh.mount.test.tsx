import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import React from 'react';

if (process.env.SELENE_LABEL_REFRESH_CHILD !== '1') {
  test('mounts the label refresh lifecycle in an isolated process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_LABEL_REFRESH_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let focused = true;
  let blurImmediately = false;
  let currentState = 'active';
  const listeners = new Set<(state: string) => void>();
  mock.module('expo-router/react-navigation', () => ({
    useFocusEffect: (effect: React.EffectCallback) => {
      React.useEffect(() => {
        const cleanup = focused ? effect() : undefined;
        if (blurImmediately && cleanup) cleanup();
        return cleanup;
      }, [effect, focused]);
    },
  }));
  mock.module('react-native', () => ({
    StyleSheet: { flatten: (style: unknown) => style },
    AppState: {
      get currentState() {
        return currentState;
      },
      addEventListener: (_event: string, listener: (state: string) => void) => {
        listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      },
    },
  }));
  const { act, render } = await import('@testing-library/react-native');
  const { useShipmentLabelRefresh } =
    await import('../../src/core/hooks/useShipmentLabelRefresh');
  const Probe = ({
    id,
    refresh,
  }: {
    id?: string;
    refresh: () => Promise<unknown>;
  }) => {
    useShipmentLabelRefresh(id, refresh);
    return null;
  };
  const emit = (state: string) => {
    currentState = state;
    for (const listener of listeners) listener(state);
  };
  let view: Awaited<ReturnType<typeof render>> | undefined;
  beforeEach(() => {
    focused = true;
    blurImmediately = false;
    currentState = 'active';
  });
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
    expect(listeners.size).toBe(0);
  });

  test('does not start the scheduled read if focus is cleaned up immediately', async () => {
    blurImmediately = true;
    const refresh = mock(async () => {});
    view = await render(<Probe id="shipment-1" refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(0);
    expect(listeners.size).toBe(0);
  });

  test('refreshes on focus and resume, never while blurred, and removes listeners', async () => {
    const refresh = mock(async () => {});
    view = await render(<Probe id="shipment-1" refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    await act(async () => {
      emit('background');
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      emit('active');
      emit('active');
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    focused = false;
    await view!.rerender(<Probe id="shipment-1" refresh={refresh} />);
    expect(listeners.size).toBe(0);
    await act(async () => {
      emit('background');
      emit('active');
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    focused = true;
    await view!.rerender(<Probe id="shipment-1" refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(listeners.size).toBe(1);
  });

  test('coalesces resume events during an outstanding read into one follow-up read', async () => {
    let resolveRead!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveRead = resolve;
    });
    let calls = 0;
    const refresh = () => {
      calls++;
      return calls === 1 ? pending : Promise.resolve();
    };
    view = await render(<Probe id="shipment-1" refresh={refresh} />);
    await act(async () => {
      emit('background');
      emit('active');
      emit('background');
      emit('active');
    });
    expect(calls).toBe(1);
    await act(async () => {
      resolveRead();
      await pending;
    });
    expect(calls).toBe(2);
  });

  test('does not execute a queued read after unmount', async () => {
    let resolveRead!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveRead = resolve;
    });
    const refresh = mock(() => pending);
    view = await render(<Probe id="shipment-1" refresh={refresh} />);
    await act(async () => {
      emit('background');
      emit('active');
    });
    await view!.unmount();
    view = undefined;
    await act(async () => {
      resolveRead();
      await pending;
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  test('waits for a selected shipment and replaces the subscription on selection changes', async () => {
    const refresh = mock(async () => {});
    view = await render(<Probe refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(0);
    expect(listeners.size).toBe(0);
    await view!.rerender(<Probe id="shipment-1" refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    await view!.rerender(<Probe id="shipment-2" refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(1);
  });

  test('contains refresh rejections without losing the next resume event', async () => {
    const refresh = mock(async () => {
      throw new Error('read failed');
    });
    view = await render(<Probe id="shipment-1" refresh={refresh} />);
    await act(async () => {
      emit('background');
      emit('active');
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(1);
  });
}
