import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mocks
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_HEART_BUTTON_MOUNT_CHILD !== '1') {
  test('mounts AnimatedHeartButton in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_HEART_BUTTON_MOUNT_CHILD: '1' },
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

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('@/shared/theme/shared-styles', () => ({
    getSharedStyles: () => ({ monoText: {} }),
  }));
  mock.module('@/shared/theme/tokens', () => ({ colors: { shadow: '#000' } }));
  mock.module('react-native-reanimated', () => ({
    default: { View: host('AnimatedView') },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => object) => factory(),
    withTiming: (value: number) => value,
    withSequence: (...values: number[]) => values[0],
    withRepeat: (value: number) => value,
    cancelAnimation: () => {},
    interpolateColor: (_: number, __: number[], colors: string[]) => colors[0],
  }));
  mock.module('react-native-paper', () => ({ IconButton: host('IconButton') }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({
      colors: { primary: '#p', error: '#e', success: '#s' },
      spacing: { s: 8 },
    }),
  }));
  mock.module('@/shared/ui/base', () => ({ Box: host('Box') }));

  const { act, render } = await import('@testing-library/react-native');

  type View = Awaited<ReturnType<typeof render>>;
  const byType = (view: View, type: string) =>
    view.container.queryAll((node) => node.type === type);

  test('AnimatedHeartButton forwards the press and the icon for its state', async () => {
    const { AnimatedHeartButton } = await import('./animated-heart-button');
    const onPress = mock(() => {});
    const view = await render(
      <AnimatedHeartButton isFavorite onPress={onPress} />,
    );
    const button = byType(view, 'IconButton')[0];
    expect(button.props.icon).toBe('heart');
    // IconButton is a bare host stand-in (not accessible), so fireEvent.press
    // cannot reach it; call the handler the component passes.
    await act(async () => (button.props.onPress as () => void)());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
}
