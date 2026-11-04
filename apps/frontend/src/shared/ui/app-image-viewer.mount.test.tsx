import { expect, mock, test } from 'bun:test';
import React from 'react';

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
    Modal: host('Modal'),
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
      absoluteFill: {},
    },
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
  mock.module('@react-native-vector-icons/material-design-icons', () => ({
    default: host('Icon'),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
      t: (key: string, values?: Record<string, number>) =>
        `${namespace}:${key}${values ? ':' + JSON.stringify(values) : ''}`,
    }),
  }));
  mock.module('./base', () => ({ Box: host('Box'), Text: host('Text') }));
  mock.module('@/shared/theme/tokens', () => ({
    colors: { mediaBackground: '#000000', textPrimary: '#E4E4E4' },
  }));

  const { act, fireEvent, render } =
    await import('@testing-library/react-native');
  const { AppImageViewer } = await import('./app-image-viewer');
  const images = [{ uri: 'a.jpg' }, { uri: 'b.jpg' }, 42];

  const noop = () => {};
  const counterText = (view: Awaited<ReturnType<typeof render>>) =>
    view.container
      .queryAll((node) => node.type === 'Text')
      .map((node) => [node.props.children].flat().join(''))
      .join('|');
  const gallery = (view: Awaited<ReturnType<typeof render>>) =>
    view.container.queryAll((node) => node.type === 'Gallery')[0];

  test('shows the gallery at the requested image with a counter', async () => {
    const view = await render(
      <AppImageViewer
        images={images}
        initialIndex={1}
        visible
        onClose={noop}
      />,
    );
    const modal = view.container.queryAll((node) => node.type === 'Modal')[0];
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe('fade');
    expect(gallery(view).props.data).toEqual(images);
    expect(gallery(view).props.initialIndex).toBe(1);
    expect(counterText(view)).toBe('2 / 3');
    expect(
      view.getByLabelText(
        'common:imageViewer.counterLabel:{"current":2,"total":3}',
      ),
    ).toBeTruthy();
  });

  test('updates the counter when the user swipes to another image', async () => {
    const view = await render(
      <AppImageViewer images={images} visible onClose={noop} />,
    );
    expect(counterText(view)).toBe('1 / 3');
    await act(async () => {
      (gallery(view).props.onIndexChange as (i: number) => void)(2);
    });
    expect(counterText(view)).toBe('3 / 3');
  });

  test('closes from the close button and from a vertical swipe only', async () => {
    const onClose = mock(() => {});
    const view = await render(
      <AppImageViewer images={images} visible onClose={onClose} />,
    );
    await fireEvent.press(
      view.getByRole('button', { name: 'common:imageViewer.close' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    const onSwipe = gallery(view).props.onSwipe as (d: string) => void;
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
    expect(
      view.container.queryAll((node) => node.type === 'Modal')[0].props
        .onRequestClose,
    ).toBe(onClose);
  });

  test('uses the labels and footer text the screen passes in', async () => {
    const view = await render(
      <AppImageViewer
        images={images}
        visible
        onClose={noop}
        closeAccessibilityLabel="Cerrar"
        counterAccessibilityLabel={({ current, total }) =>
          `Imagen ${current} de ${total}`
        }
        footerText={({ current, total }) => `Paso ${current} de ${total}`}
      />,
    );
    expect(view.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
    expect(counterText(view)).toBe('Paso 1 de 3');
    expect(view.getByLabelText('Imagen 1 de 3')).toBeTruthy();
  });

  test('renders each image with expo-image, fitted to the screen once it loads', async () => {
    const view = await render(
      <AppImageViewer images={images} visible onClose={noop} />,
    );
    const renderItem = gallery(view).props.renderItem as (
      item: unknown,
      index: number,
    ) => React.ReactElement;
    const item = await render(renderItem({ uri: 'a.jpg' }, 0));
    const image = () =>
      item.container.queryAll((node) => node.type === 'ExpoImage')[0];
    expect(image().props.source).toEqual({ uri: 'a.jpg' });
    await act(async () => {
      (
        image().props.onLoad as (e: {
          source: { width: number; height: number };
        }) => void
      )({
        source: { width: 2000, height: 1000 },
      });
    });
    expect(image().props.style).toEqual({ width: 400, height: 200 });
  });

  test('renders nothing without images', async () => {
    const view = await render(
      <AppImageViewer images={[]} visible onClose={noop} />,
    );
    expect(view.toJSON()).toBeNull();
  });
}
