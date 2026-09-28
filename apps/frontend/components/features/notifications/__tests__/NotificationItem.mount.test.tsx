import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';
import type { Notification } from '@selene/types';

// Bun shares its module registry across suite files; a child isolates the RN mock
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_NOTIFICATION_MOUNT_CHILD !== 'item') {
  test('mounts the notification item in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_NOTIFICATION_MOUNT_CHILD: 'item' },
      stdout: 'pipe', stderr: 'pipe',
    });
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const host = (name: string) => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(name, props, children);
  const Pressable = ({ children, ...props }: { children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode) } & Record<string, unknown>) =>
    React.createElement('Pressable', props, typeof children === 'function' ? children({ pressed: false }) : children);

  mock.module('react-native', () => ({ Pressable }));
  mock.module('@expo/vector-icons', () => ({ MaterialCommunityIcons: host('Icon') }));
  mock.module('@shopify/restyle', () => ({ useTheme: () => ({ colors: { primary: 'blue', error: 'red' } }) }));
  mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => `${key}${values ? ':' + JSON.stringify(values) : ''}` }) }));
  mock.module('../../../base', () => ({ Box: host('Box'), Text: host('Text') }));
  mock.module('../../../../core/utils/format', () => ({ formatSmartTime: () => 'now' }));
  mock.module('../../../ui/ConfirmDialog', () => ({ ConfirmDialog: host('ConfirmDialog') }));

  const { NotificationItem } = await import('../NotificationItem');
  const notification: Notification = { id: 'n', user_id: 'u', created_at: '2026-01-01', deleted_at: null, title: 'Title', message: 'Message', type: 'error', read: false, action_path: null };

  test('mounted item separates navigation, explicit read, and confirmed dismissal', async () => {
    const onPress = mock(() => {});
    const onMarkRead = mock(() => {});
    const onDismiss = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<NotificationItem notification={notification} onPress={onPress} onMarkRead={onMarkRead} onDismiss={onDismiss} />); });
    const buttons = () => tree!.root.findAllByType('Pressable');
    expect(buttons()[0].props.accessibilityLabel).toContain('notifications:unreadState');
    expect(buttons()[0].props.accessibilityLabel).toContain('notifications:states.generic');
    await act(async () => { buttons()[0].props.onPress(); });
    expect(onPress).toHaveBeenCalledWith(notification);
    expect(onMarkRead).not.toHaveBeenCalled();
    await act(async () => { buttons()[1].props.onPress(); });
    expect(onMarkRead).toHaveBeenCalledWith('n');
    await act(async () => { buttons()[2].props.onPress(); });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(tree!.root.findByType('ConfirmDialog').props.visible).toBe(true);
    await act(async () => { await tree!.root.findByType('ConfirmDialog').props.onConfirm(); });
    expect(onDismiss).toHaveBeenCalledWith('n');
    expect(tree!.root.findByType('ConfirmDialog').props.visible).toBe(false);
    await act(async () => { tree!.update(<NotificationItem notification={{ ...notification, read: true }} onPress={onPress} onMarkRead={onMarkRead} onDismiss={onDismiss} />); });
    expect(buttons()[0].props.accessibilityLabel).toContain('notifications:readState');
    expect(buttons()).toHaveLength(2);
  });
}
