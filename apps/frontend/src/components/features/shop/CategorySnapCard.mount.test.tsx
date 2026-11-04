import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mocks
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_CATEGORY_SNAP_MOUNT_CHILD !== '1') {
  test('mounts the category snap card in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_CATEGORY_SNAP_MOUNT_CHILD: '1' },
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

  const absoluteFill = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  // No ImageBackground here: SDK 58 deprecates it, so the card must not use it.
  mock.module('react-native', () => ({
    // Like the real Pressable, the host is accessible unless told otherwise.
    Pressable: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        'Pressable',
        { accessible: true, ...props },
        children,
      ),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      absoluteFill,
    },
  }));
  mock.module('expo-image', () => ({ Image: host('ExpoImage') }));
  mock.module('expo-linear-gradient', () => ({
    LinearGradient: host('LinearGradient'),
  }));
  mock.module('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
  }));
  const push = mock(() => undefined);
  mock.module('expo-router', () => ({ useRouter: () => ({ push }) }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({
      colors: {
        primary: 'primary',
        separator: 'separator',
        glassSurface: 'glassSurface',
        scrimLight: 'scrimLight',
        scrimStrong: 'scrimStrong',
      },
    }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
      t: (key: string) => `${namespace}:${key}`,
    }),
  }));
  mock.module('../../../shared/ui/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));

  const { render, fireEvent } = await import('@testing-library/react-native');
  const { CategorySnapCard } = await import('./CategorySnapCard');

  test('draws each category image with expo-image behind its gradient and label', async () => {
    const view = await render(<CategorySnapCard visibleHeight={800} />);

    const cards = view.container.queryAll((node) => node.type === 'Pressable');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      const [image, gradient, label] = card.children.filter(
        (child) => typeof child !== 'string',
      );
      expect(image.type).toBe('ExpoImage');
      // A sibling behind the content, not a wrapper like ImageBackground.
      expect(image.props.children).toBeUndefined();
      expect(image.props.source).toBeTruthy();
      expect(image.props.contentFit).toBe('cover');
      expect(image.props.style).toEqual(absoluteFill);
      expect(gradient.type).toBe('LinearGradient');
      expect(label.type).toBe('Box');
    }
    const labels = view.container
      .queryAll((node) => node.type === 'Text')
      .map((node) => node.props.children);
    expect(labels).toEqual([
      'search:categoriesList.GPU',
      'search:categoriesList.CPU',
      'search:categoriesList.RAM',
      'search:categoriesList.MOTHERBOARD',
    ]);

    await fireEvent.press(cards[3]);
    expect(push).toHaveBeenCalledWith({
      pathname: '/store/showroom/[id]',
      params: { id: 'MOBO' },
    });
  });
}
