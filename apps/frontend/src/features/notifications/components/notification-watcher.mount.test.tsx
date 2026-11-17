import { expect, mock, test } from 'bun:test';
import React from 'react';
import type { Notification } from '@selene/types';

// Isolate the RN mock from other Bun test files that load the native entrypoint.
if (process.env.SELENE_NOTIFICATION_MOUNT_CHILD !== 'watcher') {
  test('mounts the notification watcher in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_NOTIFICATION_MOUNT_CHILD: 'watcher' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const host =
    (name: string) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);
  const navigate = mock(async (path: string | null) => {
    void path;
  });
  const notice: Notification = {
    id: 'notice-1',
    user_id: 'owner-1',
    created_at: '2026-01-01',
    deleted_at: null,
    title: 'Unread launch notice',
    message: 'Details',
    type: 'error',
    read: false,
    action_path: '/profile/orders/123',
    event_kind: null,
    source_event_key: null,
    event_payload: {},
  };
  const from = mock(() => ({
    select: () => ({
      eq: () => ({
        is: () => ({
          or: () => ({
            order: () => ({
              order: () => ({
                limit: async () => ({ data: [notice], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  }));
  const removeChannel = mock((removed: unknown) => {
    void removed;
  });
  const queryClient = { invalidateQueries: mock(() => {}) };
  const t = (key: string) => key;
  type Handler = (payload: unknown) => void;
  type StatusCallback = (status: string, error?: Error) => void;
  const channelCalls: unknown[][] = [];
  const onCalls: { type: string; filter: unknown; handler: Handler }[] = [];
  const subscribeCallbacks: StatusCallback[] = [];
  const channel = {
    on: (type: string, filter: unknown, handler: Handler) => {
      onCalls.push({ type, filter, handler });
      return channel;
    },
    subscribe: (callback: StatusCallback) => {
      subscribeCallbacks.push(callback);
      return channel;
    },
  };
  let pendingAuth: (() => void) | null = null;
  let holdAuth = false;
  const setAuth = mock(
    () =>
      new Promise<void>((resolve) => {
        if (holdAuth) pendingAuth = resolve;
        else resolve();
      }),
  );
  const toastShow = mock(() => {});
  let launchTap = false;
  const consumeLaunchTap = mock(() => {
    const wasTap = launchTap;
    launchTap = false;
    return wasTap;
  });

  mock.module('react-native', () => ({
    Pressable: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        'Pressable',
        { accessible: true, ...props },
        children,
      ),
    StyleSheet: { flatten: (style: unknown) => style },
  }));
  mock.module('react-native-toast-message', () => ({
    default: { show: toastShow },
  }));
  mock.module('@tanstack/react-query', () => ({
    useQueryClient: () => queryClient,
  }));
  mock.module('@/shared/lib/auth/auth-provider', () => ({
    useAuthContext: () => ({ session: { user: { id: 'owner-1' } } }),
  }));
  mock.module('@/shared/lib/supabase', () => ({
    supabase: {
      from,
      channel: (...args: unknown[]) => {
        channelCalls.push(args);
        return channel;
      },
      removeChannel,
      realtime: { setAuth },
    },
  }));
  const { invalidateNotificationKeys } =
    await import('../logic/notification-mutations.logic');
  mock.module('../hooks/use-notification-mutations', () => ({
    invalidateNotificationKeys,
  }));
  mock.module('../lib/notification-linking', () => ({
    NotificationLinking: { navigate },
  }));
  mock.module('../lib/push-tap', () => ({
    pushTapRouter: { consumeLaunchTap },
  }));
  mock.module('react-i18next', () => ({ useTranslation: () => ({ t }) }));
  mock.module('@/shared/ui/feedback/confirm-dialog', () => ({
    ConfirmDialog: host('ConfirmDialog'),
  }));
  mock.module('@/shared/ui/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));

  const { act, render } = await import('@testing-library/react-native');
  const { NotificationWatcher } = await import('./notification-watcher');

  const byType = (view: Awaited<ReturnType<typeof render>>, type: string) =>
    view.container.queryAll((node) => node.type === type);

  test('mounted owner launch shows unread digest and navigates without marking read', async () => {
    let view = await render(<NotificationWatcher />);
    expect(from).toHaveBeenCalledWith('notifications');
    const dialog = byType(view, 'ConfirmDialog')[0];
    expect(dialog.props.title).toBe('notifications:digestTitle');
    expect(
      byType(view, 'Text').some(
        (node) =>
          node.props.children === notice.title ||
          node.props.children === notice.message,
      ),
    ).toBe(false);
    expect(byType(view, 'Pressable')).toHaveLength(0);
    expect(dialog.props.confirmLabel).toBe('notifications:digestOpen');
    expect(dialog.props.cancelLabel).toBe('notifications:digestSkip');
    expect(navigate).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
    // ConfirmDialog is a host stand-in without a pressable of its own, so the
    // prop handler is the only way to reach it.
    await act(async () => {
      dialog.props.onCancel();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(byType(view, 'ConfirmDialog')).toHaveLength(0);
    expect(from).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);

    view = await render(<NotificationWatcher />);
    const open = byType(view, 'ConfirmDialog')[0];
    await act(async () => {
      open.props.onConfirm();
    });
    expect(navigate).toHaveBeenCalledWith('/profile/notifications');
    expect(byType(view, 'ConfirmDialog')).toHaveLength(0);
    await view.unmount();

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(2);
  });

  test('a launch opened by a push tap skips the digest once', async () => {
    launchTap = true;
    let view = await render(<NotificationWatcher />);
    expect(from).toHaveBeenCalledTimes(3);
    expect(byType(view, 'ConfirmDialog')).toHaveLength(0);
    expect(navigate).toHaveBeenCalledTimes(1);
    await view.unmount();

    view = await render(<NotificationWatcher />);
    expect(byType(view, 'ConfirmDialog')[0].props.title).toBe(
      'notifications:digestTitle',
    );
    await view.unmount();
  });

  test('listens on the private per-user broadcast channel after setting auth', async () => {
    channelCalls.length = 0;
    onCalls.length = 0;
    subscribeCallbacks.length = 0;
    setAuth.mockClear();
    removeChannel.mockClear();
    queryClient.invalidateQueries.mockClear();
    const view = await render(<NotificationWatcher />);
    await act(async () => {});
    expect(channelCalls).toEqual([
      ['user:owner-1:notifications', { config: { private: true } }],
    ]);
    expect(setAuth).toHaveBeenCalledTimes(1);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].type).toBe('broadcast');
    expect(onCalls[0].filter).toEqual({ event: 'changed' });
    expect(subscribeCallbacks).toHaveLength(1);

    await act(async () => {
      onCalls[0].handler({ event: 'changed', payload: {} });
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['notifications', 'owner-1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['unread-notifications', 'owner-1'],
    });

    await view.unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  test('a channel error or timeout warns without a toast or console.error', async () => {
    subscribeCallbacks.length = 0;
    const view = await render(<NotificationWatcher />);
    await act(async () => {});
    toastShow.mockClear();
    const errorSpy = mock(() => {});
    const warnSpy = mock(() => {});
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = errorSpy;
    console.warn = warnSpy;
    try {
      const failure = new Error('join failed');
      await act(async () => {
        subscribeCallbacks[0]('CHANNEL_ERROR', failure);
        subscribeCallbacks[0]('TIMED_OUT');
      });
      expect(toastShow).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[NotificationWatcher] Realtime channel',
        'CHANNEL_ERROR',
        failure,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[NotificationWatcher] Realtime channel',
        'TIMED_OUT',
        undefined,
      );
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }
    await view.unmount();
  });

  test('unmounting before setAuth resolves never subscribes and removes the channel', async () => {
    subscribeCallbacks.length = 0;
    removeChannel.mockClear();
    holdAuth = true;
    const view = await render(<NotificationWatcher />);
    await view.unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingAuth?.();
    });
    expect(subscribeCallbacks).toHaveLength(0);
    holdAuth = false;
  });
}
