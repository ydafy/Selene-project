import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';

if (process.env.SELENE_SUBMIT_CHILD !== '1') {
  test('real preparing handler excludes same-turn submissions in isolation', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_SUBMIT_CHILD: '1' },
      stdout: 'pipe', stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = (name: string) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  let authentication = deferred<{ success: boolean }>();
  let generation = deferred<{ labelUrl: string }>();
  const authenticate = mock(() => authentication.promise);
  const execute = mock(() => generation.promise);
  const shipment = {
    id: 'selected', seller_id: 'seller', status: 'paid',
    label_generation_state: 'unclaimed', label_url: null, tracking_number: null,
    items: [{ product: { name: 'GPU' } }],
  };
  const otherShipment = { ...shipment, id: 'other' };
  let selectedId = shipment.id;
  let orderId = 'order-123';
  let viewer = 'seller';
  let onboarding = true;
  let persistedState = 'unclaimed';
  let persistedLabel: string | null = null;
  const dismiss = mock(() => {});
  const order = { id: 'order-123', shipments: [shipment, otherShipment] };
  const setParams = mock(() => {});
  const push = mock(() => {});
  const refetch = mock(async () => ({ data: order, error: null }));
  const openURL = mock(async () => {});
  const back = mock(() => {});
  const feedback = mock(async () => {});
  mock.module('react-native', () => ({
    ScrollView: host('ScrollView'), TouchableOpacity: host('TouchableOpacity'),
    Linking: { openURL },
  }));
  mock.module('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));
  mock.module('expo-router', () => ({
    Stack: { Screen: host('StackScreen') },
    useLocalSearchParams: () => ({ id: orderId, shipment_id: selectedId }),
    useRouter: () => ({ canGoBack: () => true, back, setParams, push }),
  }));
  mock.module('react-i18next', () => ({ useTranslation: () => ({
    t: (key: string, options?: { returnObjects?: boolean }) =>
      options?.returnObjects ? [] : key,
  }) }));
  mock.module('@gorhom/bottom-sheet', () => ({ BottomSheetModal: host('BottomSheetModal') }));
  mock.module('@expo/vector-icons', () => ({ MaterialCommunityIcons: host('Icon') }));
  mock.module('moti', () => ({ MotiView: host('MotiView') }));
  mock.module('expo-haptics', () => ({ notificationAsync: feedback, NotificationFeedbackType: { Success: 'success' } }));
  mock.module('@shopify/restyle', () => ({ useTheme: () => ({ colors: {} }) }));
  mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
  mock.module('../../components/base', () => ({ Box: host('Box'), Text: host('Text') }));
  for (const [path, name] of [
    ['layout/GlobalHeader', 'GlobalHeader'], ['layout/ScreenHeader', 'ScreenHeader'],
    ['features/checkout/AddressSection', 'AddressSection'],
    ['ui/PrimaryButton', 'PrimaryButton'], ['ui/ConfirmDialog', 'ConfirmDialog'],
    ['ui/ErrorState', 'ErrorState'], ['ui/Skeleton', 'Skeleton'],
    ['ui/LabelWithHelp', 'LabelWithHelp'],
    ['features/orders/PackagingGuideCard', 'PackagingGuideCard'],
    ['features/orders/ShipmentLabelRecoveryCard', 'ShipmentLabelRecoveryCard'],
    ['features/orders/EvidenceUploadSection', 'EvidenceUploadSection'],
  ]) mock.module(`../../components/${path}`, () => ({ [name]: host(name) }));
  mock.module('../../components/features/address/AddressPickerModal', () => ({
    AddressPickerModal: ({ innerRef, ...props }: { innerRef: React.RefObject<unknown> }) => {
      React.useLayoutEffect(() => {
        innerRef.current = { dismiss, present: () => {} };
        return () => { innerRef.current = null; };
      }, [innerRef]);
      return React.createElement('AddressPickerModal', props);
    },
  }));
  mock.module('../../components/auth/AuthProvider', () => ({ useAuthContext: () => ({ session: { user: { id: viewer } } }) }));
  mock.module('../../core/hooks/useOrders', () => ({ useOrderById: () => ({ data: { ...order, id: orderId, shipments: order.shipments.map((item) => ({ ...item, seller_id: viewer, label_generation_state: persistedState, label_url: persistedLabel })) }, isLoading: false, isFetching: false, error: null, refetch }) }));
  mock.module('../../core/hooks/useOrderActions', () => ({ useOrderActions: () => ({ generateLabel: { isLoading: false, execute } }) }));
  mock.module('../../core/hooks/useSystemConfig', () => ({ useSystemConfig: () => ({ data: {} }) }));
  mock.module('../../core/hooks/useConnectOnboarding', () => ({ useConnectOnboarding: () => ({ isComplete: onboarding, isLoading: false }) }));
  mock.module('../../core/hooks/useShipmentLabelRefresh', () => ({ useShipmentLabelRefresh: () => {} }));
  mock.module('../../core/utils/biometrics', () => ({ authenticateAsync: authenticate }));
  for (const image of ['evidencia-1-producto', 'evidencia-2-caja', 'evidencia-3-caja-completa'])
    mock.module(`../../assets/images/packaging/${image}.webp`, () => ({ default: 1 }));
  const { default: Screen } = await import('../../app/profile/orders/prepare/[id]');

  if (process.env.SELENE_CONTROLS_CHILD === '1') test('switches isolate drafts, stale callbacks and pre-auth dispatch; busy and submission lock callbacks', async () => {
    let tree: ReturnType<typeof create>;
    authentication = deferred();
    await act(async () => { tree = create(<Screen />); });
    const oldAddress = tree.root.findByType('AddressPickerModal').props.onSelect;
    const oldEvidence = tree.root.findByType('EvidenceUploadSection').props.onEvidenceComplete;
    await act(async () => { oldAddress({ id: 'old-origin' }); oldEvidence(['a', 'b', 'c']); });
    const confirm = () => tree.root.findByType('PrimaryButton');
    expect(confirm().props.disabled).toBe(false);
    const oldSubmit = confirm().props.onPress;
    await act(async () => { selectedId = 'other'; tree.update(<Screen />); });
    expect(tree.root.findByType('AddressSection').props.address).toBeNull();
    expect(confirm().props.disabled).toBe(true);
    const authCount = authenticate.mock.calls.length;
    await act(async () => { oldAddress({ id: 'late' }); oldEvidence(['late', 'late', 'late']); await oldSubmit(); });
    expect(authenticate).toHaveBeenCalledTimes(authCount);
    expect(tree.root.findByType('AddressSection').props.address).toBeNull();
    await act(async () => {
      tree.root.findByType('AddressPickerModal').props.onSelect({ id: 'new-origin' });
      tree.root.findByType('EvidenceUploadSection').props.onEvidenceComplete(['d', 'e', 'f']);
    });
    const submit = confirm().props.onPress;
    await act(async () => { tree.root.findByType('EvidenceUploadSection').props.onBusyChange(true); await submit(); });
    expect(authenticate).toHaveBeenCalledTimes(authCount);
    expect(confirm().props.disabled).toBe(true);
    await act(async () => { tree.root.findByType('EvidenceUploadSection').props.onBusyChange(false); });
    let pending!: Promise<void>;
    await act(async () => {
      pending = confirm().props.onPress();
      tree.root.findAllByType('TouchableOpacity')[0].props.onPress();
      tree.root.findByType('AddressPickerModal').props.onSelect({ id: 'forbidden' });
    });
    expect(setParams).not.toHaveBeenCalled();
    expect(tree.root.findByType('AddressSection').props.address.id).toBe('new-origin');
    expect(tree.root.findByType('EvidenceUploadSection').props.disabled).toBe(true);
    expect(tree.root.findByType('AddressSection').props.disabled).toBe(true);
    expect(tree.root.findByType('PackagingGuideCard').props.disabled).toBe(true);
    expect(tree.root.findByType('LabelWithHelp').props.disabled).toBe(true);
    const generationCount = execute.mock.calls.length;
    await act(async () => { selectedId = 'selected'; tree.update(<Screen />); });
    await act(async () => { authentication.resolve({ success: true }); await pending; });
    expect(execute).toHaveBeenCalledTimes(generationCount);
    expect(confirm().props.disabled).toBe(true);
    await act(async () => { tree.unmount(); });
  });

  if (process.env.SELENE_CONTROLS_CHILD === '1') {
    test('order and auth boundaries clear drafts and reject old callbacks', async () => {
      for (const scope of ['order', 'auth']) {
        let tree: ReturnType<typeof create>;
        await act(async () => { tree = create(<Screen />); });
        const address = tree.root.findByType('AddressPickerModal').props.onSelect;
        const evidence = tree.root.findByType('EvidenceUploadSection').props.onEvidenceComplete;
        await act(async () => { address({ id: 'old' }); evidence(['a', 'b', 'c']); });
        const submit = tree.root.findByType('PrimaryButton').props.onPress;
        await act(async () => {
          if (scope === 'order') orderId = 'different-order'; else viewer = 'different-seller';
          tree.update(<Screen />);
        });
        const count = authenticate.mock.calls.length;
        await act(async () => { address({ id: 'late' }); evidence(['late', 'late', 'late']); await submit(); });
        expect(authenticate).toHaveBeenCalledTimes(count);
        expect(tree.root.findByType('AddressSection').props.address).toBeNull();
        expect(tree.root.findByType('PrimaryButton').props.disabled).toBe(true);
        await act(async () => { tree.unmount(); });
        orderId = 'order-123'; viewer = 'seller';
      }
    });

    test('retained navigation, refresh and PDF callbacks are inert in the submission turn and dismiss is requested', async () => {
      let tree: ReturnType<typeof create>;
      onboarding = false;
      await act(async () => { tree = create(<Screen />); });
      const onboardingPress = tree.root.findByType('PrimaryButton').props.onPress;
      onboarding = true; persistedState = 'orphan_pending';
      await act(async () => { tree.update(<Screen />); });
      const recovery = tree.root.findByType('ShipmentLabelRecoveryCard').props;
      persistedLabel = 'https://example.test/persisted.pdf';
      await act(async () => { tree.update(<Screen />); });
      const pdf = tree.root.findByType('PrimaryButton').props.onPress;
      persistedLabel = null; persistedState = 'unclaimed';
      await act(async () => { tree.update(<Screen />); });
      await act(async () => {
        tree.root.findByType('AddressPickerModal').props.onSelect({ id: 'origin' });
        tree.root.findByType('EvidenceUploadSection').props.onEvidenceComplete(['a', 'b', 'c']);
      });
      authentication = deferred();
      const counts = [push.mock.calls.length, refetch.mock.calls.length, openURL.mock.calls.length, dismiss.mock.calls.length];
      let pending!: Promise<void>;
      await act(async () => {
        pending = tree.root.findByType('PrimaryButton').props.onPress();
        onboardingPress(); recovery.onSupport(); recovery.onRefresh(); pdf();
      });
      expect(push).toHaveBeenCalledTimes(counts[0]);
      expect(refetch).toHaveBeenCalledTimes(counts[1]);
      expect(openURL).toHaveBeenCalledTimes(counts[2]);
      expect(dismiss).toHaveBeenCalledTimes(counts[3] + 1);
      await act(async () => { authentication.resolve({ success: false }); await pending; tree.unmount(); });
    });
  }

  test('locks before authentication, releases on decline/failure/success and opens the resulting PDF', async () => {
    selectedId = 'selected';
    authenticate.mockClear(); execute.mockClear(); refetch.mockClear(); feedback.mockClear(); back.mockClear();
    authentication = deferred();
    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;
    let tree: ReturnType<typeof create>;
    try {
      await act(async () => { tree = create(<Screen />); });
      await act(async () => {
        tree.root.findByType('AddressPickerModal').props.onSelect({ id: 'origin' });
        tree.root.findByType('EvidenceUploadSection').props.onEvidenceComplete(['one', 'two', 'three']);
      });
      const button = () => tree.root.findByType('PrimaryButton');
      const startTwice = async () => {
        const handler = button().props.onPress;
        let first!: Promise<void>;
        let second!: Promise<void>;
        await act(async () => {
          first = handler();
          second = handler();
        });
        expect(button().props.disabled).toBe(true);
        expect(button().props.loading).toBe(true);
        return { first, second };
      };
      const declined = await startTwice();
      expect(authenticate).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(0);
      await act(async () => {
        authentication.resolve({ success: false });
        await Promise.all([declined.first, declined.second]);
      });
      expect(button().props.disabled).toBe(false);
      authentication = deferred();
      const failed = await startTwice();
      expect(authenticate).toHaveBeenCalledTimes(2);
      await act(async () => { authentication.resolve({ success: true }); });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(button().props.disabled).toBe(true);
      await act(async () => {
        generation.reject(new Error('PAQUETEXPRESS_GROUND_UNAVAILABLE'));
        await Promise.all([failed.first, failed.second]);
      });
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(button().props.disabled).toBe(false);
      expect(JSON.stringify(tree.toJSON())).toContain('orders:prepare.errors.serviceUnavailable');
      expect(execute).toHaveBeenCalledTimes(1);
      authentication = deferred();
      generation = deferred();
      const success = await startTwice();
      expect(authenticate).toHaveBeenCalledTimes(3);
      await act(async () => { authentication.resolve({ success: true }); });
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1]).toEqual([{
        shipmentId: 'selected', originAddressId: 'origin',
        shippingEvidence: { images: ['one', 'two', 'three'] },
      }]);
      await act(async () => {
        generation.resolve({ labelUrl: 'https://example.test/label.pdf' });
        await Promise.all([success.first, success.second]);
      });
      expect(button().props.disabled).toBe(false);
      expect(feedback).toHaveBeenCalledTimes(1);
      expect(tree.root.findByType('ConfirmDialog').props.visible).toBe(true);
      await act(async () => { await tree.root.findByType('ConfirmDialog').props.onConfirm(); });
      expect(openURL).toHaveBeenCalledWith('https://example.test/label.pdf');
      expect(back).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => { tree?.unmount(); });
      console.warn = originalWarn;
    }
  });
}
