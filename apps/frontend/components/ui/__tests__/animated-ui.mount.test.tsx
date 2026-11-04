import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mocks
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_ANIMATED_UI_MOUNT_CHILD !== '1') {
  test('mounts the animated ui components in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_ANIMATED_UI_MOUNT_CHILD: '1' },
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

  const netInfo: { isConnected: boolean | null } = { isConnected: false };

  class FakeKeyframe {
    duration() {
      return this;
    }
  }

  mock.module('react-native', () => ({
    // Like the real TouchableOpacity, the host is accessible unless told otherwise.
    TouchableOpacity: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        'TouchableOpacity',
        { accessible: true, ...props },
        children,
      ),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('react-native-reanimated', () => ({
    default: { View: host('AnimatedView') },
    Keyframe: FakeKeyframe,
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => object) => factory(),
    withTiming: (value: number) => value,
    withSequence: (...values: number[]) => values[0],
    withRepeat: (value: number) => value,
    cancelAnimation: () => {},
    interpolateColor: (_: number, __: number[], colors: string[]) => colors[0],
  }));
  mock.module('react-native-paper', () => ({ IconButton: host('IconButton') }));
  mock.module('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
  }));
  mock.module('@react-native-community/netinfo', () => ({
    useNetInfo: () => netInfo,
  }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({
      colors: {
        primary: '#p',
        error: '#e',
        success: '#s',
        skeletonShimmer: '#k',
      },
      spacing: { s: 8 },
    }),
  }));
  mock.module('../../base', () => ({ Box: host('Box'), Text: host('Text') }));
  mock.module('../../features/home/sharedStyles', () => ({
    getSharedStyles: () => ({ monoText: {} }),
  }));
  mock.module('@/core/theme/tokens', () => ({ colors: { shadow: '#000' } }));

  const { act, fireEvent, render } =
    await import('@testing-library/react-native');

  type View = Awaited<ReturnType<typeof render>>;
  const byType = (view: View, type: string) =>
    view.container.queryAll((node) => node.type === type);
  const texts = (view: View) =>
    byType(view, 'Text').map((node) => [node.props.children].flat().join(''));

  test('SegmentedControl reports the pressed option and marks the selected one', async () => {
    const { SegmentedControl } = await import('../SegmentedControl');
    const onChange = mock(() => {});
    const view = await render(
      <SegmentedControl
        options={['A', 'B']}
        selectedIndex={1}
        onChange={onChange}
      />,
    );
    const tabs = byType(view, 'TouchableOpacity');
    expect(tabs.map((tab) => tab.props.accessibilityState)).toEqual([
      { selected: false },
      { selected: true },
    ]);
    await fireEvent.press(tabs[0]);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  test('AnimatedHeartButton forwards the press and the icon for its state', async () => {
    const { AnimatedHeartButton } = await import('../AnimatedHeartButton');
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

  test('OfflineNotice shows the offline message and hides when connected', async () => {
    const { OfflineNotice } = await import('../OfflineNotice');
    netInfo.isConnected = false;
    const view = await render(<OfflineNotice />);
    expect(texts(view)).toEqual(['Sin conexión a internet']);
    netInfo.isConnected = true;
    await view.rerender(<OfflineNotice />);
    expect(texts(view)).toEqual(['Conexión restablecida']);
  });

  test('MaintenanceScreen renders the maintenance copy', async () => {
    const { MaintenanceScreen } = await import('../MaintenanceScreen');
    const view = await render(<MaintenanceScreen />);
    expect(texts(view)).toContain('Laboratorio en Optimización');
  });

  test('Skeleton renders a block with the requested size', async () => {
    const { Skeleton } = await import('../Skeleton');
    const view = await render(<Skeleton width={10} height={20} />);
    const style = (
      byType(view, 'AnimatedView')[0].props.style as object[]
    ).flat();
    expect(style).toContainEqual(
      expect.objectContaining({ width: 10, height: 20 }),
    );
  });
}
