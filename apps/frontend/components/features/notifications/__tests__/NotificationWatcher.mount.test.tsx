import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';
import type { Notification } from '@selene/types';

// Isolate the RN mock from other Bun test files that load the native entrypoint.
if (process.env.SELENE_NOTIFICATION_MOUNT_CHILD !== 'watcher') {
  test('mounts the notification watcher in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_NOTIFICATION_MOUNT_CHILD: 'watcher' },
      stdout: 'pipe', stderr: 'pipe',
    });
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const host = (name: string) => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(name, props, children);
  const navigate = mock(async (path: string | null) => { void path; });
  const notice: Notification = {
    id: 'notice-1', user_id: 'owner-1', created_at: '2026-01-01', deleted_at: null,
    title: 'Unread launch notice', message: 'Details', type: 'error', read: false,
    action_path: '/profile/orders/123',
  };
  const from = mock(() => ({
    select: () => ({
      eq: () => ({
        is: () => ({
          or: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: [notice], error: null }) }) }) }),
        }),
      }),
    }),
  }));
  const removeChannel = mock((removed: unknown) => { void removed; });
  const queryClient = { invalidateQueries: mock(() => {}) };
  const t = (key: string) => key;
  const channel = { on: () => channel, subscribe: () => channel };

  mock.module('react-native', () => ({ Pressable: host('Pressable') }));
  mock.module('react-native-toast-message', () => ({ default: { show: mock(() => {}) } }));
  mock.module('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }));
  mock.module('../../../auth/AuthProvider', () => ({ useAuthContext: () => ({ session: { user: { id: 'owner-1' } } }) }));
  mock.module('../../../../core/db/supabase', () => ({ supabase: { from, channel: () => channel, removeChannel } }));
  mock.module('../../../../core/hooks/useNotificationMutations', () => ({ invalidateNotificationKeys: mock(() => {}) }));
  mock.module('../../../../core/services/notification', () => ({ NotificationLinking: { navigate } }));
  mock.module('react-i18next', () => ({ useTranslation: () => ({ t }) }));
  mock.module('../../../ui/ConfirmDialog', () => ({ ConfirmDialog: host('ConfirmDialog') }));
  mock.module('../../../base', () => ({ Box: host('Box'), Text: host('Text') }));

  const { NotificationWatcher } = await import('../NotificationWatcher');

  test('mounted owner launch shows unread digest and navigates without marking read', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<NotificationWatcher />); });
    expect(from).toHaveBeenCalledWith('notifications');
    const dialog = tree!.root.findByType('ConfirmDialog');
    expect(dialog.props.title).toBe('notifications:digestTitle');
    expect(tree!.root.findAllByType('Text').some((node: { props: { children: unknown } }) => node.props.children === notice.title)).toBe(true);
    const inbox = tree!.root.findByType('Pressable');
    expect(inbox.props.accessibilityLabel).toBe('notifications:digestInbox');
    expect(navigate).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
    await act(async () => { dialog.props.onCancel(); });
    expect(navigate).not.toHaveBeenCalled();
    expect(tree!.root.findAllByType('ConfirmDialog')).toHaveLength(0);
    expect(from).toHaveBeenCalledTimes(1);
    await act(async () => { tree!.unmount(); });
    expect(removeChannel).toHaveBeenCalledTimes(1);

    await act(async () => { tree = create(<NotificationWatcher />); });
    const open = tree!.root.findByType('ConfirmDialog');
    await act(async () => { open.props.onConfirm(); });
    expect(navigate).toHaveBeenCalledWith('/profile/orders/123');
    expect(tree!.root.findAllByType('ConfirmDialog')).toHaveLength(0);
    await act(async () => { tree!.unmount(); });

    await act(async () => { tree = create(<NotificationWatcher />); });
    await act(async () => { tree!.root.findByType('Pressable').props.onPress(); });
    expect(navigate).toHaveBeenCalledWith('/profile/notifications');
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(3);
    await act(async () => { tree!.unmount(); });
  });
}
