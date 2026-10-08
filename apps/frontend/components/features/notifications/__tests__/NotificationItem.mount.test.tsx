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
  const notification: Notification = { id: 'n', user_id: 'u', created_at: '2026-01-01', deleted_at: null, title: 'Title', message: 'Message', type: 'error', read: false, action_path: null, event_kind: null, source_event_key: null, event_payload: {} };

  test('mounted item keeps one accessible tap without per-card controls', async () => {
    const onPress = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<NotificationItem notification={notification} onPress={onPress} />); });
    const buttons = () => tree!.root.findAllByType('Pressable');
    expect(buttons()[0].props.accessibilityLabel).toContain('notifications:unreadState');
    expect(buttons()[0].props.accessibilityLabel).toContain('notifications:states.generic');
    await act(async () => { buttons()[0].props.onPress(); });
    expect(onPress).toHaveBeenCalledWith(notification);
    expect(buttons()).toHaveLength(1);
    expect(tree!.root.findAllByType('ConfirmDialog')).toHaveLength(0);
    await act(async () => { tree!.update(<NotificationItem notification={{ ...notification, read: true }} onPress={onPress} />); });
    expect(buttons()[0].props.accessibilityLabel).toContain('notifications:readState');
    expect(buttons()).toHaveLength(1);
    for (const kind of ['product.approved_with_note', 'product.rejected', 'product.approved', 'dispute.verdict']) {
      const typed = { ...notification, event_kind: kind, source_event_key: `${kind}:audit`, event_payload: { recipient_role: 'seller' } };
      await act(async () => { tree!.update(<NotificationItem notification={typed} onPress={onPress} />); });
      const message = tree!.root.findAllByType('Text').find((node: { props: { children: unknown } }) => node.props.children === notification.message);
      expect(message!.props.fontStyle).toBe(kind === 'product.approved_with_note' || kind === 'product.rejected' ? 'italic' : 'normal');
    }
    await act(async () => { tree!.update(<NotificationItem notification={{ ...notification, event_kind: 'product.rejected', source_event_key: 'invalid' }} onPress={onPress} />); });
    const message = tree!.root.findAllByType('Text').find((node: { props: { children: unknown } }) => node.props.children === notification.message);
    expect(message!.props.fontStyle).toBe('normal');
  });
}
