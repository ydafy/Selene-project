import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';

// Bun shares its module registry across suite files; a child isolates the RN mocks
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_IMAGE_VIEWER_MOUNT_CHILD !== '1') {
  test('mounts the image viewer in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_IMAGE_VIEWER_MOUNT_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const host =
    (name: string) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);

  mock.module('react-native', () => ({
    Modal: host('Modal'),
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  }));
  mock.module('react-native-gesture-handler', () => ({
    GestureHandlerRootView: host('GestureHandlerRootView'),
  }));
  mock.module('react-native-safe-area-context', () => ({
    SafeAreaView: host('SafeAreaView'),
  }));
  mock.module('react-native-zoom-toolkit', () => ({
    Gallery: host('Gallery'),
    fitContainer: (aspectRatio: number, container: { width: number }) => ({
      width: container.width,
      height: container.width / aspectRatio,
    }),
  }));
  mock.module('expo-image', () => ({ Image: host('ExpoImage') }));
  mock.module('@expo/vector-icons', () => ({ MaterialCommunityIcons: host('Icon') }));
  mock.module('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
      t: (key: string, values?: Record<string, number>) =>
        `${namespace}:${key}${values ? ':' + JSON.stringify(values) : ''}`,
    }),
  }));
  mock.module('../../base', () => ({ Box: host('Box'), Text: host('Text') }));
  mock.module('@/core/theme/tokens', () => ({
    colors: { mediaBackground: '#000000', textPrimary: '#E4E4E4' },
  }));

  const { AppImageViewer } = await import('../AppImageViewer');
  const images = [{ uri: 'a.jpg' }, { uri: 'b.jpg' }, 42];

  type Node = { props: Record<string, unknown> & { children?: unknown } };
  const counterText = (tree: ReturnType<typeof create>) =>
    tree.root
      .findAllByType('Text')
      .map((node: Node) => [node.props.children].flat().join(''))
      .join('|');

  test('shows the gallery at the requested image with a counter', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <AppImageViewer images={images} initialIndex={1} visible onClose={() => {}} />,
      );
    });
    const modal = tree!.root.findByType('Modal');
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe('fade');
    const gallery = tree!.root.findByType('Gallery');
    expect(gallery.props.data).toEqual(images);
    expect(gallery.props.initialIndex).toBe(1);
    expect(counterText(tree!)).toBe('2 / 3');
    const counter = tree!.root
      .findAllByType('Box')
      .find((node: Node) => node.props.accessibilityLabel !== undefined);
    expect(counter!.props.accessibilityLabel).toBe(
      'common:imageViewer.counterLabel:{"current":2,"total":3}',
    );
  });

  test('updates the counter when the user swipes to another image', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AppImageViewer images={images} visible onClose={() => {}} />);
    });
    expect(counterText(tree!)).toBe('1 / 3');
    await act(async () => {
      (tree!.root.findByType('Gallery').props.onIndexChange as (i: number) => void)(2);
    });
    expect(counterText(tree!)).toBe('3 / 3');
  });

  test('closes from the close button and from a vertical swipe only', async () => {
    const onClose = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AppImageViewer images={images} visible onClose={onClose} />);
    });
    const close = tree!.root.findByType('Pressable');
    expect(close.props.accessibilityRole).toBe('button');
    expect(close.props.accessibilityLabel).toBe('common:imageViewer.close');
    await act(async () => {
      (close.props.onPress as () => void)();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    const onSwipe = tree!.root.findByType('Gallery').props.onSwipe as (d: string) => void;
    await act(async () => {
      onSwipe('left');
      onSwipe('right');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      onSwipe('down');
      onSwipe('up');
    });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(tree!.root.findByType('Modal').props.onRequestClose).toBe(onClose);
  });

  test('uses the labels and footer text the screen passes in', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <AppImageViewer
          images={images}
          visible
          onClose={() => {}}
          closeAccessibilityLabel="Cerrar"
          counterAccessibilityLabel={({ current, total }) => `Imagen ${current} de ${total}`}
          footerText={({ current, total }) => `Paso ${current} de ${total}`}
        />,
      );
    });
    expect(tree!.root.findByType('Pressable').props.accessibilityLabel).toBe('Cerrar');
    expect(counterText(tree!)).toBe('Paso 1 de 3');
    const counter = tree!.root
      .findAllByType('Box')
      .find((node: Node) => node.props.accessibilityLabel !== undefined);
    expect(counter!.props.accessibilityLabel).toBe('Imagen 1 de 3');
  });

  test('renders each image with expo-image, fitted to the screen once it loads', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AppImageViewer images={images} visible onClose={() => {}} />);
    });
    const renderItem = tree!.root.findByType('Gallery').props.renderItem as (
      item: unknown,
      index: number,
    ) => React.ReactElement;
    let item: ReturnType<typeof create>;
    await act(async () => {
      item = create(renderItem({ uri: 'a.jpg' }, 0));
    });
    const image = item!.root.findByType('ExpoImage');
    expect(image.props.source).toEqual({ uri: 'a.jpg' });
    await act(async () => {
      (image.props.onLoad as (e: { source: { width: number; height: number } }) => void)({
        source: { width: 2000, height: 1000 },
      });
    });
    expect(item!.root.findByType('ExpoImage').props.style).toEqual({ width: 400, height: 200 });
  });

  test('renders nothing without images', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AppImageViewer images={[]} visible onClose={() => {}} />);
    });
    expect(tree!.toJSON()).toBeNull();
  });
}
