import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mock
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_PROFILE_ACTION_BUTTON_MOUNT_CHILD !== '1') {
  test('mounts ProfileActionButton in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_PROFILE_ACTION_BUTTON_MOUNT_CHILD: '1' },
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

  // Like React Native's Pressability, a disabled touchable declines the touch.
  const TouchableOpacity = ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(
      'TouchableOpacity',
      { ...props, onStartShouldSetResponder: () => !props.disabled },
      children,
    );

  mock.module('react-native', () => ({
    TouchableOpacity,
    ActivityIndicator: host('ActivityIndicator'),
    StyleSheet: { flatten: (style: unknown) => style },
  }));
  mock.module('@react-native-vector-icons/material-design-icons', () => ({
    default: host('Icon'),
  }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({ colors: { primary: 'blue' } }),
  }));
  mock.module('@/shared/ui/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));

  const { fireEvent, render } = await import('@testing-library/react-native');
  const { ProfileActionButton } = await import('./profile-action-button');

  type View = Awaited<ReturnType<typeof render>>;
  const byType = (view: View, type: string) =>
    view.container.queryAll((node) => node.type === type);

  test('without loading it shows the icon and forwards the press', async () => {
    const onPress = mock(() => {});
    const view = await render(
      <ProfileActionButton label="Orders" icon="package" onPress={onPress} />,
    );

    expect(byType(view, 'Icon')).toHaveLength(1);
    expect(byType(view, 'ActivityIndicator')).toHaveLength(0);
    const button = byType(view, 'TouchableOpacity')[0];
    expect(button.props.disabled).toBeFalsy();
    expect(button.props.accessibilityState).toBeUndefined();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('while loading it shows a primary spinner instead of the icon and ignores presses', async () => {
    const onPress = mock(() => {});
    const view = await render(
      <ProfileActionButton
        label="Payment methods"
        icon="credit-card"
        onPress={onPress}
        loading
      />,
    );

    expect(byType(view, 'Icon')).toHaveLength(0);
    const spinner = byType(view, 'ActivityIndicator');
    expect(spinner).toHaveLength(1);
    expect(spinner[0].props.color).toBe('blue');
    const button = byType(view, 'TouchableOpacity')[0];
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(
      byType(view, 'Text').some(
        (node) => node.props.children === 'Payment methods',
      ),
    ).toBe(true);
  });
}
