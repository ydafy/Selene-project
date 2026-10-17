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
  const order = { id: 'order-123', shipments: [shipment] };
  const refetch = mock(async () => ({ data: order, error: null }));
  const openURL = mock(async () => {});
  const back = mock(() => {});
  const feedback = mock(async () => {});
  mock.module('react-native', () => ({
    ScrollView: host('ScrollView'), TouchableOpacity: host('TouchableOpacity'),
    Linking: { openURL },
  }));
  mock.module('@react-navigation/native', () => ({ usePreventRemove: () => {} }));
  mock.module('expo-router', () => ({
    Stack: { Screen: host('StackScreen') },
    useLocalSearchParams: () => ({ id: order.id, shipment_id: shipment.id }),
    useRouter: () => ({ canGoBack: () => true, back }),
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
    ['features/address/AddressPickerModal', 'AddressPickerModal'],
    ['ui/PrimaryButton', 'PrimaryButton'], ['ui/ConfirmDialog', 'ConfirmDialog'],
    ['ui/ErrorState', 'ErrorState'], ['ui/Skeleton', 'Skeleton'],
    ['ui/LabelWithHelp', 'LabelWithHelp'],
    ['features/orders/PackagingGuideCard', 'PackagingGuideCard'],
    ['features/orders/ShipmentLabelRecoveryCard', 'ShipmentLabelRecoveryCard'],
    ['features/orders/EvidenceUploadSection', 'EvidenceUploadSection'],
  ]) mock.module(`../../components/${path}`, () => ({ [name]: host(name) }));
  mock.module('../../components/auth/AuthProvider', () => ({ useAuthContext: () => ({ session: { user: { id: 'seller' } } }) }));
  mock.module('../../core/hooks/useOrders', () => ({ useOrderById: () => ({ data: order, isLoading: false, isFetching: false, error: null, refetch }) }));
  mock.module('../../core/hooks/useOrderActions', () => ({ useOrderActions: () => ({ generateLabel: { isLoading: false, execute } }) }));
  mock.module('../../core/hooks/useSystemConfig', () => ({ useSystemConfig: () => ({ data: {} }) }));
  mock.module('../../core/hooks/useConnectOnboarding', () => ({ useConnectOnboarding: () => ({ isComplete: true, isLoading: false }) }));
  mock.module('../../core/hooks/useShipmentLabelRefresh', () => ({ useShipmentLabelRefresh: () => {} }));
  mock.module('../../core/utils/biometrics', () => ({ authenticateAsync: authenticate }));
  for (const image of ['evidencia-1-producto', 'evidencia-2-caja', 'evidencia-3-caja-completa'])
    mock.module(`../../assets/images/packaging/${image}.webp`, () => ({ default: 1 }));
  const { default: Screen } = await import('../../app/profile/orders/prepare/[id]');

  test('locks before authentication, releases on decline/failure/success and opens the resulting PDF', async () => {
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
