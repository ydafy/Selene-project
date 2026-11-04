import { expect, mock, test } from 'bun:test';
import React from 'react';

if (process.env.SELENE_EVIDENCE_CHILD !== '1') {
  test('mounted evidence controls in an isolated process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_EVIDENCE_CHILD: '1' },
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
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
      resolve = yes;
    });
    return { promise, resolve };
  };
  let camera = deferred<{ base64: string } | null>();
  let cameraFails = false;
  let uploadFails = false;
  let delayedUpload: ReturnType<typeof deferred<string>> | null = null;
  const takePhoto = mock(() => {
    if (cameraFails) return Promise.reject(new Error('private camera details'));
    return camera.promise;
  });
  const uploadFile = mock(async () => {
    if (uploadFails) throw new Error('private storage details');
    return delayedUpload ? delayedUpload.promise : 'saved-photo';
  });
  const impactAsync = mock(async () => {
    throw new Error('haptic unavailable');
  });
  mock.module('react-native', () => ({
    StyleSheet: { flatten: (style: unknown) => style },
    // Like the real touchable, the host is accessible unless told otherwise.
    TouchableOpacity: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        'TouchableOpacity',
        { accessible: true, ...props },
        children,
      ),
    ActivityIndicator: host('ActivityIndicator'),
  }));
  mock.module('@react-native-vector-icons/material-design-icons', () => ({
    default: host('Icon'),
  }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({ colors: {}, borderRadii: {} }),
  }));
  mock.module('expo-haptics', () => ({
    impactAsync,
    ImpactFeedbackStyle: { Medium: 'medium' },
  }));
  mock.module('../../src/shared/ui/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));
  mock.module('../../src/shared/ui/app-image', () => ({
    AppImage: host('AppImage'),
  }));
  mock.module('../../src/shared/ui/confirm-dialog', () => ({
    ConfirmDialog: host('ConfirmDialog'),
  }));
  mock.module('../../src/core/hooks/useImageUpload', () => ({
    useImageUpload: () => ({ takePhoto, uploadFile, uploading: false }),
  }));
  for (const image of [
    'paso-1-caja',
    'paso-2-proteccion',
    'paso-3-relleno',
    'paso-4-sellado',
    'paso-5-etiqueta',
  ])
    mock.module(`../../assets/images/packaging/${image}.webp`, () => ({
      default: 1,
    }));
  mock.module('../../src/shared/ui/skeleton', () => ({
    Skeleton: host('Skeleton'),
  }));
  const { act, fireEvent, render } =
    await import('@testing-library/react-native');
  type View = Awaited<ReturnType<typeof render>>;
  const all = (view: View, type: string) =>
    view.container.queryAll((node) => node.type === type);
  const one = (view: View, type: string) => {
    const found = all(view, type);
    expect(found).toHaveLength(1);
    return found[0];
  };
  const { EvidenceUploadSection } =
    await import('../../src/components/features/orders/EvidenceUploadSection');
  const { AddressSection } =
    await import('../../src/components/features/checkout/AddressSection');
  const { PackagingGuideCard } =
    await import('../../src/components/features/orders/PackagingGuideCard');
  const { LabelWithHelp } = await import('../../src/shared/ui/label-with-help');

  test('shared address, help and packing controls retain enabled defaults and reject disabled callbacks', async () => {
    const onPress = mock(() => {});
    const addressProps = {
      address: null,
      onPress,
      showError: false,
      label: 'origin',
      placeholder: 'select',
    };
    const helpProps = {
      label: 'why',
      helpTitle: 'help',
      helpDescription: 'description',
    };
    const packingProps = {
      title: 'pack',
      steps: [{ title: 'step', hint: 'hint', icon: 'camera' as const }],
      where: {
        title: 'where',
        icon: 'camera' as const,
        items: ['material'],
        cta: 'find',
      },
      consequence: 'safe',
    };
    let tree: View;
    let locked = false;
    const canInteract = () => !locked;
    const controls = (disabled?: boolean) => (
      <>
        <AddressSection {...addressProps} disabled={disabled} />
        <LabelWithHelp
          {...helpProps}
          disabled={disabled}
          canInteract={canInteract}
        />
        <PackagingGuideCard
          {...packingProps}
          disabled={disabled}
          canInteract={canInteract}
        />
      </>
    );
    tree = await render(controls());
    locked = true;
    await fireEvent.press(all(tree, 'TouchableOpacity')[1]);
    expect(one(tree, 'ConfirmDialog').props.visible).toBe(false);
    locked = false;
    const buttons = all(tree, 'TouchableOpacity');
    await act(async () => {
      await fireEvent.press(buttons[0]);
      await fireEvent.press(buttons[1]);
      await fireEvent.press(buttons[3]);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(one(tree, 'ConfirmDialog').props.visible).toBe(true);
    expect(
      all(tree, 'TouchableOpacity')[3].props.accessibilityState.expanded,
    ).toBe(true);
    const stale = all(tree, 'TouchableOpacity').map(
      (button) => button.props.onPress as () => void,
    );
    locked = true;
    await act(async () => {
      stale[3]();
    });
    expect(
      all(tree, 'TouchableOpacity')[3].props.accessibilityState.expanded,
    ).toBe(true);
    await tree.rerender(controls(true));
    await act(async () => {
      stale.forEach((press: () => void) => press());
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(one(tree, 'ConfirmDialog').props.visible).toBe(false);
    for (const button of all(tree, 'TouchableOpacity'))
      expect(button.props.disabled).toBe(true);
    expect(
      all(tree, 'TouchableOpacity')[3].props.accessibilityState.expanded,
    ).toBe(true);
    locked = false;
    await tree.rerender(controls(false));
    expect(one(tree, 'ConfirmDialog').props.visible).toBe(false);
    await tree?.unmount();
  });

  test('default capture remains enabled; busy excludes duplicate callbacks and haptics cannot lose a photo', async () => {
    const complete = mock<(...args: unknown[]) => void>(() => {});
    const busy = mock<(...args: unknown[]) => void>(() => {});
    let tree: View;
    tree = await render(
      <EvidenceUploadSection
        orderId="order"
        userId="seller"
        onEvidenceComplete={complete}
        onBusyChange={busy}
      />,
    );
    const press = all(tree, 'TouchableOpacity')[0].props.onPress;
    let pending!: Promise<void>;
    await act(async () => {
      pending = press();
      void press();
    });
    expect(takePhoto).toHaveBeenCalledTimes(1);
    expect(busy.mock.calls).toEqual([[true]]);
    await act(async () => {
      camera.resolve({ base64: 'photo' });
      await pending;
    });
    expect(complete.mock.calls).toEqual([['saved-photo']].map((url) => [url]));
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(all(tree, 'AppImage')[0].props.source.uri).toBe('saved-photo');
    await tree?.unmount();
  });

  test('camera and replacement-upload failures preserve saved photos, report fixed diagnostics and unlock', async () => {
    camera = deferred();
    camera.resolve({ base64: 'photo' });
    const complete = mock<(...args: unknown[]) => void>(() => {});
    const failure = mock(() => {});
    const busy = mock<(...args: unknown[]) => void>(() => {});
    const warning = mock<(...args: unknown[]) => void>(() => {});
    const originalWarn = console.warn;
    console.warn = warning;
    let tree: View | undefined;
    try {
      tree = await render(
        <EvidenceUploadSection
          orderId="order"
          userId="seller"
          onEvidenceComplete={complete}
          onBusyChange={busy}
          onFailure={failure}
        />,
      );
      const press = () => all(tree!, 'TouchableOpacity')[0].props.onPress();
      await act(async () => {
        await press();
      });
      expect(complete).toHaveBeenCalledTimes(1);
      cameraFails = true;
      await act(async () => {
        await press();
      });
      cameraFails = false;
      uploadFails = true;
      await act(async () => {
        await press();
      });
      uploadFails = false;
      expect(failure).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(all(tree!, 'AppImage')[0].props.source.uri).toBe('saved-photo');
      expect(all(tree!, 'TouchableOpacity')[0].props.disabled).toBe(false);
      expect(busy.mock.calls).toEqual([
        [true],
        [false],
        [true],
        [false],
        [true],
        [false],
      ]);
      expect(warning.mock.calls).toEqual([
        [
          '[EVIDENCE_UPLOAD]',
          {
            name: 'Error',
            message: undefined,
            code: undefined,
            status: undefined,
          },
        ],
        [
          '[EVIDENCE_UPLOAD]',
          {
            name: 'Error',
            message: undefined,
            code: undefined,
            status: undefined,
          },
        ],
      ]);
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private');
      camera = deferred();
      camera.resolve(null);
      await act(async () => {
        await press();
      });
      expect(failure).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      cameraFails = false;
      uploadFails = false;
      await tree?.unmount();
      console.warn = originalWarn;
    }
  });

  test('late upload completion does not notify an unmounted form', async () => {
    camera = deferred();
    camera.resolve({ base64: 'photo' });
    delayedUpload = deferred();
    const complete = mock<(...args: unknown[]) => void>(() => {});
    const busy = mock<(...args: unknown[]) => void>(() => {});
    let tree: View;
    tree = await render(
      <EvidenceUploadSection
        orderId="old"
        userId="seller"
        onEvidenceComplete={complete}
        onBusyChange={busy}
      />,
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = all(tree, 'TouchableOpacity')[0].props.onPress();
    });
    await tree?.unmount();
    await act(async () => {
      delayedUpload!.resolve('late-upload');
      await pending;
    });
    expect(complete).not.toHaveBeenCalled();
    expect(busy.mock.calls).toEqual([[true]]);
    delayedUpload = null;
  });

  test('disabled stale portal callback cannot open the camera', async () => {
    const complete = mock<(...args: unknown[]) => void>(() => {});
    let tree: View;
    const props = {
      orderId: 'order',
      userId: 'seller',
      onEvidenceComplete: complete,
      slotsConfig: [{ label: 'photo', icon: 'camera', description: 'intro' }],
    };
    tree = await render(<EvidenceUploadSection {...props} />);
    await act(async () => {
      await all(tree, 'TouchableOpacity')[0].props.onPress();
    });
    const confirm = one(tree, 'ConfirmDialog').props.onConfirm;
    await tree.rerender(<EvidenceUploadSection {...props} disabled />);
    const count = takePhoto.mock.calls.length;
    await act(async () => {
      await confirm();
      await all(tree, 'TouchableOpacity')[0].props.onPress();
    });
    expect(takePhoto).toHaveBeenCalledTimes(count);
    expect(complete).not.toHaveBeenCalled();
    expect(all(tree, 'TouchableOpacity')[0].props.disabled).toBe(true);
    await tree.rerender(<EvidenceUploadSection {...props} />);
    expect(all(tree, 'ConfirmDialog')).toHaveLength(0);
    await tree?.unmount();
  });

  test('a synchronous parent capture gate excludes camera side effects before rerender', async () => {
    let blocked = false;
    let tree: View;
    tree = await render(
      <EvidenceUploadSection
        orderId="order"
        userId="seller"
        onEvidenceComplete={() => {}}
        canCapture={() => !blocked}
      />,
    );
    const count = takePhoto.mock.calls.length;
    blocked = true;
    await act(async () => {
      await all(tree, 'TouchableOpacity')[0].props.onPress();
    });
    expect(takePhoto).toHaveBeenCalledTimes(count);
    await tree?.unmount();
  });

  test('blocked retained portal confirmation leaves the intro and photos unchanged', async () => {
    let blocked = false;
    const complete = mock<(...args: unknown[]) => void>(() => {});
    let tree: View;
    tree = await render(
      <EvidenceUploadSection
        orderId="order"
        userId="seller"
        onEvidenceComplete={complete}
        canCapture={() => !blocked}
        slotsConfig={[{ label: 'photo', icon: 'camera', description: 'intro' }]}
      />,
    );
    await act(async () => {
      await all(tree, 'TouchableOpacity')[0].props.onPress();
    });
    const confirm = one(tree, 'ConfirmDialog').props.onConfirm;
    const count = takePhoto.mock.calls.length;
    blocked = true;
    await act(async () => {
      confirm();
    });
    expect(one(tree, 'ConfirmDialog').props.visible).toBe(true);
    expect(takePhoto).toHaveBeenCalledTimes(count);
    expect(complete).not.toHaveBeenCalled();
    expect(all(tree, 'AppImage')).toHaveLength(0);
    await tree?.unmount();
  });

  test('unmounted camera completion cannot upload or populate a new form', async () => {
    camera = deferred();
    const complete = mock<(...args: unknown[]) => void>(() => {});
    let tree: View;
    tree = await render(
      <EvidenceUploadSection
        orderId="old"
        userId="seller"
        onEvidenceComplete={complete}
      />,
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = all(tree, 'TouchableOpacity')[0].props.onPress();
    });
    await tree?.unmount();
    const count = uploadFile.mock.calls.length;
    await act(async () => {
      camera.resolve({ base64: 'late' });
      await pending;
    });
    expect(uploadFile).toHaveBeenCalledTimes(count);
    expect(complete).not.toHaveBeenCalled();
  });
}
