import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local declarations.
import { act, create } from 'react-test-renderer';

if (process.env.SELENE_EVIDENCE_CHILD !== '1') {
  test('mounted evidence controls in an isolated process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_EVIDENCE_CHILD: '1' },
      stdout: 'pipe', stderr: 'pipe',
    });
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = (name: string) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => { resolve = yes; });
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
  const impactAsync = mock(async () => { throw new Error('haptic unavailable'); });
  mock.module('react-native', () => ({ TouchableOpacity: host('TouchableOpacity'), ActivityIndicator: host('ActivityIndicator') }));
  mock.module('@expo/vector-icons', () => ({ MaterialCommunityIcons: host('Icon') }));
  mock.module('@shopify/restyle', () => ({ useTheme: () => ({ colors: {}, borderRadii: {} }) }));
  mock.module('expo-haptics', () => ({ impactAsync, ImpactFeedbackStyle: { Medium: 'medium' } }));
  mock.module('../../components/base', () => ({ Box: host('Box'), Text: host('Text') }));
  mock.module('../../components/ui/AppImage', () => ({ AppImage: host('AppImage') }));
  mock.module('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: host('ConfirmDialog') }));
  mock.module('../../core/hooks/useImageUpload', () => ({ useImageUpload: () => ({ takePhoto, uploadFile, uploading: false }) }));
  for (const image of ['paso-1-caja', 'paso-2-proteccion', 'paso-3-relleno', 'paso-4-sellado', 'paso-5-etiqueta'])
    mock.module(`../../assets/images/packaging/${image}.webp`, () => ({ default: 1 }));
  mock.module('../../components/ui/Skeleton', () => ({ Skeleton: host('Skeleton') }));
  const { EvidenceUploadSection } = await import('../../components/features/orders/EvidenceUploadSection');
  const { AddressSection } = await import('../../components/features/checkout/AddressSection');
  const { PackagingGuideCard } = await import('../../components/features/orders/PackagingGuideCard');
  const { LabelWithHelp } = await import('../../components/ui/LabelWithHelp');

  test('shared address, help and packing controls retain enabled defaults and reject disabled callbacks', async () => {
    const onPress = mock(() => {});
    const addressProps = { address: null, onPress, showError: false, label: 'origin', placeholder: 'select' };
    const helpProps = { label: 'why', helpTitle: 'help', helpDescription: 'description' };
    const packingProps = { title: 'pack', steps: [{ title: 'step', hint: 'hint', icon: 'camera' as const }], where: { title: 'where', icon: 'camera' as const, items: ['material'], cta: 'find' }, consequence: 'safe' };
    let tree: ReturnType<typeof create>;
    let locked = false;
    const canInteract = () => !locked;
    const render = (disabled?: boolean) => <><AddressSection {...addressProps} disabled={disabled} /><LabelWithHelp {...helpProps} disabled={disabled} canInteract={canInteract} /><PackagingGuideCard {...packingProps} disabled={disabled} canInteract={canInteract} /></>;
    await act(async () => { tree = create(render()); });
    locked = true;
    await act(async () => { tree.root.findAllByType('TouchableOpacity')[1].props.onPress(); });
    expect(tree.root.findByType('ConfirmDialog').props.visible).toBe(false);
    locked = false;
    await act(async () => {
      const buttons = tree.root.findAllByType('TouchableOpacity');
      buttons[0].props.onPress(); buttons[1].props.onPress(); buttons[3].props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType('ConfirmDialog').props.visible).toBe(true);
    expect(tree.root.findAllByType('TouchableOpacity')[3].props.accessibilityState.expanded).toBe(true);
    const stale = tree.root.findAllByType('TouchableOpacity').map((button: { props: { onPress: () => void } }) => button.props.onPress);
    locked = true;
    await act(async () => { stale[3](); });
    expect(tree.root.findAllByType('TouchableOpacity')[3].props.accessibilityState.expanded).toBe(true);
    await act(async () => { tree.update(render(true)); });
    await act(async () => { stale.forEach((press: () => void) => press()); });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType('ConfirmDialog').props.visible).toBe(false);
    for (const button of tree.root.findAllByType('TouchableOpacity')) expect(button.props.disabled).toBe(true);
    expect(tree.root.findAllByType('TouchableOpacity')[3].props.accessibilityState.expanded).toBe(true);
    locked = false;
    await act(async () => { tree.update(render(false)); });
    expect(tree.root.findByType('ConfirmDialog').props.visible).toBe(false);
    await act(async () => { tree.unmount(); });
  });

  test('default capture remains enabled; busy excludes duplicate callbacks and haptics cannot lose a photo', async () => {
    const complete = mock(() => {});
    const busy = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<EvidenceUploadSection orderId="order" userId="seller" onEvidenceComplete={complete} onBusyChange={busy} />); });
    const press = tree.root.findAllByType('TouchableOpacity')[0].props.onPress;
    let pending!: Promise<void>;
    await act(async () => { pending = press(); void press(); });
    expect(takePhoto).toHaveBeenCalledTimes(1);
    expect(busy.mock.calls).toEqual([[true]]);
    await act(async () => { camera.resolve({ base64: 'photo' }); await pending; });
    expect(complete.mock.calls).toEqual([['saved-photo']].map((url) => [url]));
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(tree.root.findAllByType('AppImage')[0].props.source.uri).toBe('saved-photo');
    await act(async () => { tree.unmount(); });
  });

  test('camera and replacement-upload failures preserve saved photos, report fixed diagnostics and unlock', async () => {
    camera = deferred();
    camera.resolve({ base64: 'photo' });
    const complete = mock(() => {});
    const failure = mock(() => {});
    const busy = mock(() => {});
    const warning = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warning;
    let tree: ReturnType<typeof create>;
    try {
      await act(async () => { tree = create(<EvidenceUploadSection orderId="order" userId="seller" onEvidenceComplete={complete} onBusyChange={busy} onFailure={failure} />); });
      const press = () => tree.root.findAllByType('TouchableOpacity')[0].props.onPress();
      await act(async () => { await press(); });
      expect(complete).toHaveBeenCalledTimes(1);
      cameraFails = true;
      await act(async () => { await press(); });
      cameraFails = false;
      uploadFails = true;
      await act(async () => { await press(); });
      uploadFails = false;
      expect(failure).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(tree.root.findAllByType('AppImage')[0].props.source.uri).toBe('saved-photo');
      expect(tree.root.findAllByType('TouchableOpacity')[0].props.disabled).toBe(false);
      expect(busy.mock.calls).toEqual([[true], [false], [true], [false], [true], [false]]);
      expect(warning.mock.calls).toEqual([
        ['[EVIDENCE_UPLOAD]', { event: 'capture_or_upload_failed' }],
        ['[EVIDENCE_UPLOAD]', { event: 'capture_or_upload_failed' }],
      ]);
      camera = deferred(); camera.resolve(null);
      await act(async () => { await press(); });
      expect(failure).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      cameraFails = false; uploadFails = false;
      await act(async () => { tree?.unmount(); });
      console.warn = originalWarn;
    }
  });

  test('late upload completion does not notify an unmounted form', async () => {
    camera = deferred(); camera.resolve({ base64: 'photo' });
    delayedUpload = deferred();
    const complete = mock(() => {});
    const busy = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<EvidenceUploadSection orderId="old" userId="seller" onEvidenceComplete={complete} onBusyChange={busy} />); });
    let pending!: Promise<void>;
    await act(async () => { pending = tree.root.findAllByType('TouchableOpacity')[0].props.onPress(); });
    await act(async () => { tree.unmount(); });
    await act(async () => { delayedUpload!.resolve('late-upload'); await pending; });
    expect(complete).not.toHaveBeenCalled();
    expect(busy.mock.calls).toEqual([[true]]);
    delayedUpload = null;
  });

  test('disabled stale portal callback cannot open the camera', async () => {
    const complete = mock(() => {});
    let tree: ReturnType<typeof create>;
    const props = { orderId: 'order', userId: 'seller', onEvidenceComplete: complete, slotsConfig: [{ label: 'photo', icon: 'camera', description: 'intro' }] };
    await act(async () => { tree = create(<EvidenceUploadSection {...props} />); });
    await act(async () => { await tree.root.findAllByType('TouchableOpacity')[0].props.onPress(); });
    const confirm = tree.root.findByType('ConfirmDialog').props.onConfirm;
    await act(async () => { tree.update(<EvidenceUploadSection {...props} disabled />); });
    const count = takePhoto.mock.calls.length;
    await act(async () => { await confirm(); await tree.root.findAllByType('TouchableOpacity')[0].props.onPress(); });
    expect(takePhoto).toHaveBeenCalledTimes(count);
    expect(complete).not.toHaveBeenCalled();
    expect(tree.root.findAllByType('TouchableOpacity')[0].props.disabled).toBe(true);
    await act(async () => { tree.update(<EvidenceUploadSection {...props} />); });
    expect(tree.root.findAllByType('ConfirmDialog')).toHaveLength(0);
    await act(async () => { tree.unmount(); });
  });

  test('a synchronous parent capture gate excludes camera side effects before rerender', async () => {
    let blocked = false;
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<EvidenceUploadSection orderId="order" userId="seller" onEvidenceComplete={() => {}} canCapture={() => !blocked} />); });
    const count = takePhoto.mock.calls.length;
    blocked = true;
    await act(async () => { await tree.root.findAllByType('TouchableOpacity')[0].props.onPress(); });
    expect(takePhoto).toHaveBeenCalledTimes(count);
    await act(async () => { tree.unmount(); });
  });

  test('blocked retained portal confirmation leaves the intro and photos unchanged', async () => {
    let blocked = false;
    const complete = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<EvidenceUploadSection orderId="order" userId="seller" onEvidenceComplete={complete} canCapture={() => !blocked} slotsConfig={[{ label: 'photo', icon: 'camera', description: 'intro' }]} />);
    });
    await act(async () => { await tree.root.findAllByType('TouchableOpacity')[0].props.onPress(); });
    const confirm = tree.root.findByType('ConfirmDialog').props.onConfirm;
    const count = takePhoto.mock.calls.length;
    blocked = true;
    await act(async () => { confirm(); });
    expect(tree.root.findByType('ConfirmDialog').props.visible).toBe(true);
    expect(takePhoto).toHaveBeenCalledTimes(count);
    expect(complete).not.toHaveBeenCalled();
    expect(tree.root.findAllByType('AppImage')).toHaveLength(0);
    await act(async () => { tree.unmount(); });
  });

  test('unmounted camera completion cannot upload or populate a new form', async () => {
    camera = deferred();
    const complete = mock(() => {});
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(<EvidenceUploadSection orderId="old" userId="seller" onEvidenceComplete={complete} />); });
    let pending!: Promise<void>;
    await act(async () => { pending = tree.root.findAllByType('TouchableOpacity')[0].props.onPress(); });
    await act(async () => { tree.unmount(); });
    const count = uploadFile.mock.calls.length;
    await act(async () => { camera.resolve({ base64: 'late' }); await pending; });
    expect(uploadFile).toHaveBeenCalledTimes(count);
    expect(complete).not.toHaveBeenCalled();
  });
}
