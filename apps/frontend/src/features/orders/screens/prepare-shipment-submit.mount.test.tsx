import { expect, mock, test } from 'bun:test';
import React from 'react';

if (process.env.SELENE_SUBMIT_CHILD !== '1') {
  test('real preparing handler excludes same-turn submissions in isolation', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_SUBMIT_CHILD: '1' },
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
  // The library only accepts strings inside a text host, so the label sits in one.
  const labelHost =
    (name: string) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        name,
        props,
        React.createElement('Text', null, children),
      );
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };
  let authentication = deferred<{ success: boolean }>();
  let generation = deferred<{ labelUrl: string }>();
  const authenticate = mock(() => authentication.promise);
  const execute = mock<(...args: unknown[]) => unknown>(
    () => generation.promise,
  );
  const shipment = {
    id: 'selected',
    seller_id: 'seller',
    status: 'paid',
    label_generation_state: 'unclaimed',
    label_url: null,
    tracking_number: null,
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
    StyleSheet: { flatten: (style: unknown) => style },
    ScrollView: host('ScrollView'),
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
    Linking: { openURL },
  }));
  mock.module('expo-router', () => ({
    Stack: { Screen: host('StackScreen') },
    useLocalSearchParams: () => ({ id: orderId, shipment_id: selectedId }),
    useRouter: () => ({ canGoBack: () => true, back, setParams, push }),
    usePreventRemove: () => {},
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, options?: { returnObjects?: boolean }) =>
        options?.returnObjects ? [] : key,
    }),
  }));
  mock.module('@gorhom/bottom-sheet', () => ({
    BottomSheetModal: host('BottomSheetModal'),
  }));
  mock.module('@react-native-vector-icons/material-design-icons', () => ({
    default: host('Icon'),
  }));
  mock.module('react-native-reanimated', () => ({
    default: { View: host('AnimatedView') },
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  }));
  mock.module('expo-haptics', () => ({
    notificationAsync: feedback,
    NotificationFeedbackType: { Success: 'success' },
  }));
  mock.module('@shopify/restyle', () => ({ useTheme: () => ({ colors: {} }) }));
  mock.module('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
  }));
  mock.module('@/shared/ui/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));
  for (const [path, name] of [
    ['shared/ui/global-header', 'GlobalHeader'],
    ['shared/ui/screen-header', 'ScreenHeader'],
    ['shared/ui/address/address-section', 'AddressSection'],
    ['shared/ui/button/primary-button', 'PrimaryButton'],
    ['shared/ui/feedback/confirm-dialog', 'ConfirmDialog'],
    ['shared/ui/feedback/error-state', 'ErrorState'],
    ['shared/ui/feedback/skeleton', 'Skeleton'],
    ['shared/ui/label-with-help', 'LabelWithHelp'],
    ['features/orders/components/packaging-guide-card', 'PackagingGuideCard'],
    [
      'features/orders/components/shipment-label-recovery-card',
      'ShipmentLabelRecoveryCard',
    ],
    [
      'features/orders/components/evidence-upload-section',
      'EvidenceUploadSection',
    ],
  ])
    mock.module(`@/${path}`, () => ({
      [name]: name === 'PrimaryButton' ? labelHost(name) : host(name),
    }));
  mock.module('@/shared/ui/address/address-picker-modal', () => ({
    AddressPickerModal: ({
      innerRef,
      ...props
    }: {
      innerRef: React.RefObject<unknown>;
    }) => {
      React.useLayoutEffect(() => {
        innerRef.current = { dismiss, present: () => {} };
        return () => {
          innerRef.current = null;
        };
      }, [innerRef]);
      return React.createElement('AddressPickerModal', props);
    },
  }));
  mock.module('@/shared/lib/auth/auth-provider', () => ({
    useAuthContext: () => ({ session: { user: { id: viewer } } }),
  }));
  mock.module('../hooks/use-orders', () => ({
    useOrderById: () => ({
      data: {
        ...order,
        id: orderId,
        shipments: order.shipments.map((item) => ({
          ...item,
          seller_id: viewer,
          label_generation_state: persistedState,
          label_url: persistedLabel,
        })),
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch,
    }),
  }));
  mock.module('../hooks/use-order-actions', () => ({
    useOrderActions: () => ({ generateLabel: { isLoading: false, execute } }),
  }));
  mock.module('@/shared/hooks/use-system-config', () => ({
    useSystemConfig: () => ({ data: {} }),
  }));
  mock.module('@/shared/hooks/use-connect-onboarding', () => ({
    useConnectOnboarding: () => ({ isComplete: onboarding, isLoading: false }),
  }));
  mock.module('../hooks/use-shipment-label-refresh', () => ({
    useShipmentLabelRefresh: () => {},
  }));
  mock.module('@/shared/lib/biometrics', () => ({
    authenticateAsync: authenticate,
  }));
  for (const image of [
    'evidencia-1-producto',
    'evidencia-2-caja',
    'evidencia-3-caja-completa',
  ])
    mock.module(`@/assets/images/packaging/${image}.webp`, () => ({
      default: 1,
    }));
  const { act, render } = await import('@testing-library/react-native');
  type View = Awaited<ReturnType<typeof render>>;
  const all = (view: View, type: string) =>
    view.container.queryAll((node) => node.type === type);
  const one = (view: View, type: string) => {
    const found = all(view, type);
    expect(found).toHaveLength(1);
    return found[0];
  };
  const { PrepareShipmentScreen: Screen } =
    await import('./prepare-shipment-screen');

  if (process.env.SELENE_CONTROLS_CHILD === '1')
    test('switches isolate drafts, stale callbacks and pre-auth dispatch; busy and submission lock callbacks', async () => {
      let tree: View;
      authentication = deferred();
      tree = await render(<Screen />);
      const oldAddress = one(tree, 'AddressPickerModal').props.onSelect;
      const oldEvidence = one(tree, 'EvidenceUploadSection').props
        .onEvidenceComplete;
      await act(async () => {
        oldAddress({ id: 'old-origin' });
        oldEvidence(['a', 'b', 'c']);
      });
      const confirm = () => one(tree, 'PrimaryButton');
      expect(confirm().props.disabled).toBe(false);
      const oldSubmit = confirm().props.onPress;
      selectedId = 'other';
      await tree.rerender(<Screen />);
      expect(one(tree, 'AddressSection').props.address).toBeNull();
      expect(confirm().props.disabled).toBe(true);
      const authCount = authenticate.mock.calls.length;
      await act(async () => {
        oldAddress({ id: 'late' });
        oldEvidence(['late', 'late', 'late']);
        await oldSubmit();
      });
      expect(authenticate).toHaveBeenCalledTimes(authCount);
      expect(one(tree, 'AddressSection').props.address).toBeNull();
      await act(async () => {
        one(tree, 'AddressPickerModal').props.onSelect({ id: 'new-origin' });
        one(tree, 'EvidenceUploadSection').props.onEvidenceComplete([
          'd',
          'e',
          'f',
        ]);
      });
      const submit = confirm().props.onPress;
      await act(async () => {
        one(tree, 'EvidenceUploadSection').props.onBusyChange(true);
        await submit();
      });
      expect(authenticate).toHaveBeenCalledTimes(authCount);
      expect(confirm().props.disabled).toBe(true);
      await act(async () => {
        one(tree, 'EvidenceUploadSection').props.onBusyChange(false);
      });
      let pending!: Promise<void>;
      await act(async () => {
        pending = confirm().props.onPress();
        all(tree, 'TouchableOpacity')[0].props.onPress();
        one(tree, 'AddressPickerModal').props.onSelect({ id: 'forbidden' });
      });
      expect(setParams).not.toHaveBeenCalled();
      expect(one(tree, 'AddressSection').props.address.id).toBe('new-origin');
      expect(one(tree, 'EvidenceUploadSection').props.disabled).toBe(true);
      expect(one(tree, 'AddressSection').props.disabled).toBe(true);
      expect(one(tree, 'PackagingGuideCard').props.disabled).toBe(true);
      expect(one(tree, 'LabelWithHelp').props.disabled).toBe(true);
      const generationCount = execute.mock.calls.length;
      selectedId = 'selected';
      await tree.rerender(<Screen />);
      await act(async () => {
        authentication.resolve({ success: true });
        await pending;
      });
      expect(execute).toHaveBeenCalledTimes(generationCount);
      expect(confirm().props.disabled).toBe(true);
      await tree?.unmount();
    });

  if (process.env.SELENE_CONTROLS_CHILD === '1') {
    test('order and auth boundaries clear drafts and reject old callbacks', async () => {
      for (const scope of ['order', 'auth']) {
        let tree: View;
        tree = await render(<Screen />);
        const address = one(tree, 'AddressPickerModal').props.onSelect;
        const evidence = one(tree, 'EvidenceUploadSection').props
          .onEvidenceComplete;
        await act(async () => {
          address({ id: 'old' });
          evidence(['a', 'b', 'c']);
        });
        const submit = one(tree, 'PrimaryButton').props.onPress;
        if (scope === 'order') orderId = 'different-order';
        else viewer = 'different-seller';
        await tree.rerender(<Screen />);
        const count = authenticate.mock.calls.length;
        await act(async () => {
          address({ id: 'late' });
          evidence(['late', 'late', 'late']);
          await submit();
        });
        expect(authenticate).toHaveBeenCalledTimes(count);
        expect(one(tree, 'AddressSection').props.address).toBeNull();
        expect(one(tree, 'PrimaryButton').props.disabled).toBe(true);
        await tree?.unmount();
        orderId = 'order-123';
        viewer = 'seller';
      }
    });

    test('a retained submit handler never reaches biometrics with fewer than three photos', async () => {
      const tree = await render(<Screen />);
      await act(async () => {
        one(tree, 'AddressPickerModal').props.onSelect({ id: 'origin' });
        one(tree, 'EvidenceUploadSection').props.onEvidenceComplete(['a', 'b']);
      });
      const submit = one(tree, 'PrimaryButton').props.onPress;
      expect(one(tree, 'PrimaryButton').props.disabled).toBe(true);
      const count = authenticate.mock.calls.length;
      await act(async () => {
        await submit();
      });
      expect(authenticate).toHaveBeenCalledTimes(count);
      await tree.unmount();
    });

    test('retained navigation, refresh and PDF callbacks are inert in the submission turn and dismiss is requested', async () => {
      let tree: View;
      onboarding = false;
      tree = await render(<Screen />);
      const onboardingPress = one(tree, 'PrimaryButton').props.onPress;
      onboarding = true;
      persistedState = 'orphan_pending';
      await tree.rerender(<Screen />);
      const recovery = one(tree, 'ShipmentLabelRecoveryCard').props;
      persistedLabel = 'https://example.test/persisted.pdf';
      await tree.rerender(<Screen />);
      const pdf = one(tree, 'PrimaryButton').props.onPress;
      persistedLabel = null;
      persistedState = 'unclaimed';
      await tree.rerender(<Screen />);
      await act(async () => {
        one(tree, 'AddressPickerModal').props.onSelect({ id: 'origin' });
        one(tree, 'EvidenceUploadSection').props.onEvidenceComplete([
          'a',
          'b',
          'c',
        ]);
      });
      authentication = deferred();
      const counts = [
        push.mock.calls.length,
        refetch.mock.calls.length,
        openURL.mock.calls.length,
        dismiss.mock.calls.length,
      ];
      let pending!: Promise<void>;
      await act(async () => {
        pending = one(tree, 'PrimaryButton').props.onPress();
        onboardingPress();
        recovery.onSupport();
        recovery.onRefresh();
        pdf();
      });
      expect(push).toHaveBeenCalledTimes(counts[0]);
      expect(refetch).toHaveBeenCalledTimes(counts[1]);
      expect(openURL).toHaveBeenCalledTimes(counts[2]);
      expect(dismiss).toHaveBeenCalledTimes(counts[3] + 1);
      await act(async () => {
        authentication.resolve({ success: false });
        await pending;
      });
      await tree.unmount();
    });
  }

  test('locks before authentication, releases on decline/failure/success and opens the resulting PDF', async () => {
    selectedId = 'selected';
    authenticate.mockClear();
    execute.mockClear();
    refetch.mockClear();
    feedback.mockClear();
    back.mockClear();
    authentication = deferred();
    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;
    let tree: View | undefined;
    try {
      tree = await render(<Screen />);
      await act(async () => {
        one(tree!, 'AddressPickerModal').props.onSelect({ id: 'origin' });
        one(tree!, 'EvidenceUploadSection').props.onEvidenceComplete([
          'one',
          'two',
          'three',
        ]);
      });
      const button = () => one(tree!, 'PrimaryButton');
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
      await act(async () => {
        authentication.resolve({ success: true });
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(button().props.disabled).toBe(true);
      await act(async () => {
        generation.reject(new Error('PAQUETEXPRESS_GROUND_UNAVAILABLE'));
        await Promise.all([failed.first, failed.second]);
      });
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(button().props.disabled).toBe(false);
      expect(JSON.stringify(tree!.toJSON())).toContain(
        'orders:prepare.errors.serviceUnavailable',
      );
      expect(execute).toHaveBeenCalledTimes(1);
      authentication = deferred();
      generation = deferred();
      const success = await startTwice();
      expect(authenticate).toHaveBeenCalledTimes(3);
      await act(async () => {
        authentication.resolve({ success: true });
      });
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1]).toEqual([
        {
          shipmentId: 'selected',
          originAddressId: 'origin',
          shippingEvidence: { images: ['one', 'two', 'three'] },
        },
      ]);
      await act(async () => {
        generation.resolve({ labelUrl: 'https://example.test/label.pdf' });
        await Promise.all([success.first, success.second]);
      });
      expect(button().props.disabled).toBe(false);
      expect(feedback).toHaveBeenCalledTimes(1);
      expect(one(tree!, 'ConfirmDialog').props.visible).toBe(true);
      await act(async () => {
        await one(tree!, 'ConfirmDialog').props.onConfirm();
      });
      expect(openURL).toHaveBeenCalledWith('https://example.test/label.pdf');
      expect(back).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      await tree?.unmount();
      console.warn = originalWarn;
    }
  });
}
